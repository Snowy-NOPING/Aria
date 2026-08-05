<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import AlbumCard from "$lib/AlbumCard.svelte";

  const filtered = $derived.by(() => {
    const all = library.allAlbums;
    const q = nav.query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (a) => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q),
    );
  });

  async function create() {
    const a = await library.createAlbum("New Album");
    nav.go("album", a.id);
  }

  function cover(id: string): string | null {
    const a = library.albumById(id);
    if (a?.art) return a.art;
    return library.albumTracks(id).find((t) => t.art)?.art ?? null;
  }
</script>

<div class="view">
  <div class="header">
    <div class="view-title">Albums</div>
    <button class="pill-btn filled" onclick={create}>+ New Album</button>
  </div>

  {#if filtered.length === 0}
    <div class="empty">
      <p>
        {nav.query.trim()
          ? "No albums match your search."
          : "No albums yet. Add a music folder, or create one and add songs to it."}
      </p>
      <button class="pill-btn filled" onclick={create}>+ New Album</button>
    </div>
  {:else}
    <div class="grid">
      {#each filtered as album (album.id)}
        <AlbumCard
          art={cover(album.id)}
          title={album.name}
          subtitle={album.artist || `${album.trackPaths.length} songs`}
          onclick={() => nav.go("album", album.id)}
          onplay={() => player.setQueue(library.albumTracks(album.id), 0)}
          pinned={library.isPinned("album", album.id)}
          onpin={() => library.togglePin("album", album.id)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 70px;
    color: var(--text-dim);
  }
</style>
