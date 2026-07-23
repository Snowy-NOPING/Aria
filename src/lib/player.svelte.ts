import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { library } from "./library.svelte";
import { lastfm } from "./lastfm.svelte";

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
  waveformLevels = $state([0, 0, 0, 0, 0]);

  /** True while the user is dragging the seek bar (suppress incoming updates). */
  scrubbing = $state(false);

  /** off → repeat the whole context (queue/album/playlist) → repeat one. */
  repeat = $state<"off" | "all" | "one">("off");
  shuffled = $state(false);

  private initialized = false;

  /** Web-backend playback for formats rodio can't decode (e.g. Opus). */
  private audio: HTMLAudioElement | null = null;
  private usingWeb = false;
  private raf = 0;
  private audioContext: AudioContext | null = null;
  private webAnalyser: AnalyserNode | null = null;
  private webWaveData: Uint8Array | null = null;
  private smoothedLevel = 0;
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
      if (s.playing) this.updateWaveform(s.level);
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
      if (this.loaded) this.syncSmtcPlayback();
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

  private updateWaveform(rawLevel: number) {
    const target = this.playing ? Math.max(0, Math.min(1, rawLevel)) : 0;
    const smoothing = target > this.smoothedLevel ? 0.58 : 0.24;
    this.smoothedLevel += (target - this.smoothedLevel) * smoothing;
    this.waveformLevels = [
      this.waveformLevels[1],
      this.waveformLevels[2],
      this.waveformLevels[3],
      this.waveformLevels[4],
      this.smoothedLevel,
    ];
  }

  private clearWaveform() {
    this.smoothedLevel = 0;
    this.waveformLevels = [0, 0, 0, 0, 0];
  }

  private ensureWebAnalyser() {
    if (!this.audio || this.webAnalyser) return;
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(this.audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.45;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.audioContext = context;
      this.webAnalyser = analyser;
      this.webWaveData = new Uint8Array(analyser.fftSize);
    } catch (error) {
      // Analysis must never block playback if a WebView lacks Web Audio.
      console.warn("real-time waveform analyser unavailable:", error);
    }
  }

  private sampleWebWaveform() {
    if (!this.webAnalyser || !this.webWaveData) return;
    this.webAnalyser.getByteTimeDomainData(this.webWaveData);
    let sumSquares = 0;
    for (const byte of this.webWaveData) {
      const sample = (byte - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.webWaveData.length);
    this.updateWaveform(Math.min(1, Math.pow(rms, 0.45) * 1.7));
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
    this.syncSmtcPlayback();
  }

  async next() {
    if (this.currentIndex + 1 < this.queue.length) {
      await this.playIndex(this.currentIndex + 1);
    } else if (this.repeat === "all" && this.queue.length > 0) {
      // Loop the context back to the top.
      await this.playIndex(0);
    } else {
      // End of queue — silence both backends.
      await invoke("stop");
      await this.stopWeb();
      this.playing = false;
    }
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
      setTimeout(() => this.syncSmtcPlayback(), 50);
      return;
    }
    if (this.playing) {
      await invoke("pause");
    } else {
      await invoke("play");
    }
    setTimeout(() => this.syncSmtcPlayback(), 50);
  }

  // --- System media controls (SMTC) ----------------------------------------

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

  private syncSmtcPlayback() {
    invoke("smtc_playback", { playing: this.playing, position: this.position });
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
    this.syncSmtcPlayback();
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
