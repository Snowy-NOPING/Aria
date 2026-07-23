import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TrackMeta } from "./player.svelte";

interface LastFmView {
  api_key: string;
  has_secret: boolean;
  connected: boolean;
  username: string;
  awaiting_approval: boolean;
  scrobbling_enabled: boolean;
  now_playing_enabled: boolean;
  pending_scrobbles: number;
  last_error: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trackPayload(track: TrackMeta) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    album_artist: track.album_artist,
    track_number: track.track_number,
    duration: track.duration,
  };
}

class LastFm {
  apiKey = $state("");
  hasSecret = $state(false);
  connected = $state(false);
  username = $state("");
  awaitingApproval = $state(false);
  scrobblingEnabled = $state(true);
  nowPlayingEnabled = $state(true);
  pendingScrobbles = $state(0);
  lastError = $state<string | null>(null);
  busy = $state(false);
  notice = $state("");

  private loaded = false;

  private apply(view: LastFmView) {
    this.apiKey = view.api_key;
    this.hasSecret = view.has_secret;
    this.connected = view.connected;
    this.username = view.username;
    this.awaitingApproval = view.awaiting_approval;
    this.scrobblingEnabled = view.scrobbling_enabled;
    this.nowPlayingEnabled = view.now_playing_enabled;
    this.pendingScrobbles = view.pending_scrobbles;
    this.lastError = view.last_error;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.apply(await invoke<LastFmView>("lastfm_get_state"));
      if (this.connected && this.pendingScrobbles > 0) void this.flush();
    } catch (error) {
      this.lastError = errorText(error);
    }
    window.addEventListener("online", () => void this.flush());
  }

  async saveSettings(secret = "", announce = true): Promise<boolean> {
    this.busy = true;
    this.lastError = null;
    try {
      const view = await invoke<LastFmView>("lastfm_save_settings", {
        apiKey: this.apiKey,
        apiSecret: secret,
        scrobblingEnabled: this.scrobblingEnabled,
        nowPlayingEnabled: this.nowPlayingEnabled,
      });
      this.apply(view);
      if (announce) this.notice = "Last.fm settings saved.";
      return true;
    } catch (error) {
      this.lastError = errorText(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async beginAuth(secret: string) {
    this.notice = "";
    if (!(await this.saveSettings(secret, false))) return;
    this.busy = true;
    try {
      const url = await invoke<string>("lastfm_begin_auth");
      this.awaitingApproval = true;
      this.notice = "Approve Aria in your browser, then return here.";
      await openUrl(url);
    } catch (error) {
      this.lastError = errorText(error);
    } finally {
      this.busy = false;
    }
  }

  async finishAuth() {
    this.busy = true;
    this.lastError = null;
    try {
      this.apply(await invoke<LastFmView>("lastfm_finish_auth"));
      this.notice = this.username
        ? `Connected to Last.fm as ${this.username}.`
        : "Connected to Last.fm.";
      void this.flush();
    } catch (error) {
      this.lastError = errorText(error);
    } finally {
      this.busy = false;
    }
  }

  async disconnect() {
    this.busy = true;
    this.lastError = null;
    try {
      this.apply(await invoke<LastFmView>("lastfm_disconnect"));
      this.notice = "Last.fm disconnected. API credentials remain saved locally.";
    } catch (error) {
      this.lastError = errorText(error);
    } finally {
      this.busy = false;
    }
  }

  async trackStarted(track: TrackMeta) {
    await this.load();
    if (!this.connected) return;
    // A successful network call is also a good opportunity to drain anything
    // that was queued while offline.
    if (this.pendingScrobbles > 0) void this.flush();
    if (!this.nowPlayingEnabled) return;
    try {
      this.apply(
        await invoke<LastFmView>("lastfm_now_playing", {
          track: trackPayload(track),
        }),
      );
    } catch (error) {
      this.lastError = errorText(error);
    }
  }

  async scrobble(track: TrackMeta, timestamp: number) {
    await this.load();
    if (!this.connected || !this.scrobblingEnabled) return;
    try {
      this.apply(
        await invoke<LastFmView>("lastfm_queue_scrobble", {
          track: trackPayload(track),
          timestamp,
        }),
      );
    } catch (error) {
      this.lastError = errorText(error);
    }
  }

  async flush() {
    await this.load();
    if (!this.connected || !this.scrobblingEnabled) return;
    try {
      this.apply(await invoke<LastFmView>("lastfm_flush_queue"));
      if (this.pendingScrobbles === 0) this.notice = "Offline scrobble queue is clear.";
    } catch (error) {
      this.lastError = errorText(error);
    }
  }
}

export const lastfm = new LastFm();
