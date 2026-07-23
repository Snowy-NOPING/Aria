//! System Media Transport Controls (Windows SMTC via souvlaki): media keys,
//! the OS "now playing" overlay, and taskbar controls.
//!
//! souvlaki's `MediaControls` is `!Send` and must be created + touched on the
//! main (UI) thread. We create it in `init` (called from Tauri setup, which runs
//! on the main thread) and route every later update through
//! `AppHandle::run_on_main_thread`. Media-key presses are forwarded to the
//! frontend as `smtc://control` / `smtc://seek` events.

use std::sync::Mutex;
use std::time::Duration;

use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
};
use tauri::{AppHandle, Emitter, Manager};

/// Wrapper making the `!Send` controls storable in Tauri state. Safe because we
/// only ever touch the inner value on the main thread (see module docs).
pub struct Smtc(pub Mutex<Option<Controls>>);
pub struct Controls(MediaControls);
unsafe impl Send for Controls {}

impl Smtc {
    pub fn new() -> Self {
        Smtc(Mutex::new(None))
    }
}

/// Create the media controls and attach the key-event callback. No-op on error.
pub fn init(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    #[cfg(target_os = "windows")]
    let hwnd = match window.hwnd() {
        Ok(h) => Some(h.0),
        Err(_) => return,
    };
    #[cfg(not(target_os = "windows"))]
    let hwnd = None;

    let config = PlatformConfig {
        dbus_name: "aria",
        display_name: "Aria",
        hwnd,
    };

    let mut controls = match MediaControls::new(config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("smtc: init failed: {e:?}");
            return;
        }
    };

    let app_cb = app.clone();
    let attached = controls.attach(move |event: MediaControlEvent| {
        let name = match event {
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause => "pause",
            MediaControlEvent::Toggle => "toggle",
            MediaControlEvent::Next => "next",
            MediaControlEvent::Previous => "prev",
            MediaControlEvent::Stop => "stop",
            MediaControlEvent::SetPosition(p) => {
                let _ = app_cb.emit("smtc://seek", p.0.as_secs_f64());
                return;
            }
            _ => return,
        };
        let _ = app_cb.emit("smtc://control", name);
    });
    if let Err(e) = attached {
        eprintln!("smtc: attach failed: {e:?}");
        return;
    }

    if let Some(state) = app.try_state::<Smtc>() {
        *state.0.lock().unwrap() = Some(Controls(controls));
    }
}

pub fn set_metadata(app: &AppHandle, title: String, artist: String, album: String, duration: f64) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = app2.try_state::<Smtc>() {
            if let Some(c) = state.0.lock().unwrap().as_mut() {
                let dur = if duration > 0.0 {
                    Some(Duration::from_secs_f64(duration))
                } else {
                    None
                };
                let _ = c.0.set_metadata(MediaMetadata {
                    title: Some(&title),
                    artist: Some(&artist),
                    album: Some(&album),
                    duration: dur,
                    ..Default::default()
                });
            }
        }
    });
}

pub fn set_playback(app: &AppHandle, playing: bool, position: f64) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = app2.try_state::<Smtc>() {
            if let Some(c) = state.0.lock().unwrap().as_mut() {
                let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
                let pb = if playing {
                    MediaPlayback::Playing { progress }
                } else {
                    MediaPlayback::Paused { progress }
                };
                let _ = c.0.set_playback(pb);
            }
        }
    });
}
