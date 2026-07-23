//! Audio playback engine.
//!
//! rodio's output stream owns a `cpal::Stream`, which is `!Send`, so it cannot
//! live in Tauri's managed state. Instead a single dedicated thread owns the
//! stream + current `Player` for the whole app lifetime and receives commands
//! over an mpsc channel. This also keeps all decode/playback work off the UI
//! thread, per the spec's "playback must never glitch" requirement.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::Source;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Commands sent from Tauri command handlers to the audio thread.
pub enum Cmd {
    /// Load a file and begin playback. `duration` is pre-read via lofty so the
    /// seek bar has a length immediately, before any decoding happens.
    Load {
        path: PathBuf,
        duration: f64,
    },
    Play,
    Pause,
    /// Seek to an absolute position in seconds.
    Seek(f64),
    /// Volume as a linear gain factor (0.0 = mute, 1.0 = unity).
    SetVolume(f32),
    Stop,
}

/// Snapshot of playback state, shared with the rest of the app behind a mutex
/// and pushed to the frontend as a `player://status` event on every tick.
#[derive(Clone, Serialize, Default)]
pub struct Status {
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
    pub loaded: bool,
    pub volume: f32,
    /// Normalized RMS amplitude from the samples currently reaching the mixer.
    pub level: f32,
}

pub struct Engine {
    pub tx: Sender<Cmd>,
    pub status: Arc<Mutex<Status>>,
}

impl Engine {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let status = Arc::new(Mutex::new(Status {
            volume: 1.0,
            ..Default::default()
        }));
        let thread_status = status.clone();
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || audio_loop(app, thread_status, rx))
            .expect("spawn audio thread");
        Engine { tx, status }
    }

    pub fn send(&self, cmd: Cmd) {
        // If the audio thread is gone the app is shutting down; ignore.
        let _ = self.tx.send(cmd);
    }
}

fn audio_loop(app: AppHandle, status: Arc<Mutex<Status>>, rx: Receiver<Cmd>) {
    // Own the stream for the entire thread lifetime.
    let handle = match rodio::stream::DeviceSinkBuilder::open_default_sink() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("audio: failed to open output device: {e}");
            return;
        }
    };
    let mixer = handle.mixer();

    let mut player: Option<rodio::Player> = None;
    let mut volume: f32 = 1.0;
    let mut duration: f64 = 0.0;
    let mut ended_emitted = false;
    let signal_level = Arc::new(AtomicU32::new(0.0_f32.to_bits()));

    loop {
        match rx.recv_timeout(Duration::from_millis(33)) {
            Ok(Cmd::Load {
                path,
                duration: dur,
            }) => {
                // Drop the previous track and start a fresh Player.
                if let Some(p) = player.take() {
                    p.stop();
                }
                match load_source(&path) {
                    Ok(source) => {
                        signal_level.store(0.0_f32.to_bits(), Ordering::Relaxed);
                        let p = rodio::Player::connect_new(mixer);
                        p.set_volume(volume);
                        p.append(MeteredSource::new(source, signal_level.clone()));
                        p.play();
                        player = Some(p);
                        duration = dur;
                        ended_emitted = false;
                    }
                    Err(e) => {
                        eprintln!("audio: failed to load {}: {e}", path.display());
                        let _ = app.emit("player://error", format!("Could not open file: {e}"));
                        player = None;
                        duration = 0.0;
                    }
                }
            }
            Ok(Cmd::Play) => {
                if let Some(p) = &player {
                    p.play();
                }
            }
            Ok(Cmd::Pause) => {
                if let Some(p) = &player {
                    p.pause();
                }
            }
            Ok(Cmd::Seek(secs)) => {
                if let Some(p) = &player {
                    match p.try_seek(Duration::from_secs_f64(secs.max(0.0))) {
                        Ok(_) => ended_emitted = false,
                        Err(e) => {
                            // Some files build a seekable decoder but fail the
                            // actual seek. Ask the frontend to move this track to
                            // the WebView2 backend and resume at `secs`.
                            eprintln!("audio: seek failed ({e}); handing to web backend");
                            let _ = app.emit("player://seek-unsupported", secs);
                        }
                    }
                }
            }
            Ok(Cmd::SetVolume(v)) => {
                volume = v.clamp(0.0, 2.0);
                if let Some(p) = &player {
                    p.set_volume(volume);
                }
            }
            Ok(Cmd::Stop) => {
                if let Some(p) = player.take() {
                    p.stop();
                }
                signal_level.store(0.0_f32.to_bits(), Ordering::Relaxed);
                duration = 0.0;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        // Recompute and broadcast status once per loop iteration.
        let (position, playing, loaded) = match &player {
            Some(p) => {
                let ended = p.empty();
                if ended && !ended_emitted && duration > 0.0 {
                    ended_emitted = true;
                    let _ = app.emit("player://ended", ());
                }
                (p.get_pos().as_secs_f64(), !p.is_paused() && !ended, true)
            }
            None => (0.0, false, false),
        };
        let level = if playing {
            f32::from_bits(signal_level.load(Ordering::Relaxed))
        } else {
            0.0
        };

        let snapshot = {
            let mut s = status.lock().unwrap();
            s.position = position;
            s.duration = duration;
            s.playing = playing;
            s.loaded = loaded;
            s.volume = volume;
            s.level = level;
            s.clone()
        };
        let _ = app.emit("player://status", snapshot);
    }
}

/// Measures short RMS windows while transparently yielding the original
/// samples. The only cross-thread work is one relaxed atomic store per window,
/// keeping metering out of the UI and playback-control paths.
struct MeteredSource<S> {
    inner: S,
    level: Arc<AtomicU32>,
    sum_squares: f32,
    sample_count: usize,
    window_samples: usize,
}

impl<S> MeteredSource<S>
where
    S: Source,
{
    fn new(inner: S, level: Arc<AtomicU32>) -> Self {
        let window_samples =
            (inner.sample_rate().get() as usize * inner.channels().get() as usize / 60).max(1);
        Self {
            inner,
            level,
            sum_squares: 0.0,
            sample_count: 0,
            window_samples,
        }
    }
}

impl<S> Iterator for MeteredSource<S>
where
    S: Source,
{
    type Item = rodio::Sample;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        self.sum_squares += sample * sample;
        self.sample_count += 1;

        if self.sample_count >= self.window_samples {
            let rms = (self.sum_squares / self.sample_count as f32).sqrt();
            // A perceptual curve keeps quiet passages visible while preserving
            // the contrast of louder transients.
            let normalized = (rms.powf(0.45) * 1.7).clamp(0.0, 1.0);
            self.level.store(normalized.to_bits(), Ordering::Relaxed);
            self.sum_squares = 0.0;
            self.sample_count = 0;
        }

        Some(sample)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S> Source for MeteredSource<S>
where
    S: Source,
{
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> rodio::ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> rodio::SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

/// Build a decoder for a file. rodio's symphonia decoder can *panic* during
/// initialization for some files when seeking is enabled (it hits an
/// `unreachable!`), which would kill the whole audio thread. So we guard the
/// build with `catch_unwind` and fall back to a non-seekable decoder, then to a
/// clean error (which the frontend turns into a WebView2 playback fallback).
fn build_decoder(
    path: &PathBuf,
    seekable: bool,
) -> Result<rodio::Decoder<BufReader<File>>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        rodio::Decoder::builder()
            .with_data(BufReader::new(file))
            .with_seekable(seekable)
            .build()
    }));
    match built {
        Ok(Ok(dec)) => Ok(dec),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("decoder panicked during initialization".into()),
    }
}

fn load_source(path: &PathBuf) -> Result<rodio::Decoder<BufReader<File>>, String> {
    // Only use a *seekable* rodio decoder. If the seekable build panics or fails
    // (some files trip rodio's symphonia decoder), return an error so the
    // frontend falls back to the WebView2 backend — which can both decode and
    // SEEK the file. A non-seekable rodio decoder would play but break scrubbing.
    build_decoder(path, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::source::SineWave;

    #[test]
    fn metered_source_reports_real_signal_amplitude() {
        let level = Arc::new(AtomicU32::new(0.0_f32.to_bits()));
        let source = SineWave::new(440.0);
        let mut metered = MeteredSource::new(source, level.clone());
        let samples_to_measure = metered.window_samples;

        for _ in 0..samples_to_measure {
            assert!(metered.next().is_some());
        }

        let measured = f32::from_bits(level.load(Ordering::Relaxed));
        assert!(
            measured > 0.1,
            "expected a live signal level, got {measured}"
        );
    }
}
