<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { nav } from "$lib/nav.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import SidebarIcon from "$lib/icons/SidebarIcon.svelte";

  async function create() {
    const pl = await library.createPlaylist("New Playlist");
    nav.go("playlist", pl.id);
  }
  function art(id: string): string | null {
    return library.playlistTracks(id).find((t) => t.art)?.art ?? null;
  }
</script>

<div class="view">
  <div class="header">
    <div class="view-title">Playlists</div>
    <button class="pill-btn filled" onclick={create}>+ New Playlist</button>
  </div>

  {#if library.playlists.length === 0}
    <div class="note">No playlists yet.</div>
  {:else}
    <div class="grid">
      {#each library.playlists as pl (pl.id)}
        <div
          class="card"
          role="button"
          tabindex="0"
          onclick={() => nav.go("playlist", pl.id)}
          onkeydown={(e) => e.key === "Enter" && nav.go("playlist", pl.id)}
        >
          <Artwork src={art(pl.id)} radius="10px" />
          <button
            class="pin"
            class:pinned={library.isPinned("playlist", pl.id)}
            title={library.isPinned("playlist", pl.id) ? "Unpin" : "Pin playlist"}
            aria-label={library.isPinned("playlist", pl.id) ? "Unpin" : "Pin playlist"}
            onclick={(e) => {
              e.stopPropagation();
              library.togglePin("playlist", pl.id);
            }}
          >
            <SidebarIcon name="pin" size={16} />
          </button>
          <div class="name">{pl.name}</div>
          <div class="count">{pl.trackPaths.length} songs</div>
        </div>
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
  .card {
    cursor: pointer;
    outline: none;
    position: relative;
  }
  .pin {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    background: rgba(20, 15, 19, 0.66);
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .card:hover .pin,
  .pin:focus-visible,
  .pin.pinned {
    opacity: 1;
  }
  .pin.pinned {
    color: var(--accent-2);
  }
  .name {
    font-weight: 600;
    margin-top: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    font-size: 13px;
    color: var(--text-dim);
  }
  .note {
    color: var(--text-dim);
    margin-top: 60px;
    text-align: center;
  }
</style>
