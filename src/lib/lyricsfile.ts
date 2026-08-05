//! Reader for the Lyricsfile format (https://github.com/tranxuanthang/lyricsfile),
//! the YAML lyrics container introduced by LRCGET 2.0 that carries optional
//! word-level timing. Draft spec 1.0.
//!
//! Everything here is defensive: a lyrics file is untrusted user data, so a
//! malformed document throws a descriptive error rather than half-loading.

import { parse as parseYaml } from "yaml";
import type { LyricLine, LyricWord } from "./lyrics.svelte";

/** Spec §8: readers must not treat an unknown version as 1.0. */
const SUPPORTED_VERSION = "1.0";

/** Spec §10: apply reasonable limits to document size and alias expansion. */
const MAX_CHARS = 4 * 1024 * 1024;
const MAX_ALIAS_COUNT = 10;

export interface LyricsFile {
  title: string;
  artist: string;
  album: string;
  language: string;
  /** Track duration in seconds, or 0 when the file omits it. */
  duration: number;
  instrumental: boolean;
  /** Sorted by start time. Empty when the file has no synchronized lines. */
  lines: LyricLine[];
  /** Unsynchronized fallback lyrics, with line breaks preserved. */
  plain: string;
}

/**
 * True for names using the format's `.lyricsfile.yaml` double extension.
 * Tauri's file dialog only filters on the final extension, so plain `.yaml`
 * files are accepted too and validated by content.
 */
export function isLyricsFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".lyricsfile.yaml");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Convert a spec millisecond field to seconds, which is what the player uses. */
function ms(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`${what} must be an integer number of milliseconds`);
  }
  if (v < 0) throw new Error(`${what} must not be negative`);
  return v / 1000;
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw new Error(`${what} must be a string`);
  return v;
}

function optStr(v: unknown, what: string): string {
  return v == null ? "" : str(v, what);
}

/** A word plus whether the file gave it an explicit end, so gaps can be filled. */
interface DraftWord extends LyricWord {
  explicitEnd: boolean;
}

function parseWords(raw: unknown, where: string): DraftWord[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where} words must be a sequence`);

  const words: DraftWord[] = [];
  raw.forEach((item, i) => {
    const at = `${where} word ${i + 1}`;
    if (!isRecord(item)) throw new Error(`${at} must be a mapping`);
    const text = str(item.text, `${at} text`);
    const t = ms(item.start_ms, `${at} start_ms`);
    const explicitEnd = item.end_ms != null;
    const end = explicitEnd ? ms(item.end_ms, `${at} end_ms`) : t;
    if (end < t) throw new Error(`${at} end_ms must not precede start_ms`);
    words.push({ t, end, text, explicitEnd });
  });

  // Spec §5: writers *should* order words by start_ms, so readers can't assume it.
  words.sort((a, b) => a.t - b.t);
  return words;
}

interface DraftLine extends LyricLine {
  end: number;
  explicitEnd: boolean;
}

/**
 * Fill in end times the file left out. Spec §4/§5 leave this to the reader, so
 * we stretch each item to the next one's start and clamp the final item to its
 * container — enough for a highlight to run without inventing long tails.
 */
function fillEnds<T extends { t: number; end: number; explicitEnd: boolean }>(
  items: T[],
  fallbackEnd: number,
) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].explicitEnd) continue;
    const next = i + 1 < items.length ? items[i + 1].t : fallbackEnd;
    items[i].end = Math.max(items[i].t, next);
  }
}

/**
 * Parse a Lyricsfile document. Throws on anything the spec calls invalid.
 * `duration` (seconds, 0 if unknown) is only used to bound a trailing line
 * whose `end_ms` was omitted.
 */
export function parseLyricsFile(text: string, duration = 0): LyricsFile {
  if (text.length > MAX_CHARS) throw new Error("lyrics file is too large");

  // Safe load: no custom tags are resolved, duplicate keys are rejected rather
  // than silently last-wins, and alias expansion is bounded (spec §1, §10).
  const doc: unknown = parseYaml(text, {
    uniqueKeys: true,
    maxAliasCount: MAX_ALIAS_COUNT,
  });
  if (!isRecord(doc)) throw new Error("lyrics file must contain a YAML mapping");

  const version = str(doc.version, "version");
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`unsupported lyricsfile version "${version}"`);
  }

  if (!isRecord(doc.metadata)) throw new Error("metadata must be a mapping");
  const meta = doc.metadata;
  const instrumental = meta.instrumental === true;
  const durationMs = meta.duration_ms == null ? 0 : ms(meta.duration_ms, "duration_ms");

  const lines: DraftLine[] = [];
  if (doc.lines != null) {
    if (!Array.isArray(doc.lines)) throw new Error("lines must be a sequence");
    doc.lines.forEach((item, i) => {
      const at = `line ${i + 1}`;
      if (!isRecord(item)) throw new Error(`${at} must be a mapping`);
      const lineText = str(item.text, `${at} text`);
      const t = ms(item.start_ms, `${at} start_ms`);
      const explicitEnd = item.end_ms != null;
      const end = explicitEnd ? ms(item.end_ms, `${at} end_ms`) : t;
      if (end < t) throw new Error(`${at} end_ms must not precede start_ms`);

      const words = parseWords(item.words, at);
      // A word's own end may be missing; bound the last one by the line.
      fillEnds(words, explicitEnd ? end : Infinity);

      lines.push({
        t,
        end,
        explicitEnd,
        text: lineText,
        words: words.length ? words.map(({ t, end, text }) => ({ t, end, text })) : undefined,
      });
    });
  }

  // Spec §4: lines may overlap and equal starts are legal, so sort stably by
  // start and leave overlaps intact.
  lines.sort((a, b) => a.t - b.t);
  const trackEnd = durationMs || duration || Infinity;
  fillEnds(lines, trackEnd);
  const plain = doc.plain == null ? "" : str(doc.plain, "plain");

  if (instrumental && (lines.length || plain.trim())) {
    throw new Error("instrumental files must not contain lines or plain lyrics");
  }

  // With no duration to fall back on, a trailing open-ended item is still
  // Infinity here; collapse those to "no end" rather than leaking it to the UI.
  const finished: LyricLine[] = lines.map(({ t, end, text, words }) => {
    const lineEnd = Number.isFinite(end) ? end : undefined;
    const last = words?.[words.length - 1];
    if (last && !Number.isFinite(last.end)) last.end = lineEnd ?? last.t;
    return { t, end: lineEnd, text, words };
  });

  return {
    title: optStr(meta.title, "title"),
    artist: optStr(meta.artist, "artist"),
    album: optStr(meta.album, "album"),
    language: optStr(meta.language, "language"),
    duration: durationMs,
    instrumental,
    lines: finished,
    plain,
  };
}
