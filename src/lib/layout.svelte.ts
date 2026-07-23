// Resizable panel sizes, persisted to localStorage.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

class Layout {
  sidebarWidth = $state(242);
  lyricsArtWidth = $state(340);

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
