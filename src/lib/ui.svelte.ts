import { getCurrentWindow } from "@tauri-apps/api/window";
import { theme } from "./theme.svelte";

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

  /** Whether the window was already maximized before immersive took over. */
  private wasMaximized = false;

  async enter() {
    const appWindow = getCurrentWindow();
    try {
      // Maximize rather than go fullscreen: an undecorated maximized window
      // fills the work area, which keeps the taskbar visible and reachable.
      this.wasMaximized = await appWindow.isMaximized();
      if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
      if (!this.wasMaximized) await appWindow.maximize();
    } catch {
      /* window sizing may be unavailable; the overlay still works */
    }
    // Immersive is its own opaque world — a Mica/Acrylic backdrop behind it
    // would only bleed at the edges, so it's suspended until we exit.
    await theme.suspend();
    this.immersive = true;
  }

  async exit() {
    const appWindow = getCurrentWindow();
    try {
      await appWindow.setFullscreen(false);
      if (!this.wasMaximized) await appWindow.unmaximize();
    } catch {
      /* ignore */
    }
    await theme.resume();
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
