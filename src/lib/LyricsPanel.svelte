<script lang="ts">
  import { lyrics, wordProgress } from "$lib/lyrics.svelte";
  import { asideRuns, asideTextRuns } from "$lib/lyricsAside";
  import { alignmentLanes } from "$lib/lyricsLanes";
  import { lyricsStyle, HOLD_BASE_SECONDS } from "$lib/lyricsStyle.svelte";
  import { player } from "$lib/player.svelte";

  let { compact = false }: { compact?: boolean } = $props();

  let container = $state<HTMLElement | null>(null);

  // Load whenever the current track changes.
  $effect(() => {
    lyrics.loadFor(player.current);
  });

  /**
   * Scroll + ramp anchor: the latest line that has started. Kept separate from
   * the lit set because during an instrumental gap nothing is lit, and the view
   * must stay put rather than snapping back to the top.
   */
  const anchor = $derived(
    lyrics.status === "synced" ? lyrics.activeIndex(player.position) : -1,
  );

  /**
   * Which side each line sits on. Computed from the timings, not the playhead,
   * so a line never changes sides while it is being sung.
   */
  const lanes = $derived(alignmentLanes(lyrics.lines));

  /** Every line being sung right now — often more than one. */
  const active = $derived(
    lyrics.status === "synced"
      ? new Set(
          lyrics.activeIndices(
            player.position,
            lyricsStyle.hold * HOLD_BASE_SECONDS,
          ),
        )
      : new Set<number>(),
  );

  /**
   * A new track starts at the top. The panel is a persistent scroller, so
   * without this it opens wherever the last song left it — halfway down
   * someone else's second verse — and only jumps back once a line goes active,
   * which for an intro can be twenty seconds of the wrong lyrics on screen.
   * Instant, not smooth: this is a cut between songs, not a movement within one.
   */
  $effect(() => {
    void player.current?.path;
    container?.scrollTo({ top: 0, behavior: "auto" });
  });

  // Smooth auto-scroll to keep the active line centred. Scroll only this
  // panel: scrollIntoView can also move the document and expose the app below
  // the fixed immersive overlay.
  $effect(() => {
    const i = anchor;
    if (i < 0 || !container) return;
    const el = container.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const lineRect = el.getBoundingClientRect();
    const top =
      container.scrollTop +
      lineRect.top -
      containerRect.top -
      (container.clientHeight - lineRect.height) / 2;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: Math.max(0, top),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  });

  function seekTo(t: number) {
    player.seek(t);
  }

  /**
   * How far ahead of the sung line a line sits, capped at 4. Drives the dim +
   * blur ramp: lines already sung stay sharp and dim, lines still coming go
   * progressively softer the further out they are. Before playback starts
   * there's no active line, so the ramp runs from the top instead.
   */
  function depth(i: number): number {
    if (anchor < 0) return Math.min(i, 4);
    if (i <= anchor) return 0;
    return Math.min(i - anchor, 4);
  }

  /**
   * Per-word emphasis (0–1) for the sung line: how far each word is held
   * relative to the line's own typical word. Measuring against the line rather
   * than a fixed threshold is what keeps a rapid-fire bar flat while a
   * sustained note still swells — the two can differ by an order of magnitude.
   * Only the active line renders words, so this runs once per line change.
   */
  function emphasisOf(words: { t: number; end: number }[]): number[] {
    const held = words.map((w) => Math.max(w.end - w.t, 0));
    const sorted = [...held].sort((a, b) => a - b);
    const median = Math.max(sorted[sorted.length >> 1], 0.05);
    // Nothing below 1.5x typical registers; 3x and beyond is full strength.
    return held.map((d) => Math.max(0, Math.min(1, (d / median - 1.5) / 1.5)));
  }

  /** Emphasis per sung line, keyed by line index. Recomputed only when the set
   *  of sung lines changes, not on every position tick. */
  const emphasis = $derived.by(() => {
    const byLine = new Map<number, number[]>();
    for (const i of active) {
      const words = lyrics.lines[i]?.words;
      if (words?.length) byLine.set(i, emphasisOf(words));
    }
    return byLine;
  });
</script>

<div class="lyrics" class:compact bind:this={container}>
  {#if !player.current}
    <div class="state">Nothing playing.</div>
  {:else if lyrics.status === "loading"}
    <div class="state">Searching for lyrics…</div>
  {:else if lyrics.status === "synced"}
    <div class="synced">
      {#each lyrics.lines as line, i (i)}
        <button
          class="line"
          class:active={active.has(i)}
          class:past={i < anchor && !active.has(i)}
          class:offset={lanes[i] === 1}
          data-i={i}
          style="--d:{depth(i)}"
          onclick={() => seekTo(line.t)}
        >
          {#if active.has(i) && line.words?.length}
            {@const emph = emphasis.get(i) ?? []}
            <!-- Word-synced (Lyricsfile): each word is a dim base with a lit
                 copy clipped to how much of it has been sung. Written on one
                 line on purpose — whitespace between the spans would show up
                 as extra gaps, since word text carries its own spacing. -->
            {#each asideRuns(line.words) as row, r (r)}
              <span class="line-row" class:aside-row={row.aside}>{#each row.indices as w (w)}<span class="word" style="--wp:{wordProgress(line.words[w], player.position)};--emph:{emph[w] ?? 0}"><span class="word-dim">{line.words[w].text}</span><span class="word-glow" aria-hidden="true"><span class="word-lit">{line.words[w].text}</span></span></span>{/each}</span>
            {/each}
          {:else if line.text}
            <!-- Same row split on unsung lines, so a line doesn't visibly
                 reflow the moment it becomes active. -->
            {#each asideTextRuns(line.text) as row, r (r)}
              <span class="line-row" class:aside-row={row.aside}>{row.text}</span>
            {/each}
          {:else}
            ♪
          {/if}
        </button>
      {/each}
    </div>
  {:else if lyrics.status === "plain"}
    <div class="plain">{lyrics.plainText}</div>
  {:else if lyrics.status === "instrumental"}
    <div class="state">♪ Instrumental</div>
  {:else if lyrics.status === "error"}
    <div class="state">
      Couldn't load lyrics.
      <div class="btns">
        <button class="retry" onclick={() => lyrics.refetch(player.current)}>Retry</button>
        <button class="retry" onclick={() => lyrics.importFile(player.current)}>Add from file…</button>
      </div>
    </div>
  {:else}
    <div class="state">
      No lyrics found.
      <div class="btns">
        <button class="retry" onclick={() => lyrics.refetch(player.current)}>Refetch</button>
        <button class="retry" onclick={() => lyrics.importFile(player.current)}>Add from file…</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .lyrics {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10% 6%;
    scroll-behavior: smooth;
  }
  .compact {
    padding: 20px 6px;
  }
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    justify-content: center;
    height: 100%;
    opacity: 0.7;
    font-size: 15px;
  }
  .btns {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .retry {
    color: var(--accent);
    font-weight: 700;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 980px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .synced {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line {
    /* Per-context knobs. Surfaces that host this panel set these rather than
       `opacity` directly, so the distance ramp below keeps working. */
    --lyric-dim: 0.34;
    /* A line that has been sung is gone: the view reads as what's coming, not
       as a transcript with a marker in it. Hovering the panel brings them back
       (see `.lyrics:hover` below) so looking up an earlier line is still one
       gesture away. */
    --lyric-past: 0;
    --lyric-past-hover: 0.2;
    --lyric-lit: 1;
    --lyric-blur-step: 0.5px;
    --lyric-glow: none;

    text-align: left;
    font-family: var(--font-lyrics);
    font-size: 26px;
    /* 700, not 800: Figtree carries a real 700 cut on its weight axis, and the
       even stroke needs no negative tracking to look tight. */
    font-weight: 700;
    line-height: 1.3;
    padding: 6px 10px;
    border-radius: 10px;
    color: currentColor;
    opacity: max(0.1, calc(var(--lyric-dim) - var(--d, 0) * 0.052));
    filter: blur(calc(var(--d, 0) * var(--lyric-blur-step)));

    /* Animation Speed divides every lyric duration, so one knob keeps the
       line transition, cascade stagger and fill sweep in step. */
    --fx-dur: calc(300ms / var(--lyric-fx-speed, 1));
    /* Cascade: upcoming lines sit progressively lower and arrive staggered,
       so a new line reads as entering rather than just brightening. */
    transform: translateY(calc(var(--d, 0) * var(--lyric-fx-cascade, 1) * 3px));
    transition:
      opacity var(--fx-dur),
      filter var(--fx-dur),
      color calc(var(--fx-dur) * 0.85),
      transform var(--fx-dur) var(--motion-spring),
      scale var(--fx-dur) var(--motion-spring);
    transition-delay: calc(var(--d, 0) * var(--lyric-fx-cascade, 1) * 26ms);
    transform-origin: left center;
    /* Separate `scale` property, so the cascade transform above stays intact. */
    scale: var(--lyric-fx-inactive-scale, 0.8);
  }
  /* A line that overlaps the one before it sits on the opposite side, so two
     concurrent lines read as concurrent rather than as one replacing the
     other. Both stay on screen for as long as they are sounding. */
  .line.offset {
    text-align: right;
    transform-origin: right center;
  }
  .compact .line {
    font-size: 20px;
    text-align: center;
    transform-origin: center;
  }
  /* Too narrow to read as two columns; the offset would just look like a typo. */
  .compact .line.offset {
    text-align: center;
    transform-origin: center;
  }
  .line.past {
    opacity: var(--lyric-past);
    /* Invisible: don't let it take a click meant for the backdrop. Restored on
       hover along with the line itself. */
    pointer-events: none;
  }
  .lyrics:hover .line.past {
    opacity: var(--lyric-past-hover);
    pointer-events: auto;
  }
  .line.active {
    opacity: var(--lyric-lit);
    filter: none;
    text-shadow: var(--lyric-glow);
    transform: none;
    transition-delay: 0ms;
    scale: 1;
  }
  .line:hover {
    opacity: 0.85;
    filter: none;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  /* Word-level highlight. The lit copy sits exactly on top of the dim one and
     is revealed left-to-right, so the two never disagree about wrapping. Both
     inherit the line's colour; only their opacity differs, which keeps this
     working on every surface without another colour knob. */
  .word {
    position: relative;
    display: inline-block;
    white-space: pre;

    /* Word Lift raises a word as it is sung; Emphasis swells the ones held
       longest. Both ride `--wp`, so they resolve in time with the fill rather
       than snapping at the word boundary. */
    transform: translateY(calc(var(--wp, 0) * var(--lyric-fx-lift, 1) * -3px))
      scale(calc(1 + var(--emph, 0) * var(--wp, 0) * var(--lyric-fx-emphasis, 1) * 0.055));
    transform-origin: center bottom;
    transition: transform calc(180ms / var(--lyric-fx-speed, 1)) var(--motion-spring);
  }
  .word-dim {
    opacity: var(--lyric-word-dim, 0.42);
  }

  /* A lyric line is two stacked rows: the lead vocal, and any parenthetical
     backing vocal beneath it — the Apple Music treatment. Blocks rather than
     flex so each row still inherits the host surface's `text-align` (Immersive
     sets left, `.compact` sets centre) with no per-surface override. */
  .line-row {
    display: block;
  }
  .aside-row {
    /* `em`, so this tracks each surface's own lyric size rather than needing a
       value per host. */
    font-size: 0.62em;
    line-height: 1.25;
    margin-top: 0.15em;
    /* Opacity sits on the row, not on `.word` — putting it on the word would
       fade the lit copy and its glow together and flatten the karaoke fill. */
    opacity: 0.68;
  }
  /* The glow sits on this unmasked wrapper, not on the masked text itself. A
     mask clips to the element box, so a text-shadow on `.word-lit` was being
     sliced into a rectangle at the edges. `drop-shadow` on the parent reads the
     masked child's alpha instead, so the bloom follows the glyph outline and
     the fill edge, with nothing to clip it. */
  .word-glow {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    filter: drop-shadow(
      0 0 calc(var(--emph, 0) * var(--lyric-fx-glow, 1) * 9px)
        rgba(255, 255, 255, calc(var(--emph, 0) * var(--lyric-fx-glow, 1) * 0.42))
    );
  }
  .word-lit {
    display: block;

    /* Karaoke fill. A mask rather than a clip rect, so Fill Softness can
       feather the edge; at 0 the two stops coincide and it is a hard cut.
       The sweep runs from -feather to 100%+feather so the word is fully dark
       at --wp 0 and fully lit at 1, instead of leaving a sliver at each end. */
    --feather: calc(var(--lyric-fx-fill-softness, 1) * 7px);
    --edge: calc(var(--wp, 0) * (100% + 2 * var(--feather)) - var(--feather));
    -webkit-mask-image: linear-gradient(
      90deg,
      #000 calc(var(--edge) - var(--feather)),
      transparent calc(var(--edge) + var(--feather))
    );
    mask-image: linear-gradient(
      90deg,
      #000 calc(var(--edge) - var(--feather)),
      transparent calc(var(--edge) + var(--feather))
    );

    /* Position ticks arrive ~30x a second; this bridges the gap between them. */
    transition: -webkit-mask-image 60ms linear, mask-image 60ms linear;
  }
  @media (prefers-reduced-motion: reduce) {
    .word,
    .word-lit {
      transition: none;
    }
    .word {
      transform: none;
    }
  }


  .plain {
    white-space: pre-wrap;
    font-family: var(--font-lyrics);
    font-size: 17px;
    line-height: 1.7;
    opacity: 0.9;
    max-width: 640px;
    margin: 0 auto;
  }
</style>
