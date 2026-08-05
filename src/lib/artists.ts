/**
 * Artist credit strings.
 *
 * A tag holds one string — "Kendrick Lamar, SZA", "The Weeknd & Playboi Carti" —
 * but a listener thinks in people, so a credit is read as a list. The split is
 * deliberately literal: it only cuts on the separators below, and it keeps the
 * separator text so a credit can be rendered back exactly as it was tagged,
 * with each name its own link.
 *
 * Plenty of acts have a separator in their name — "Tyler, The Creator",
 * "AC/DC", "Earth, Wind & Fire" — so every function here takes an optional set
 * of names the library already knows are whole (see `library.atomicArtists`).
 * A name in that set is never cut, and it wins over a separator that starts
 * earlier inside it. Without the set the split is naive, which is only good
 * enough for throwaway parsing.
 */

/** Separators, longest first so " feat. " wins over shorter overlapping cuts. */
const SEPARATORS = [
  " featuring ",
  " feat. ",
  " feat ",
  " ft. ",
  " ft ",
  " vs. ",
  " vs ",
  " with ",
  ", ",
  "; ",
  " & ",
  " / ",
  " x ",
  " × ",
  "/",
  ";",
  ",",
];

export interface Credit {
  /** The artist name on its own. */
  name: string;
  /** The separator that followed it, verbatim; "" on the last credit. */
  sep: string;
}

export type KnownNames = ReadonlySet<string>;

/** Where the first separator starts in `hay`, and which one it was. */
function firstSeparator(hay: string): { at: number; len: number } | null {
  let at = -1;
  let len = 0;
  for (const s of SEPARATORS) {
    const i = hay.indexOf(s);
    // A separator at 0 isn't one — that's a name starting with punctuation.
    if (i > 0 && (at === -1 || i < at)) {
      at = i;
      len = s.length;
    }
  }
  return at === -1 ? null : { at, len };
}

/** The length of the separator starting exactly at `i`, or 0. */
function separatorAt(hay: string, i: number): number {
  let len = 0;
  for (const s of SEPARATORS) {
    if (s.length > len && hay.startsWith(s, i)) len = s.length;
  }
  return len;
}

/** The longest known name `hay` starts with, if any. */
function knownPrefix(hay: string, known: KnownNames): number {
  let best = 0;
  for (const name of known) {
    if (name.length > best && hay.startsWith(name)) best = name.length;
  }
  return best;
}

/** Break a credit string into names plus the separators between them. */
export function splitCredits(artist: string, known: KnownNames = new Set()): Credit[] {
  const whole = artist.trim();
  if (!whole) return [];
  if (known.has(whole.toLowerCase())) return [{ name: whole, sep: "" }];

  const out: Credit[] = [];
  let rest = whole;

  while (rest) {
    // Lowercased so "FEAT." and "Feat." cut alike; the indices still refer to
    // `rest`, so names and separators are sliced with their original casing.
    const hay = rest.toLowerCase();
    // A known name starting here reaches past any separator inside it: the
    // comma in "Tyler, The Creator & Kali Uchis" belongs to Tyler, not the list.
    const keep = knownPrefix(hay, known);
    let cut = -1;
    let sepLen = 0;

    if (keep > 0) {
      sepLen = separatorAt(hay, keep);
      if (sepLen) cut = keep;
    }
    if (cut === -1) {
      const found = firstSeparator(hay);
      // Either nothing to cut on, or the only cut falls inside a known name
      // that isn't followed by a separator — leave the credit whole rather
      // than guess where one name ends and the next begins.
      if (!found || keep > found.at) break;
      cut = found.at;
      sepLen = found.len;
    }

    const name = rest.slice(0, cut).trim();
    if (name) out.push({ name, sep: rest.slice(cut, cut + sepLen) });
    rest = rest.slice(cut + sepLen);
  }

  const last = rest.trim();
  if (last) out.push({ name: last, sep: "" });
  return out;
}

/** Just the names, in credit order. */
export function artistNames(artist: string, known?: KnownNames): string[] {
  return splitCredits(artist, known).map((c) => c.name);
}

/** The lead credit — what "go to artist" should open. */
export function primaryArtist(artist: string, known?: KnownNames): string {
  return artistNames(artist, known)[0] ?? artist.trim();
}

/** Whether a credit string names this artist, whole or as one of its parts. */
export function credits(artist: string, name: string, known?: KnownNames): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  if (artist.trim().toLowerCase() === wanted) return true;
  return artistNames(artist, known).some((n) => n.toLowerCase() === wanted);
}
