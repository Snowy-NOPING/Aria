// Resizable panel sizes, persisted to localStorage.

import { ui } from "./ui.svelte";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

class Layout {
  sidebarWidth = $state(242);
  lyricsArtWidth = $state(340);
  /** Window width, kept current by the shell so layout can react to it. */
  viewportWidth = $state(1280);

  /** Collapse the sidebar to an icon rail when the library would otherwise be
   *  squeezed into a sliver — either the window is small outright, or a side
   *  panel is open and there isn't room for both. */
  get rail() {
    if (this.viewportWidth <= 900) return true;
    return ui.sidePanel !== "none" && this.viewportWidth <= 1100;
  }

  setViewport(width: number) {
    this.viewportWidth = width;
  }

  load() {
    try {
      const s = localStorage.getItem("aria.sidebarWidth");
      const l = localStorage.getItem("aria.lyricsArtWidth");
      if (s) this.sidebarWidth = clamp(+s, 170, 460);
      if (l) this.lyricsArtWidth = clamp(+l, 220, 620);
    } catch {
      /* ignore */
    }
  }

  setSidebar(px: number) {
    this.sidebarWidth = clamp(px, 170, 460);
    try {
      localStorage.setItem("aria.sidebarWidth", String(this.sidebarWidth));
    } catch {
      /* ignore */
    }
  }

  setLyricsArt(px: number) {
    this.lyricsArtWidth = clamp(px, 220, 620);
    try {
      localStorage.setItem("aria.lyricsArtWidth", String(this.lyricsArtWidth));
    } catch {
      /* ignore */
    }
  }
}

export const layout = new Layout();
