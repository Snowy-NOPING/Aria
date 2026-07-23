import { getCurrentWindow } from "@tauri-apps/api/window";

/** Immersive / full-screen now-playing mode (Cider-style). */
class UI {
  immersive = $state(false);
  /** Side panels inside immersive. */
  panel = $state<"none" | "queue" | "lyrics">("none");
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
  }

  async toggle() {
    if (this.immersive) await this.exit();
    else await this.enter();
  }

  togglePanel(p: "queue" | "lyrics") {
    this.panel = this.panel === p ? "none" : p;
  }

  toggleSidePanel(panel: "queue" | "lyrics") {
    this.sidePanel = this.sidePanel === panel ? "none" : panel;
  }
}

export const ui = new UI();
