<script lang="ts">
  import { lyrics } from "$lib/lyrics.svelte";
  import { player } from "$lib/player.svelte";

  let { compact = false }: { compact?: boolean } = $props();

  let container = $state<HTMLElement | null>(null);

  // Load whenever the current track changes.
  $effect(() => {
    lyrics.loadFor(player.current);
  });

  const active = $derived(
    lyrics.status === "synced" ? lyrics.activeIndex(player.position) : -1,
  );

  // Smooth auto-scroll to keep the active line centred. Scroll only this
  // panel: scrollIntoView can also move the document and expose the app below
  // the fixed immersive overlay.
  $effect(() => {
    const i = active;
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
          class:active={i === active}
          class:past={i < active}
          data-i={i}
          onclick={() => seekTo(line.t)}
        >
          {line.text || "♪"}
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
    text-align: left;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.4px;
    line-height: 1.3;
    padding: 6px 10px;
    border-radius: 10px;
    color: currentColor;
    opacity: 0.32;
    transition:
      opacity 0.25s,
      color 0.25s,
      transform 0.25s;
    transform-origin: left center;
  }
  .compact .line {
    font-size: 20px;
    text-align: center;
    transform-origin: center;
  }
  .line.past {
    opacity: 0.24;
  }
  .line.active {
    opacity: 1;
    color: var(--accent);
    transform: scale(1.02);
  }
  .line:hover {
    opacity: 0.85;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  .plain {
    white-space: pre-wrap;
    font-size: 16px;
    line-height: 1.7;
    opacity: 0.9;
    max-width: 640px;
    margin: 0 auto;
  }
</style>
