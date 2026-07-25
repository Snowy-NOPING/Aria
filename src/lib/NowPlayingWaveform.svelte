<script lang="ts">
  let {
    playing = false,
    bands = [0, 0, 0, 0],
  }: {
    playing?: boolean;
    /** Per-frequency-band levels, 0–1, bass → treble. */
    bands?: number[];
  } = $props();

  const MIN = 0.16;

  /** Bars grow from the bottom, Apple Music style, never fully collapsing. */
  function scale(index: number) {
    if (!playing) return MIN;
    const level = Math.max(0, Math.min(1, bands[index] ?? 0));
    return MIN + level * (1 - MIN);
  }

  /** Playing but the analyser is giving us nothing (no Web Audio, or silence
   *  at the very start of a track) — keep the indicator alive with the CSS
   *  bounce rather than showing four dead stubs. */
  const idle = $derived(
    playing && Math.max(...[0, 1, 2, 3].map((i) => bands[i] ?? 0)) < 0.02,
  );
</script>

<span class="analyzer" class:idle aria-hidden="true">
  {#each [0, 1, 2, 3] as index}
    <span class="bar" style:transform={`scaleY(${scale(index)})`}></span>
  {/each}
</span>

<style>
  .analyzer {
    display: inline-flex;
    align-items: flex-end;
    justify-content: center;
    gap: 2px;
    width: 20px;
    height: 16px;
    color: var(--accent);
  }
  .bar {
    width: 2.5px;
    height: 100%;
    border-radius: 99px;
    background: currentColor;
    transform-origin: bottom center;
    transform: scaleY(0.16);
    transition: transform 90ms cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  .analyzer.idle .bar {
    transition: none;
    animation: bounce 900ms ease-in-out infinite;
  }
  .analyzer.idle .bar:nth-child(1) {
    animation-duration: 780ms;
  }
  .analyzer.idle .bar:nth-child(2) {
    animation-duration: 1020ms;
    animation-delay: -220ms;
  }
  .analyzer.idle .bar:nth-child(3) {
    animation-duration: 860ms;
    animation-delay: -480ms;
  }
  .analyzer.idle .bar:nth-child(4) {
    animation-duration: 1140ms;
    animation-delay: -120ms;
  }
  @keyframes bounce {
    0%,
    100% {
      transform: scaleY(0.22);
    }
    50% {
      transform: scaleY(0.86);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
      animation: none !important;
    }
    /* Beats the inline `style:transform` that drives the live bars. */
    .bar:nth-child(1) {
      transform: scaleY(0.4) !important;
    }
    .bar:nth-child(2) {
      transform: scaleY(0.85) !important;
    }
    .bar:nth-child(3) {
      transform: scaleY(0.6) !important;
    }
    .bar:nth-child(4) {
      transform: scaleY(1) !important;
    }
  }
</style>
