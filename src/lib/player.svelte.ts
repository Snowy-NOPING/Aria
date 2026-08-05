import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { library } from "./library.svelte";
import { lastfm } from "./lastfm.svelte";
import { discord } from "./discord.svelte";

export interface TrackMeta {
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track_number: number | null;
  duration: number;
  art: string | null;
  kind: "audio" | "video";
}

interface StatusEvent {
  position: number;
  duration: number;
  playing: boolean;
  loaded: boolean;
  volume: number;
  level: number;
}

const AUDIO_EXTS = ["mp3", "flac", "wav", "ogg", "oga", "m4a", "aac", "opus"];

/** Apple Music's now-playing indicator is four bars — bass → treble.
 *  FFT bin ranges (fftSize 512, so ~86–94 Hz per bin) roughly covering
 *  low bass, low mid, mid, and presence. */
const ANALYZER_BANDS: [number, number][] = [
  [1, 3],
  [3, 9],
  [9, 26],
  [26, 72],
];
/** Per-band gain — higher bands carry less energy in real music. */
const BAND_GAIN = [1.0, 1.1, 1.3, 1.6];
/** Shape used when only a single RMS level is available (rodio backend). */
const BAND_SHAPE = [1.0, 0.9, 0.74, 0.58];
/** Everything below this much of the analyser's range reads as silence. Without
 *  it, ordinary mastered music sits near the top of the scale and the bars
 *  just stay pinned. */
const BAND_FLOOR = 0.34;
/** >1 expands the range, so only genuinely loud content reaches full height. */
const BAND_CURVE = 1.45;
/** Tracks autoplay appends each time the queue runs dry. Small enough that the
 *  queue stays readable, large enough to survive a few skips. */
const AUTOPLAY_BATCH = 10;

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}
function needsWebBackend(path: string): boolean {
  // Use one playback pipeline for every supported format. WebView2 provides
  // reliable local playback + seeking and feeds the real-time analyser without
  // Rodio/Symphonia decoder panics or mid-track backend handoffs.
  return AUDIO_EXTS.includes(extOf(path));
}

/**
 * Central playback state. WebView2 owns playback for every supported format;
 * this class drives the media element, queue, waveform, and OS integrations.
 * UI reads its `$state` fields reactively.
 */
class Player {
  queue = $state<TrackMeta[]>([]);
  currentIndex = $state(-1);

  position = $state(0);
  duration = $state(0);
  playing = $state(false);
  loaded = $state(false);
  volume = $state(1);
  /** Four per-frequency-band levels (0–1) driving the now-playing analyzer. */
  analyzerBands = $state([0, 0, 0, 0]);

  /** True while the user is dragging the seek bar (suppress incoming updates). */
  scrubbing = $state(false);

  /** off → repeat the whole context (queue/album/playlist) → repeat one. */
  repeat = $state<"off" | "all" | "one">("off");
  shuffled = $state(false);
  /** Keep playing past the end of the queue by pulling similar library tracks. */
  autoplay = $state(false);

  private initialized = false;

  /** Web-backend playback for formats rodio can't decode (e.g. Opus). */
  private audio: HTMLAudioElement | null = null;
  private usingWeb = false;
  private raf = 0;
  private audioContext: AudioContext | null = null;
  private webAnalyser: AnalyserNode | null = null;
  private webFreqData: Uint8Array | null = null;
  private bandLevels = [0, 0, 0, 0];
  /** Drives the per-band offsets of the synthesized (rodio) fallback. */
  private bandPhase = 0;
  /** Paths that must use the WebView2 backend (rodio failed to decode them). */
  private forceWeb = new Set<string>();
  /** Position (s) to resume at once the web backend has loaded. */
  private pendingSeek: number | null = null;
  private listenPath = "";
  private listenStartedAt = 0;
  private listenedSeconds = 0;
  private lastListenSample = performance.now();
  private listenScrobbled = false;
  private naturallyEndedPath: string | null = null;

  get current(): TrackMeta | null {
    return this.queue[this.currentIndex] ?? null;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    await listen<StatusEvent>("player://status", (e) => {
      // Ignore the rodio engine's status while the web backend is in charge.
      if (this.usingWeb) return;
      const s = e.payload;
      if (!this.scrubbing) this.position = s.position;
      // Duration from tags is authoritative; keep it if the engine reports 0.
      if (s.duration > 0) this.duration = s.duration;
      this.playing = s.playing;
      this.loaded = s.loaded;
      if (s.playing) this.updateBandsFromLevel(s.level);
      else this.clearWaveform();
    });

    await listen("player://ended", () => {
      if (this.usingWeb) return;
      // A track that "ends" almost immediately usually failed to decode — try
      // the WebView2 backend before giving up.
      const t = this.current;
      if (t && t.duration > 2 && this.position < 1 && !this.forceWeb.has(t.path)) {
        this.forceWeb.add(t.path);
        this.playIndex(this.currentIndex);
        return;
      }
      this.markNaturallyEnded();
      this.advance();
    });

    await listen<string>("player://error", (e) => {
      if (this.usingWeb) return;
      const t = this.current;
      if (t && !this.forceWeb.has(t.path)) {
        // rodio couldn't decode it — fall back to WebView2's decoder.
        console.warn("rodio failed, falling back to WebView audio:", e.payload);
        this.forceWeb.add(t.path);
        this.playIndex(this.currentIndex);
      } else {
        console.error("playback error:", e.payload);
        this.next();
      }
    });

    // Media keys / OS overlay (SMTC) → drive the player.
    await listen<string>("smtc://control", (e) => {
      switch (e.payload) {
        case "play":
          if (!this.playing) this.togglePlay();
          break;
        case "pause":
          if (this.playing) this.togglePlay();
          break;
        case "toggle":
          this.togglePlay();
          break;
        case "next":
          this.next();
          break;
        case "prev":
          this.prev();
          break;
        case "stop":
          invoke("stop");
          this.stopWeb();
          this.playing = false;
          break;
      }
    });
    await listen<number>("smtc://seek", (e) => this.seek(e.payload));

    // rodio couldn't seek this track — switch it to the WebView2 backend and
    // resume at the requested position (which the web backend can seek to).
    await listen<number>("player://seek-unsupported", (e) => {
      const t = this.current;
      if (!t || this.usingWeb) return;
      if (!this.forceWeb.has(t.path)) this.forceWeb.add(t.path);
      this.pendingSeek = e.payload;
      this.playIndex(this.currentIndex);
    });

    // Keep the OS overlay's timeline/state roughly in sync.
    setInterval(() => {
      if (this.loaded) this.publishPlayback();
    }, 1000);
    setInterval(() => this.sampleListen(), 1000);

    // Hidden element for Opus (and any future web-decoded formats).
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.volume = this.volume;
    el.addEventListener("ended", () => {
      if (this.usingWeb) {
        this.markNaturallyEnded();
        this.advance();
      }
    });
    el.addEventListener("play", () => {
      if (this.usingWeb) {
        this.playing = true;
        this.tickWeb();
      }
    });
    el.addEventListener("pause", () => {
      if (this.usingWeb) {
        this.playing = false;
        this.clearWaveform();
      }
    });
    el.addEventListener("loadedmetadata", () => {
      if (!this.usingWeb) return;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        this.duration = el.duration;
      }
      // Resume at a pending position (from a failed rodio seek).
      if (this.pendingSeek != null) {
        el.currentTime = this.pendingSeek;
        this.position = this.pendingSeek;
        this.pendingSeek = null;
      }
    });
    el.addEventListener("error", () => {
      if (this.usingWeb) {
        console.error("web audio error for", this.current?.path);
        this.next();
      }
    });
    this.audio = el;
  }

  /** Push new band targets through a fast-attack / slow-release envelope, so
   *  the bars snap up on transients and settle back the way Apple's do. */
  private pushBands(targets: number[]) {
    for (let i = 0; i < 4; i++) {
      const target = this.playing ? Math.max(0, Math.min(1, targets[i])) : 0;
      const smoothing = target > this.bandLevels[i] ? 0.6 : 0.16;
      this.bandLevels[i] += (target - this.bandLevels[i]) * smoothing;
    }
    this.analyzerBands = [...this.bandLevels];
  }

  /** Split the spectrum into the four display bands. */
  private updateBandsFromSpectrum(spectrum: Uint8Array) {
    const targets = ANALYZER_BANDS.map(([from, to], band) => {
      let sum = 0;
      const end = Math.min(to, spectrum.length);
      for (let bin = from; bin < end; bin++) sum += spectrum[bin];
      const avg = end > from ? sum / (end - from) / 255 : 0;
      // Cut the floor away first, then expand what's left — otherwise every
      // band sits in the top third of the scale for the whole track.
      const above = Math.max(0, (avg - BAND_FLOOR) / (1 - BAND_FLOOR));
      return Math.min(1, Math.pow(above, BAND_CURVE) * BAND_GAIN[band]);
    });
    this.pushBands(targets);
  }

  /** The rodio backend only reports one RMS level, so fan it out across the
   *  bands with a slow drift — close enough to read as a live analyzer. */
  private updateBandsFromLevel(rawLevel: number) {
    const level = Math.max(0, Math.min(1, rawLevel));
    // Same expansion as the spectrum path, so both backends peak (and idle) at
    // comparable heights instead of one of them sitting pinned.
    const expanded = Math.pow(Math.max(0, (level - 0.08) / 0.92), 1.35) * 1.5;
    this.bandPhase += 0.42;
    const targets = BAND_SHAPE.map((shape, band) => {
      const drift = 0.78 + 0.3 * Math.sin(this.bandPhase * (0.7 + 0.29 * band) + band * 1.9);
      return Math.min(1, expanded * shape * drift);
    });
    this.pushBands(targets);
  }

  private clearWaveform() {
    this.bandLevels = [0, 0, 0, 0];
    this.analyzerBands = [0, 0, 0, 0];
  }

  private ensureWebAnalyser() {
    if (!this.audio || this.webAnalyser) return;
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(this.audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.62;
      // Narrower than the -100/-30 dB default: the bottom of the range is
      // inaudible detail that only served to keep the bars lit.
      analyser.minDecibels = -76;
      analyser.maxDecibels = -14;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.audioContext = context;
      this.webAnalyser = analyser;
      this.webFreqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (error) {
      // Analysis must never block playback if a WebView lacks Web Audio.
      console.warn("real-time spectrum analyser unavailable:", error);
    }
  }

  private sampleWebWaveform() {
    if (!this.webAnalyser || !this.webFreqData) return;
    this.webAnalyser.getByteFrequencyData(this.webFreqData);
    this.updateBandsFromSpectrum(this.webFreqData);
  }

  /** Drive position from the <audio> element while the web backend plays. */
  private tickWeb() {
    if (!this.usingWeb || !this.audio) return;
    if (!this.scrubbing) this.position = this.audio.currentTime;
    this.sampleWebWaveform();
    if (this.audio.paused) return;
    this.raf = requestAnimationFrame(() => this.tickWeb());
  }

  /** Silence whichever backend isn't about to be used. */
  private async stopWeb() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    cancelAnimationFrame(this.raf);
    this.clearWaveform();
  }

  private beginListen(track: TrackMeta) {
    this.listenPath = track.path;
    this.listenStartedAt = Math.floor(Date.now() / 1000);
    this.listenedSeconds = 0;
    this.lastListenSample = performance.now();
    this.listenScrobbled = false;
    this.naturallyEndedPath = null;
    void lastfm.trackStarted(track);
  }

  private sampleListen() {
    const now = performance.now();
    const delta = Math.max(0, Math.min(2, (now - this.lastListenSample) / 1000));
    this.lastListenSample = now;
    const track = this.current;
    if (!track || track.path !== this.listenPath || !this.playing) return;

    this.listenedSeconds += delta;
    const duration = this.duration > 0 ? this.duration : track.duration;
    if (duration <= 30 || this.listenScrobbled) return;
    const threshold = Math.min(duration / 2, 240);
    if (this.listenedSeconds >= threshold) {
      this.listenScrobbled = true;
      void lastfm.scrobble({ ...track, duration }, this.listenStartedAt);
    }
  }

  private markNaturallyEnded() {
    const track = this.current;
    if (track) this.naturallyEndedPath = track.path;
  }

  // --- Queue management -----------------------------------------------------

  /** Replace the queue and start at `startIndex`. */
  async setQueue(tracks: TrackMeta[], startIndex = 0) {
    this.queue = tracks;
    if (tracks.length > 0) {
      await this.playIndex(startIndex);
    } else {
      this.currentIndex = -1;
    }
  }

  /** Move a queue item, keeping the current track pointer correct. */
  reorderQueue(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const q = [...this.queue];
    const [item] = q.splice(from, 1);
    q.splice(to, 0, item);
    let ci = this.currentIndex;
    if (from === ci) ci = to;
    else if (from < ci && to >= ci) ci--;
    else if (from > ci && to <= ci) ci++;
    this.queue = q;
    this.currentIndex = ci;
  }

  async addToQueue(tracks: TrackMeta[]) {
    const wasEmpty = this.queue.length === 0;
    this.queue = [...this.queue, ...tracks];
    if (wasEmpty && this.queue.length > 0) {
      await this.playIndex(0);
    }
  }

  async playNext(track: TrackMeta) {
    if (this.queue.length === 0) {
      await this.setQueue([track], 0);
      return;
    }
    const existingIdx = this.queue.findIndex((t) => t.path === track.path);
    if (existingIdx !== -1) {
      this.queue.splice(existingIdx, 1);
      if (existingIdx < this.currentIndex) {
        this.currentIndex--;
      }
    }
    this.queue.splice(this.currentIndex + 1, 0, track);
    this.queue = [...this.queue];
  }

  async playIndex(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[index];
    this.position = 0;
    this.duration = track.duration;

    if (needsWebBackend(track.path) || this.forceWeb.has(track.path)) {
      // Hand off to the WebView2 <audio> backend; silence the rodio engine.
      await invoke("stop");
      this.usingWeb = true;
      this.loaded = true;
      if (this.audio) {
        this.ensureWebAnalyser();
        try {
          await this.audioContext?.resume();
        } catch {
          /* playback remains available even if analysis cannot resume */
        }
        this.audio.src = convertFileSrc(track.path);
        this.audio.currentTime = 0;
        this.audio.volume = this.volume;
        try {
          await this.audio.play();
        } catch (e) {
          console.error("web audio play failed:", e);
        }
      }
    } else {
      // Rodio backend; silence the web element.
      await this.stopWeb();
      this.usingWeb = false;
      await invoke("load_track", { path: track.path, duration: track.duration });
    }

    this.beginListen(track);
    this.syncSmtcMeta();
    this.publishPlayback();
  }

  /**
   * Tracks to append when autoplay keeps a finished queue going. Prefers the
   * current artist, then the current album, then anything else in the library,
   * and never re-queues something already present.
   */
  private autoplayPicks(): TrackMeta[] {
    const queued = new Set(this.queue.map((t) => t.path));
    const pool = library.tracks.filter((t) => t.kind === "audio" && !queued.has(t.path));
    if (!pool.length) return [];

    const cur = this.current;
    const rank = (t: TrackMeta) => {
      if (!cur) return 2;
      if (t.artist && t.artist === cur.artist) return 0;
      if (t.album && t.album === cur.album) return 1;
      return 2;
    };

    // Shuffle first, then sort by rank. Array#sort is stable, so tracks of equal
    // affinity keep their shuffled order and each run picks a different set.
    const picks = pool.slice();
    for (let i = picks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    picks.sort((a, b) => rank(a) - rank(b));
    return picks.slice(0, AUTOPLAY_BATCH);
  }

  async next() {
    if (this.currentIndex + 1 < this.queue.length) {
      await this.playIndex(this.currentIndex + 1);
      return;
    }
    if (this.repeat === "all" && this.queue.length > 0) {
      // Loop the context back to the top.
      await this.playIndex(0);
      return;
    }
    if (this.autoplay) {
      // Extend rather than replace, so the queue stays a readable history.
      const more = this.autoplayPicks();
      if (more.length) {
        this.queue = [...this.queue, ...more];
        await this.playIndex(this.currentIndex + 1);
        return;
      }
    }
    // End of queue — silence both backends.
    await invoke("stop");
    await this.stopWeb();
    this.playing = false;
  }

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
  }

  /** Automatic advance when a track finishes (honours repeat one/all). */
  async advance() {
    if (this.repeat === "one") {
      await this.playIndex(this.currentIndex);
    } else {
      await this.next();
    }
  }

  cycleRepeat() {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
  }

  /** Shuffle the tracks after the current one in place. */
  toggleShuffle() {
    this.shuffled = !this.shuffled;
    if (!this.shuffled || this.queue.length < 3) return;
    const head = this.queue.slice(0, this.currentIndex + 1);
    const tail = this.queue.slice(this.currentIndex + 1);
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    this.queue = [...head, ...tail];
  }

  async prev() {
    // Restart the track if we're more than 3s in, otherwise go back one.
    if (this.position > 3 || this.currentIndex <= 0) {
      await this.seek(0);
    } else {
      await this.playIndex(this.currentIndex - 1);
    }
  }

  // --- Transport ------------------------------------------------------------

  async togglePlay() {
    if (this.current && this.naturallyEndedPath === this.current.path) {
      await this.playIndex(this.currentIndex);
      return;
    }
    if (!this.loaded) {
      if (this.queue.length > 0) {
        await this.playIndex(Math.max(0, this.currentIndex));
      } else {
        // Nothing queued — start the recently added songs.
        const recent = library.recentSongs;
        if (recent.length) await this.setQueue(recent, 0);
      }
      return;
    }
    if (this.usingWeb && this.audio) {
      if (this.audio.paused) await this.audio.play();
      else this.audio.pause();
      setTimeout(() => this.publishPlayback(), 50);
      return;
    }
    if (this.playing) {
      await invoke("pause");
    } else {
      await invoke("play");
    }
    setTimeout(() => this.publishPlayback(), 50);
  }

  // --- Outward now-playing state (SMTC, Discord) ---------------------------

  private syncSmtcMeta() {
    const t = this.current;
    if (!t) return;
    invoke("smtc_metadata", {
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
    });
  }

  /** Push the current playback state to everything outside the app: the OS
   *  media overlay and Discord. Called on load, play/pause, seek, and once per
   *  status tick; both consumers de-duplicate, so the tick is not a concern. */
  private publishPlayback() {
    invoke("smtc_playback", { playing: this.playing, position: this.position });
    discord.sync(this.current, this.playing, this.position);
  }

  /** Pause whichever backend is active (used when video playback takes over). */
  async pausePlayback() {
    if (!this.playing) return;
    if (this.usingWeb && this.audio) this.audio.pause();
    else await invoke("pause");
  }

  async seek(seconds: number) {
    if (this.current && this.naturallyEndedPath === this.current.path) {
      await this.playIndex(this.currentIndex);
      // A seek/restart after natural completion is a fresh listen and therefore
      // sends a new Last.fm now-playing update.
    }
    this.position = seconds;
    if (this.usingWeb && this.audio) {
      this.audio.currentTime = seconds;
    } else {
      await invoke("seek", { position: seconds });
    }
    this.publishPlayback();
  }

  async setVolume(v: number) {
    this.volume = v;
    // Keep both backends in sync so switching tracks preserves volume.
    if (this.audio) this.audio.volume = v;
    await invoke("set_volume", { volume: v });
  }

  /** Persist edited tags to the file, then refresh the in-memory queue entry. */
  async updateTags(path: string, title: string, artist: string, album: string) {
    const updated = await invoke<TrackMeta>("write_metadata", {
      path,
      title,
      artist,
      album,
    });
    this.queue = this.queue.map((t) => (t.path === path ? updated : t));
    return updated;
  }

  // --- File loading ---------------------------------------------------------

  async openFiles() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: AUDIO_EXTS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await this.loadPaths(paths, true);
  }

  async openFolder() {
    const dir = await open({ directory: true });
    if (!dir || Array.isArray(dir)) return;
    const found = await invoke<TrackMeta[]>("scan_folder", { path: dir });
    const tracks = found.filter((track) => track.kind === "audio");
    if (tracks.length) await this.setQueue(tracks, 0);
  }

  private async loadPaths(paths: string[], replace: boolean) {
    const audioPaths = paths.filter((p) =>
      AUDIO_EXTS.includes(p.split(".").pop()?.toLowerCase() ?? ""),
    );
    if (audioPaths.length === 0) return;
    const tracks = await invoke<TrackMeta[]>("read_metadata_batch", {
      paths: audioPaths,
    });
    if (replace) {
      await this.setQueue(tracks, 0);
    } else {
      await this.addToQueue(tracks);
    }
  }
}

export const player = new Player();

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
