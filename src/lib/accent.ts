// Build a compact colour palette from album/song artwork using a tiny
// offscreen canvas. Artwork is stored as data URIs, so the canvas is not
// cross-origin tainted.

export interface ArtworkPalette {
  accent: string;
  accentLight: string;
  primary: string;
  secondary: string;
  tertiary: string;
  deep: string;
}

export const DEFAULT_ARTWORK_PALETTE: ArtworkPalette = {
  accent: "rgb(182, 141, 93)",
  accentLight: "rgb(216, 177, 128)",
  primary: "rgb(182, 141, 93)",
  secondary: "rgb(122, 75, 100)",
  tertiary: "rgb(71, 62, 113)",
  deep: "rgb(24, 18, 24)",
};

type Rgb = [number, number, number];
type HueBucket = {
  r: number;
  g: number;
  b: number;
  weight: number;
  saturation: number;
};

const paletteCache = new Map<string, ArtworkPalette | null>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function cssRgb([r, g, b]: Rgb): string {
  return `rgb(${Math.round(Math.max(0, Math.min(255, r)))}, ${Math.round(
    Math.max(0, Math.min(255, g)),
  )}, ${Math.round(Math.max(0, Math.min(255, b)))})`;
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

function tuneColour(rgb: Rgb, lightnessShift = 0): Rgb {
  const [h, s, l] = rgbToHsl(...rgb);
  return hslToRgb(
    h,
    Math.max(0.48, Math.min(0.9, s)),
    Math.max(0.28, Math.min(0.56, l + lightnessShift)),
  );
}

function createPalette(data: Uint8ClampedArray): ArtworkPalette | null {
  const bucketCount = 18;
  const buckets: HueBucket[] = Array.from({ length: bucketCount }, () => ({
    r: 0,
    g: 0,
    b: 0,
    weight: 0,
    saturation: 0,
  }));

  let averageR = 0;
  let averageG = 0;
  let averageB = 0;
  let averageWeight = 0;
  let mostVivid: Rgb | null = null;
  let vividScore = -1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    if (alpha < 128) continue;

    const [h, saturation, lightness] = rgbToHsl(r, g, b);
    const midtone = lightness > 0.08 && lightness < 0.92;
    const pixelWeight = (0.2 + saturation * 1.8) * (midtone ? 1 : 0.18);

    averageR += r * pixelWeight;
    averageG += g * pixelWeight;
    averageB += b * pixelWeight;
    averageWeight += pixelWeight;

    if (saturation > 0.12 && midtone) {
      const index = Math.min(bucketCount - 1, Math.floor(h / (360 / bucketCount)));
      const bucket = buckets[index];
      bucket.r += r * pixelWeight;
      bucket.g += g * pixelWeight;
      bucket.b += b * pixelWeight;
      bucket.weight += pixelWeight;
      bucket.saturation += saturation * pixelWeight;
    }

    const score = saturation * (0.45 + lightness * 0.55) * (midtone ? 1 : 0.15);
    if (score > vividScore) {
      vividScore = score;
      mostVivid = [r, g, b];
    }
  }

  if (averageWeight === 0) return null;
  const average: Rgb = [
    averageR / averageWeight,
    averageG / averageWeight,
    averageB / averageWeight,
  ];

  const candidates = buckets
    .map((bucket) => {
      if (!bucket.weight) return null;
      const rgb: Rgb = [
        bucket.r / bucket.weight,
        bucket.g / bucket.weight,
        bucket.b / bucket.weight,
      ];
      const [h] = rgbToHsl(...rgb);
      return {
        rgb,
        hue: h,
        score: bucket.weight * (0.65 + bucket.saturation / bucket.weight),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => b.score - a.score);

  const selected: Rgb[] = [];
  const selectedHues: number[] = [];
  for (const candidate of candidates) {
    if (selectedHues.every((hue) => hueDistance(hue, candidate.hue) >= 32)) {
      selected.push(candidate.rgb);
      selectedHues.push(candidate.hue);
    }
    if (selected.length === 3) break;
  }

  const base = selected[0] ?? average;
  const [baseHue, baseSaturation] = rgbToHsl(...base);
  while (selected.length < 3) {
    const offset = selected.length === 1 ? 78 : 218;
    selected.push(
      hslToRgb(
        (baseHue + offset) % 360,
        Math.max(0.45, baseSaturation * 0.82),
        selected.length === 1 ? 0.42 : 0.36,
      ),
    );
  }

  const vivid = mostVivid ?? base;
  const [accentHue, accentSaturation] = rgbToHsl(...vivid);
  const accentRgb = hslToRgb(
    accentHue,
    Math.max(0.55, Math.min(1, accentSaturation)),
    0.56,
  );
  const accentLightRgb = hslToRgb(
    accentHue,
    Math.max(0.5, Math.min(0.92, accentSaturation)),
    0.69,
  );

  return {
    accent: cssRgb(accentRgb),
    accentLight: cssRgb(accentLightRgb),
    primary: cssRgb(tuneColour(selected[0], 0.02)),
    secondary: cssRgb(tuneColour(selected[1])),
    tertiary: cssRgb(tuneColour(selected[2], -0.04)),
    deep: cssRgb(hslToRgb(baseHue, Math.max(0.22, baseSaturation * 0.55), 0.1)),
  };
}

export function extractArtworkPalette(dataUri: string): Promise<ArtworkPalette | null> {
  if (paletteCache.has(dataUri)) {
    return Promise.resolve(paletteCache.get(dataUri) ?? null);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sampleSize = 40;
      const canvas = document.createElement("canvas");
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const context = canvas.getContext("2d");
      if (!context) {
        paletteCache.set(dataUri, null);
        resolve(null);
        return;
      }

      context.drawImage(img, 0, 0, sampleSize, sampleSize);
      try {
        const palette = createPalette(
          context.getImageData(0, 0, sampleSize, sampleSize).data,
        );
        paletteCache.set(dataUri, palette);
        resolve(palette);
      } catch {
        paletteCache.set(dataUri, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      paletteCache.set(dataUri, null);
      resolve(null);
    };
    img.src = dataUri;
  });
}

/** Compatibility helper for callers that only need the two accent colours. */
export async function extractAccent(dataUri: string): Promise<[string, string] | null> {
  const palette = await extractArtworkPalette(dataUri);
  return palette ? [palette.accent, palette.accentLight] : null;
}
