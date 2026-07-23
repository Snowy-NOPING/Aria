<script lang="ts">
  import { player } from "$lib/player.svelte";
  import { layout } from "$lib/layout.svelte";
  import { lyrics } from "$lib/lyrics.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import LyricsPanel from "$lib/LyricsPanel.svelte";
  import Resizer from "$lib/Resizer.svelte";

  let container = $state<HTMLElement | null>(null);

  function resize(x: number) {
    if (!container) return;
    const left = container.getBoundingClientRect().left;
    layout.setLyricsArt(x - left);
  }
</script>

<div class="lyrics-view" bind:this={container}>
  <div class="side" style="width:{layout.lyricsArtWidth}px">
    <Artwork src={player.current?.art} size="min(260px, 78%)" radius="14px" />
    <div class="meta">
      <div class="t">{player.current?.title ?? "Not Playing"}</div>
      <div class="a">{player.current?.artist ?? ""}</div>
    </div>
    {#if player.current}
      <div class="lyr-actions">
        <button class="pill-btn" onclick={() => lyrics.importFile(player.current)}>
          Import Lyrics…
        </button>
        {#if lyrics.overridden}
          <button class="pill-btn" onclick={() => lyrics.removeOverride(player.current)}>
            Use LRCLIB
          </button>
        {:else}
          <button
            class="pill-btn"
            disabled={lyrics.status === "loading"}
            onclick={() => lyrics.refetch(player.current)}
          >
            {lyrics.status === "loading" ? "Refetching…" : "Refetch LRCLIB"}
          </button>
        {/if}
      </div>
      {#if lyrics.overridden}
        <div class="badge">Imported file</div>
      {/if}
    {/if}
  </div>
  <Resizer onmove={resize} />
  <div class="panel">
    <LyricsPanel />
  </div>
</div>

<style>
  .lyrics-view {
    display: flex;
    height: 100%;
    overflow: hidden;
  }
  .side {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 24px;
  }
  .meta {
    text-align: center;
    max-width: 100%;
  }
  .t {
    font-size: 18px;
    font-weight: 700;
  }
  .a {
    color: var(--text-dim);
    margin-top: 2px;
  }
  .lyr-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 20px;
    padding: 2px 10px;
    opacity: 0.85;
  }
  .panel {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
</style>
