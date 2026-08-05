//! Which side of the panel a lyric line sits on.
//!
//! When two lines sound at once, stacking them flush-left reads as one line
//! being replaced by the next. Offsetting the overlapping one to the opposite
//! side makes it obvious they are concurrent — the treatment Apple Music uses
//! for call-and-response and doubled vocals.

/**
 * How much overlap counts as genuinely concurrent, in seconds.
 *
 * Authored timing routinely overlaps by a few tens of milliseconds where one
 * phrase is clipped against the next — inaudible, and not two voices at once.
 * Offsetting on that would scatter lines across both sides for no reason a
 * listener could hear.
 */
const MIN_OVERLAP = 0.35;

interface Spanned {
  t: number;
  end?: number;
}

/**
 * A 0/1 lane per line: 0 sits left, 1 sits right.
 *
 * Derived from the timings alone, never from the playhead. A lane computed
 * from "what is active right now" would change as lines enter and leave, so a
 * line would visibly jump sides mid-phrase; this way its side is fixed for the
 * whole song and only the highlight moves.
 *
 * A line overlapping its predecessor takes the opposite lane, so a chain of
 * overlaps alternates rather than piling everything on one side. Anything that
 * starts cleanly after the previous line ends resets to the left.
 */
export function alignmentLanes(lines: Spanned[]): number[] {
  const lanes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i - 1];
    if (!prev) {
      lanes.push(0);
      continue;
    }
    // Without an explicit end a line runs to the next one, so it cannot overlap.
    const overlap = prev.end != null ? prev.end - lines[i].t : 0;
    lanes.push(overlap >= MIN_OVERLAP ? 1 - lanes[i - 1] : 0);
  }
  return lanes;
}
