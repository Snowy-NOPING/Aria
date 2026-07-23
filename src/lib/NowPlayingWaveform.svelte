<script lang="ts">
  let {
    playing = false,
    levels = [0, 0, 0, 0, 0],
  }: {
    playing?: boolean;
    levels?: number[];
  } = $props();

  function scale(index: number) {
    if (!playing) return 0.22;
    return 0.22 + Math.max(0, Math.min(1, levels[index] ?? 0)) * 0.78;
  }
</script>

<span class="waveform" aria-hidden="true">
  {#each [0, 1, 2, 3, 4] as index}
    <span class="bar" style:transform={`scaleY(${scale(index)})`}></span>
  {/each}
</span>

<style>
  .waveform {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 1.5px;
    width: 20px;
    height: 18px;
    color: var(--accent);
  }
  .bar {
    width: 2.5px;
    height: 16px;
    border-radius: 999px;
    background: currentColor;
    transform-origin: center;
    transition: transform 70ms linear;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
    .bar:nth-child(1),
    .bar:nth-child(5) {
      transform: scaleY(0.4);
    }
    .bar:nth-child(2),
    .bar:nth-child(4) {
      transform: scaleY(0.7);
    }
    .bar:nth-child(3) {
      transform: scaleY(1);
    }
  }
</style>
