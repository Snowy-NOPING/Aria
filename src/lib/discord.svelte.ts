import { invoke } from "@tauri-apps/api/core";
import type { TrackMeta } from "./player.svelte";

interface DiscordView {
  app_id: string;
  effective_app_id: string;
  using_default: boolean;
  enabled: boolean;
  connected: boolean;
  last_error: string;
}

/**
 * Discord Rich Presence settings and status.
 *
 * Aria ships its own application ID, so this works with nothing configured.
 * `appId` is an optional override for anyone who wants the card published under
 * their own application name and art. Stored in Rust beside the Last.fm
 * credentials.
 */
class Discord {
  /** Blank means "use the built-in application". */
  appId = $state("");
  usingDefault = $state(true);
  enabled = $state(true);
  connected = $state(false);
  lastError = $state("");
  busy = $state(false);
  notice = $state("");

  private loaded = false;
  /** Set once presence has been off and cleared, so we don't clear repeatedly. */
  private cleared = true;

  private apply(view: DiscordView) {
    this.appId = view.app_id;
    this.usingDefault = view.using_default;
    this.enabled = view.enabled;
    this.connected = view.connected;
    this.lastError = view.last_error;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.apply(await invoke<DiscordView>("discord_get_state"));
    } catch {
      /* first run — defaults are fine */
    }
  }

  async save() {
    this.busy = true;
    this.notice = "";
    try {
      this.apply(
        await invoke<DiscordView>("discord_save_settings", {
          appId: this.appId.trim(),
          enabled: this.enabled,
        }),
      );
      this.cleared = !this.enabled;
      this.notice = this.enabled
        ? this.usingDefault
          ? "Rich Presence on, using Aria's built-in application."
          : "Rich Presence on, using your application."
        : "Rich Presence off.";
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  /** Publish (or withdraw) the card. Safe to call on every playback tick — the
   *  Rust side drops updates identical to the last one it sent. */
  sync(track: TrackMeta | null, playing: boolean, position: number) {
    if (!this.enabled) {
      // Withdraw once when presence is switched off mid-session.
      if (!this.cleared) {
        this.cleared = true;
        void invoke("discord_clear_activity").catch(() => {});
      }
      return;
    }
    if (!track) {
      if (!this.cleared) {
        this.cleared = true;
        void invoke("discord_clear_activity").catch(() => {});
      }
      return;
    }

    this.cleared = false;
    void invoke("discord_set_activity", {
      track: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        position,
        playing,
      },
    })
      .then(() => this.refreshStatus())
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
  }

  /** Connection state changes underneath us (Discord quitting, or starting
   *  later), so mirror it back for the Settings badge — but only when it
   *  actually differs, to avoid pointless reactivity every second. */
  private async refreshStatus() {
    try {
      const view = await invoke<DiscordView>("discord_get_state");
      if (view.connected !== this.connected) this.connected = view.connected;
      if (view.last_error !== this.lastError) this.lastError = view.last_error;
    } catch {
      /* ignore */
    }
  }
}

export const discord = new Discord();
