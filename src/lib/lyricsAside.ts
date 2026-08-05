//! Parenthetical asides in lyric text — ad-libs, backing vocals, producer tags.
//!
//! Pure text helpers with no store or Tauri dependency, kept apart from
//! `lyrics.svelte.ts` so they stay directly testable.

/** Only the field these helpers need, so callers aren't tied to `LyricWord`. */
interface TextRun {
  text: string;
}

const OPEN = /[([{]/g;
const CLOSE = /[)\]}]/g;

function count(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

/**
 * Which words sit inside a parenthetical aside. Bracket depth is carried across
 * words because an aside routinely spans several of them, and the closing word
 * counts as inside so the bracket is styled with what it encloses.
 */
export function asideFlags(words: TextRun[]): boolean[] {
  let depth = 0;
  return words.map((w) => {
    const opens = count(w.text, OPEN);
    const closes = count(w.text, CLOSE);
    const inside = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    return inside;
  });
}

/**
 * Split a line's words into consecutive rows, breaking wherever the text enters
 * or leaves a parenthetical, so an aside always starts a new line.
 *
 * Runs are kept in reading order rather than gathering every aside into one
 * trailing row: a mid-line aside (`a (b) c`) would otherwise render as `a c`
 * above `(b)`, silently reordering the lyric.
 *
 * Indices are returned rather than the words themselves so callers can still
 * reach per-word timing and emphasis data, which is keyed by original position.
 */
export function asideRuns(words: TextRun[]): { aside: boolean; indices: number[] }[] {
  const runs: { aside: boolean; indices: number[] }[] = [];
  asideFlags(words).forEach((isAside, i) => {
    const last = runs[runs.length - 1];
    if (last && last.aside === isAside) last.indices.push(i);
    else runs.push({ aside: isAside, indices: [i] });
  });
  return runs;
}

/** The same row split for an untimed line, in reading order. */
export function asideTextRuns(text: string): { aside: boolean; text: string }[] {
  const runs: { aside: boolean; text: string }[] = [];
  for (const r of splitAsides(text)) {
    const text = r.text.replace(/\s+/g, " ").trim();
    if (!text) continue; // whitespace between runs carries no content of its own
    const last = runs[runs.length - 1];
    if (last && last.aside === r.aside) last.text += ` ${text}`;
    else runs.push({ aside: r.aside, text });
  }
  return runs;
}

/**
 * Split a plain lyric line into normal and parenthetical runs, in order.
 * Concatenating every run reproduces the input exactly.
 */
export function splitAsides(text: string): { text: string; aside: boolean }[] {
  const out: { text: string; aside: boolean }[] = [];
  // Trailing bracket optional: a line can open an aside and never close it.
  const bracket = /[([{][^)\]}]*[)\]}]?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = bracket.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), aside: false });
    out.push({ text: m[0], aside: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), aside: false });
  return out.length ? out : [{ text, aside: false }];
}
