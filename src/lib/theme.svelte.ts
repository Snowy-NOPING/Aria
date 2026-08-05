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
  {
    id: "opaque",
    label: "Solid",
    // Skin-neutral: under Aria this surface is the artwork field, under Claude
    // it's flat paper. Either way the choice is "nothing shows through".
    hint: "Nothing shows through — the theme paints its own surface.",
  },
  { id: "mica", label: "Mica", hint: "Desktop wallpaper, blurred by Windows." },
  { id: "mica-alt", label: "Mica Alt", hint: "Stronger, more tinted Mica." },
  { id: "acrylic", label: "Acrylic", hint: "Translucent blur of what's behind." },
  {
    id: "external",
    label: "Mica For Everyone",
    hint: "Apply nothing — let Mica For Everyone own the backdrop.",
  },
];

/**
 * Visual skin — the palette, type and surface treatment.
 *
 * - `aria`   — the house look: artwork-driven colour, frosted chrome, springy motion.
 * - `claude` — claude.ai / Claude Desktop: warm paper surfaces, clay accent, flat
 *              chrome and hairline rules. Fixed palette, so artwork never
 *              repaints the accents and the colour field is not painted at all.
 */
export type Skin = "aria" | "claude";

export const SKINS: { id: Skin; label: string; hint: string }[] = [
  {
    id: "aria",
    label: "Aria",
    hint: "Album colour fills the window behind frosted chrome.",
  },
  {
    id: "claude",
    label: "Claude",
    hint: "Warm paper and clay, flat surfaces, serif headings.",
  },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

class Theme {
  skin = $state<Skin>("aria");
  backdrop = $state<Backdrop>("opaque");
  /** Opacity of the artwork colour wash drawn over the backdrop (0–1). */
  wash = $state(1);

  /** Last error from applying a native effect (unsupported build of Windows). */
  lastError = $state("");

  /** Temporarily forced opaque (immersive mode) without losing the choice. */
  suspended = $state(false);

  /** What's actually applied right now, honouring a suspend. */
  get effective(): Backdrop {
    return this.suspended ? "opaque" : this.backdrop;
  }

  /** True when the window is see-through and something behind it shows. */
  get translucent() {
    return this.effective !== "opaque";
  }

  /**
   * Whether the skin paints Aria's artwork colour field. The Claude skin is a
   * fixed palette on flat paper, so the blob wash and the artwork wash slider
   * have nothing to act on.
   */
  get artworkField() {
    return this.skin === "aria";
  }

  load() {
    try {
      const s = localStorage.getItem("aria.skin") as Skin | null;
      if (s && SKINS.some((o) => o.id === s)) this.skin = s;
      const b = localStorage.getItem("aria.backdrop") as Backdrop | null;
      if (b && BACKDROPS.some((o) => o.id === b)) this.backdrop = b;
      const w = localStorage.getItem("aria.wash");
      if (w !== null) this.wash = clamp01(+w);
      else if (this.backdrop !== "opaque") this.wash = 0.55;
    } catch {
      /* first run / storage blocked — defaults are fine */
    }
    this.apply();
  }

  setSkin(skin: Skin) {
    if (this.skin === skin) return;
    this.skin = skin;
    this.persist();
    this.applyCss();
  }

  async setBackdrop(backdrop: Backdrop) {
    // Compare the chosen values, not the effective ones — a suspend must not
    // make this look like a switch to opaque and reset the wash.
    const wasTranslucent = this.backdrop !== "opaque";
    const nowTranslucent = backdrop !== "opaque";
    this.backdrop = backdrop;
    // Moving between opaque and see-through wants a different default wash:
    // full strength when we're the only thing painting, dialled back when the
    // backdrop needs to read through it.
    if (wasTranslucent !== nowTranslucent) {
      this.wash = nowTranslucent ? 0.55 : 1;
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
      localStorage.setItem("aria.skin", this.skin);
      localStorage.setItem("aria.backdrop", this.backdrop);
      localStorage.setItem("aria.wash", String(this.wash));
    } catch {
      /* ignore */
    }
  }

  private applyCss() {
    const root = document.documentElement;
    root.dataset.skin = this.skin;
    root.dataset.backdrop = this.effective;
    root.dataset.translucent = String(this.translucent);
    // Inline wins over the stylesheet, so a skin with no colour field must not
    // leave a stale wash behind for its own surfaces to read.
    if (this.artworkField) {
      root.style.setProperty("--wash-opacity", String(this.wash));
    } else {
      root.style.removeProperty("--wash-opacity");
    }
  }

  /** Drop the backdrop without forgetting the user's choice (immersive mode). */
  async suspend() {
    if (this.suspended) return;
    this.suspended = true;
    await this.apply();
  }

  /** Restore the saved backdrop after a suspend. */
  async resume() {
    if (!this.suspended) return;
    this.suspended = false;
    await this.apply();
  }

  /** Push the current choice to CSS and to the native window. */
  async apply() {
    this.applyCss();
    try {
      await invoke("set_backdrop", { kind: this.effective });
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
