import { getCurrentWindow } from "@tauri-apps/api/window";

/** Immersive / full-screen now-playing mode (Cider-style). */
class UI {
  immersive = $state(false);
  /** Side panels inside immersive. */
  panel = $state<"none" | "queue" | "lyrics">("none");
  /** Remembers which immersive panel was last shown, so reopening (e.g. by
   * clicking the artwork) restores it instead of always defaulting. */
  lastPanel = $state<"queue" | "lyrics">("lyrics");
  /** Library browser overlay inside immersive mode. */
  browserOpen = $state(false);
  /** Persistent panel beside the normal library view. */
  sidePanel = $state<"none" | "queue" | "lyrics">("lyrics");

  async enter() {
    try {
      await getCurrentWindow().setFullscreen(true);
    } catch {
      /* fullscreen may be unavailable; overlay still works */
    }
    this.immersive = true;
  }

  async exit() {
    try {
      await getCurrentWindow().setFullscreen(false);
    } catch {
      /* ignore */
    }
    this.immersive = false;
    this.panel = "none";
    this.browserOpen = false;
  }

  async toggle() {
    if (this.immersive) await this.exit();
    else await this.enter();
  }

  togglePanel(p: "queue" | "lyrics") {
    this.panel = this.panel === p ? "none" : p;
    if (this.panel !== "none") this.lastPanel = this.panel;
  }

  /** Opens the last-used immersive panel (lyrics by default), or closes it. */
  toggleArtworkPanel() {
    this.panel = this.panel === "none" ? this.lastPanel : "none";
  }

  toggleBrowser() {
    this.browserOpen = !this.browserOpen;
  }

  toggleSidePanel(panel: "queue" | "lyrics") {
    this.sidePanel = this.sidePanel === panel ? "none" : panel;
  }
}

export const ui = new UI();
