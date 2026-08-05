//! User-tunable knobs for the karaoke lyric rendering.
//!
//! Values reach the DOM as custom properties on `:root`, the same mechanism
//! `theme` uses for `--wash-opacity`. The lyric surfaces (panel, immersive,
//! now-playing) hardcode their own `--lyric-*` presentation knobs, so these
//! deliberately use a separate `--lyric-fx-*` namespace and layer on top
//! rather than fighting those overrides.

/** Seconds a finished line lingers at 100%. */
export const HOLD_BASE_SECONDS = 0.6;

export type LyricFxKey =
  | "hold"
  | "emphasis"
  | "glow"
  | "lift"
  | "speed"
  | "inactiveScale"
  | "fillSoftness"
  | "cascade";

export interface LyricFxKnob {
  key: LyricFxKey;
  label: string;
  hint: string;
  /** CSS custom property written to `:root`. */
  prop: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
}

export const LYRIC_FX: LyricFxKnob[] = [
  {
    key: "hold",
    label: "Line Hold",
    hint: "How long a finished line stays lit as the next one begins.",
    prop: "--lyric-fx-hold",
    min: 0,
    max: 2,
    step: 0.01,
    fallback: 1,
  },
  {
    key: "emphasis",
    label: "Emphasis Strength",
    hint: "Scale/bump applied to long-held words.",
    prop: "--lyric-fx-emphasis",
    min: 0,
    max: 2,
    step: 0.01,
    fallback: 1,
  },
  {
    key: "glow",
    label: "Glow Strength",
    hint: "Intensity of the white glow on emphasized words.",
    prop: "--lyric-fx-glow",
    min: 0,
    max: 2,
    step: 0.01,
    fallback: 1.51,
  },
  {
    key: "lift",
    label: "Word Lift",
    hint: "How far each word rises as it is sung.",
    prop: "--lyric-fx-lift",
    min: 0,
    max: 2,
    step: 0.01,
    fallback: 1,
  },
  {
    key: "speed",
    label: "Animation Speed",
    hint: "Line-transition spring speed — higher is snappier.",
    prop: "--lyric-fx-speed",
    min: 0.25,
    max: 2,
    step: 0.01,
    fallback: 1,
  },
  {
    key: "inactiveScale",
    label: "Inactive Line Scale",
    hint: "Size of non-active lines; lower makes the active line stand out more.",
    prop: "--lyric-fx-inactive-scale",
    min: 0.6,
    max: 1,
    step: 0.01,
    fallback: 0.8,
  },
  {
    key: "fillSoftness",
    label: "Fill Softness",
    hint: "Softness of the karaoke fill edge.",
    prop: "--lyric-fx-fill-softness",
    min: 0,
    max: 4,
    step: 0.01,
    fallback: 1,
  },
  {
    key: "cascade",
    label: "Cascade Intensity",
    hint: "How pronounced the staggered line-by-line entry is.",
    prop: "--lyric-fx-cascade",
    min: 0,
    max: 4,
    step: 0.01,
    fallback: 1,
  },
];

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;

class LyricsStyle {
  hold = $state(1);
  emphasis = $state(1);
  glow = $state(1.51);
  lift = $state(1);
  speed = $state(1);
  inactiveScale = $state(0.8);
  fillSoftness = $state(1);
  cascade = $state(1);

  load() {
    for (const knob of LYRIC_FX) {
      try {
        const raw = localStorage.getItem(`aria.lyricFx.${knob.key}`);
        if (raw !== null) this[knob.key] = clamp(+raw, knob.min, knob.max);
      } catch {
        /* first run / storage blocked — defaults are fine */
      }
    }
    this.applyCss();
  }

  set(key: LyricFxKey, value: number) {
    const knob = LYRIC_FX.find((k) => k.key === key);
    if (!knob) return;
    this[key] = clamp(value, knob.min, knob.max);
    this.persist();
    this.applyCss();
  }

  /** Restore every knob to the shipped default. */
  reset() {
    for (const knob of LYRIC_FX) this[knob.key] = knob.fallback;
    this.persist();
    this.applyCss();
  }

  get isDefault(): boolean {
    return LYRIC_FX.every((knob) => this[knob.key] === knob.fallback);
  }

  private persist() {
    try {
      for (const knob of LYRIC_FX) {
        localStorage.setItem(`aria.lyricFx.${knob.key}`, String(this[knob.key]));
      }
    } catch {
      /* ignore */
    }
  }

  private applyCss() {
    const root = document.documentElement;
    for (const knob of LYRIC_FX) {
      root.style.setProperty(knob.prop, String(this[knob.key]));
    }
  }
}

export const lyricsStyle = new LyricsStyle();
