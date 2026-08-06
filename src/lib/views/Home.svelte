<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import AlbumCard from "$lib/AlbumCard.svelte";

  const recent = $derived(library.recentSongs);
  const albums = $derived(library.allAlbums);

  /**
   * The artists you own most of, with a picture each. Art is gathered in one
   * pass over the library rather than by asking `library.artistArt` twelve
   * times — that walks every album looking for a cover, which is a fine price
   * on an artist's own page and a silly one for a row of thumbnails.
   */
  const artists = $derived.by(() => {
    const names = library.topArtists(12);
    if (!names.length) return [];
    const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
    const art = new Map<string, string>();
    for (const t of library.tracks) {
      if (!t.art) continue;
      const key = library.filedUnder(t).toLowerCase();
      if (wanted.has(key) && !art.has(key)) art.set(key, t.art);
    }
    return names.map((name) => ({
      name,
      art: library.artistImages[name] ?? art.get(name.toLowerCase()) ?? null,
    }));
  });

  function cover(id: string): string | null {
    const a = library.albumById(id);
    if (a?.art) return a.art;
    return library.albumTracks(id).find((t) => t.art)?.art ?? null;
  }
</script>

<div class="view">
  <div class="view-title">Listen Now</div>

  {#if library.scanning && recent.length === 0 && albums.length === 0}
    <div class="note">Scanning your library…</div>
  {:else if recent.length === 0 && albums.length === 0}
    <div class="empty">
      <p>Your library is empty.</p>
      <button class="pill-btn filled" onclick={() => library.addFolder()}>Add a Music Folder</button>
      <p class="hint">Aria watches <code>Music</code> and <code>Videos</code> by default.</p>
    </div>
  {:else}
    <!-- Artists first: it's the coarsest way into a library, and everything
         below is a narrower slice of the same thing. -->
    {#if artists.length > 0}
      <section>
        <div class="row-head">
          <h2>Artists</h2>
        </div>
        <div class="grid">
          {#each artists as artist (artist.name)}
            <AlbumCard
              art={artist.art}
              title={artist.name}
              round
              onclick={() => nav.go("artist", artist.name)}
              onplay={() => player.setQueue(library.artistTracks(artist.name), 0)}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if albums.length > 0}
      <section>
        <div class="row-head">
          <h2>Albums</h2>
          <button class="more" onclick={() => nav.go("albums")}>See All ›</button>
        </div>
        <div class="grid">
          {#each albums.slice(0, 12) as a (a.id)}
            <AlbumCard
              art={cover(a.id)}
              title={a.name}
              subtitle={a.artist || `${a.trackPaths.length} songs`}
              onclick={() => nav.go("album", a.id)}
              onplay={() => player.setQueue(library.albumTracks(a.id), 0)}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if recent.length > 0}
      <section>
        <div class="row-head">
          <h2>Recently Added</h2>
          <button class="more" onclick={() => nav.go("songs")}>See All ›</button>
        </div>
        <div class="grid">
          {#each recent as t (t.path)}
            <AlbumCard
              art={t.art}
              title={t.title}
              subtitle={t.artist}
              onclick={() => player.setQueue([t], 0)}
              onplay={() => player.setQueue([t], 0)}
            />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  section {
    margin-bottom: 32px;
  }
  .row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h2 {
    font-size: 20px;
    font-weight: 700;
  }
  .more {
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 80px;
    color: var(--text-dim);
  }
  .hint {
    font-size: 12px;
    color: var(--text-faint);
  }
  code {
    background: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .note {
    color: var(--text-dim);
    margin-top: 60px;
    text-align: center;
  }
</style>
