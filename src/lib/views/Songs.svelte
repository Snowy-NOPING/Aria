<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, type TrackMeta } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import Artwork from "$lib/Artwork.svelte";
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

  /**
   * One section per artist, in the sort's order. Grouping is by album artist
   * where the tags give one (see `library.filedUnder`), so a record with guests
   * on half its songs stays under the name it's billed to instead of splitting
   * into a section per feature.
   */
  const groups = $derived.by(() => {
    const byArtist = new Map<string, { name: string; tracks: TrackMeta[] }>();
    for (const t of filtered) {
      const name = library.filedUnder(t);
      const key = name.toLowerCase();
      const group = byArtist.get(key);
      if (group) group.tracks.push(t);
      else byArtist.set(key, { name, tracks: [t] });
    }
    const direction = ascending ? 1 : -1;
    const ordered = [...byArtist.values()].sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction,
    );
    // The flat running order the queue uses, plus where each section starts in
    // it: playing a song should continue through the library from that point,
    // not stop at the end of its artist.
    let offset = 0;
    return ordered.map((group) => {
      const at = offset;
      offset += group.tracks.length;
      return {
        ...group,
        offset: at,
        // Cheap on purpose: `library.artistArt` walks every album to find one,
        // which is fine once on an artist page and not fine once per section on
        // a list of every artist you own.
        art: library.artistImages[group.name] ?? group.tracks.find((t) => t.art)?.art ?? null,
      };
    });
  });

  /** Every visible track, in the order the sections show them. */
  const running = $derived(groups.flatMap((g) => g.tracks));

  function play(i: number) {
    player.setQueue(running, i);
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
    {#each groups as group (group.name)}
      <section class="artist-group">
        <button class="artist-head" onclick={() => nav.go("artist", group.name)}>
          <Artwork src={group.art} size="38px" radius="50%" />
          <span class="artist-name">{group.name}</span>
          <span class="artist-count">
            {group.tracks.length}
            {group.tracks.length === 1 ? "song" : "songs"}
          </span>
        </button>
        <TrackList
          tracks={group.tracks}
          onplay={(i) => play(group.offset + i)}
          showArt={true}
        />
      </section>
    {/each}
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
  .artist-group {
    margin-bottom: 26px;
  }
  /* Sticky so the name of whoever you're scrolling through stays overhead —
     the section header is the only thing telling you where you are once the
     first few rows have gone past. */
  .artist-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 9px 10px;
    margin-bottom: 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(18px) saturate(1.3);
    text-align: left;
  }
  .artist-head:hover .artist-name {
    color: var(--accent);
  }
  .artist-name {
    font-size: 16px;
    font-weight: 750;
    letter-spacing: -0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist-count {
    margin-left: auto;
    flex: none;
    font-size: 12px;
    color: var(--text-faint);
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
