import { invoke } from "@tauri-apps/api/core";

/**
 * Window backdrop options.
 *
 * - `opaque`   — Aria paints its own solid artwork field (previous behaviour).
 * - `mica`     — DWM Mica: the desktop wallpaper, heavily blurred by the OS.
 * - `mica-alt` — DWM Tabbed/Mica Alt: a stronger, more tinted variant.
 * - `acrylic`  — DWM Acrylic: translucent, samples whatever is behind the window.
 * - `external` — apply nothing native, just go transparent so an external
 *                compositor (Mica For Everyone) supplies the backdrop.
 */
export type Backdrop = "opaque" | "mica" | "mica-alt" | "acrylic" | "external";

export const BACKDROPS: { id: Backdrop; label: string; hint: string }[] = [
  { id: "opaque", label: "Solid", hint: "Aria paints its own artwork field." },
  { id: "mica", label: "Mica", hint: "Desktop wallpaper, blurred by Windows." },
  { id: "mica-alt", label: "Mica Alt", hint: "Stronger, more tinted Mica." },
  { id: "acrylic", label: "Acrylic", hint: "Translucent blur of what's behind." },
  {
    id: "external",
    label: "Mica For Everyone",
    hint: "Apply nothing — let Mica For Everyone own the backdrop.",
  },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

class Theme {
  backdrop = $state<Backdrop>("opaque");
  /** Opacity of the artwork colour wash drawn over the backdrop (0–1). */
  wash = $state(1);

  /** Last error from applying a native effect (unsupported build of Windows). */
  lastError = $state("");

  /** True when the window is see-through and something behind it shows. */
  get translucent() {
    return this.backdrop !== "opaque";
  }

  load() {
    try {
      const b = localStorage.getItem("aria.backdrop") as Backdrop | null;
      if (b && BACKDROPS.some((o) => o.id === b)) this.backdrop = b;
      const w = localStorage.getItem("aria.wash");
      if (w !== null) this.wash = clamp01(+w);
      else if (this.translucent) this.wash = 0.55;
    } catch {
      /* first run / storage blocked — defaults are fine */
    }
    this.apply();
  }

  async setBackdrop(backdrop: Backdrop) {
    const wasTranslucent = this.translucent;
    this.backdrop = backdrop;
    // Moving between opaque and see-through wants a different default wash:
    // full strength when we're the only thing painting, dialled back when the
    // backdrop needs to read through it.
    if (wasTranslucent !== this.translucent) {
      this.wash = this.translucent ? 0.55 : 1;
    }
    this.persist();
    await this.apply();
  }

  setWash(value: number) {
    this.wash = clamp01(value);
    this.persist();
    this.applyCss();
  }

  private persist() {
    try {
      localStorage.setItem("aria.backdrop", this.backdrop);
      localStorage.setItem("aria.wash", String(this.wash));
    } catch {
      /* ignore */
    }
  }

  private applyCss() {
    const root = document.documentElement;
    root.dataset.backdrop = this.backdrop;
    root.dataset.translucent = String(this.translucent);
    root.style.setProperty("--wash-opacity", String(this.wash));
  }

  /** Push the current choice to CSS and to the native window. */
  async apply() {
    this.applyCss();
    try {
      await invoke("set_backdrop", { kind: this.backdrop });
      this.lastError = "";
    } catch (error) {
      // A missing DWM backdrop must never break the app — we simply stay
      // transparent and whatever is behind the window shows through.
      this.lastError = String(error);
      console.warn("backdrop unavailable:", error);
    }
  }
}

export const theme = new Theme();
