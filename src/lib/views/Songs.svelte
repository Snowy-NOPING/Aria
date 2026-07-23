<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import TrackList from "$lib/TrackList.svelte";

  let sortBy = $state<"title" | "artist" | "album" | "duration">("title");
  let ascending = $state(true);

  const filtered = $derived.by(() => {
    const q = nav.query.trim().toLowerCase();
    const matches = q
      ? library.tracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q),
        )
      : library.tracks;
    const direction = ascending ? 1 : -1;
    return [...matches].sort((a, b) => {
      if (sortBy === "duration") return (a.duration - b.duration) * direction;
      return a[sortBy].localeCompare(b[sortBy], undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction;
    });
  });

  function play(i: number) {
    player.setQueue(filtered, i);
  }
</script>

<div class="view">
  <div class="header">
    <div class="view-title">Songs</div>
    <div class="header-tools">
      <button class="pill-btn" onclick={() => player.openFiles()}>Open Files…</button>
      <button class="pill-btn" onclick={() => player.openFolder()}>Open Folder…</button>
      {#if library.tracks.length > 0}
        <label class="sort">
          <span>Sort</span>
          <select bind:value={sortBy}>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="album">Album</option>
            <option value="duration">Duration</option>
          </select>
        </label>
        <button
          class="direction"
          aria-label={ascending ? "Sort descending" : "Sort ascending"}
          title={ascending ? "Sort descending" : "Sort ascending"}
          onclick={() => (ascending = !ascending)}
        >
          {ascending ? "↑" : "↓"}
        </button>
        <button class="pill-btn filled" onclick={() => play(0)}>▶ Play All</button>
      {/if}
    </div>
  </div>

  {#if library.scanning && library.tracks.length === 0}
    <div class="note">Scanning your library…</div>
  {:else if library.tracks.length === 0}
    <div class="note">
      No songs found. Add a music folder in <strong>Settings</strong>.
    </div>
  {:else}
    <TrackList tracks={filtered} onplay={play} showArt={true} />
  {/if}
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .header-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sort {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .sort select {
    min-height: 32px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    padding: 0 28px 0 11px;
    outline: none;
  }
  .sort select:focus-visible {
    border-color: var(--accent);
  }
  .direction {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--surface);
    color: var(--accent);
    font-size: 16px;
    transition:
      background 150ms ease,
      transform 220ms var(--motion-spring);
  }
  .direction:hover {
    background: var(--hover);
    transform: scale(1.08);
  }
  .direction:active {
    transform: scale(0.9);
  }
  .note {
    color: var(--text-dim);
    margin-top: 60px;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .direction:hover,
    .direction:active {
      transform: none;
    }
  }
</style>
