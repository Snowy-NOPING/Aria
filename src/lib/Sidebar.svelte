<script lang="ts">
  import { nav, type View } from "$lib/nav.svelte";
  import {
    library,
    type LibraryPin,
  } from "$lib/library.svelte";
  import { player } from "$lib/player.svelte";
  import { layout } from "$lib/layout.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import SidebarIcon from "$lib/icons/SidebarIcon.svelte";

  const libraryItems: { id: View; label: string; icon: "home" | "recent" | "songs" | "albums" | "videos" | "queue" | "playlists" }[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "recent", label: "Recently Added", icon: "recent" },
    { id: "songs", label: "Songs", icon: "songs" },
    { id: "albums", label: "Albums", icon: "albums" },
    { id: "videos", label: "Videos", icon: "videos" },
    { id: "queue", label: "Play Queue", icon: "queue" },
    { id: "playlists", label: "All Playlists", icon: "playlists" },
  ];

  const validPins = $derived(
    library.pins.filter((pin) => {
      if (pin.kind === "album") return !!library.albumById(pin.target);
      if (pin.kind === "playlist") return !!library.playlistById(pin.target);
      return !!library.trackByPath(pin.target);
    }),
  );

  function onSearch(e: Event) {
    nav.query = (e.target as HTMLInputElement).value;
    if (nav.query && nav.view !== "songs") nav.go("songs");
  }

  async function newPlaylist() {
    const playlist = await library.createPlaylist("New Playlist");
    nav.go("playlist", playlist.id);
  }

  function pinLabel(pin: LibraryPin): string {
    if (pin.kind === "album") return library.albumById(pin.target)?.name ?? "Album";
    if (pin.kind === "playlist") {
      return library.playlistById(pin.target)?.name ?? "Playlist";
    }
    return library.trackByPath(pin.target)?.title ?? "Song";
  }

  function pinSubtitle(pin: LibraryPin): string {
    if (pin.kind === "album") {
      const album = library.albumById(pin.target);
      return album?.artist || "Album";
    }
    if (pin.kind === "playlist") return "Playlist";
    return library.trackByPath(pin.target)?.artist ?? "Song";
  }

  function pinArt(pin: LibraryPin): string | null {
    if (pin.kind === "album") {
      const album = library.albumById(pin.target);
      return album?.art ?? library.albumTracks(pin.target).find((t) => t.art)?.art ?? null;
    }
    if (pin.kind === "playlist") {
      return library.playlistTracks(pin.target).find((t) => t.art)?.art ?? null;
    }
    return library.trackByPath(pin.target)?.art ?? null;
  }

  function openPin(pin: LibraryPin) {
    if (pin.kind === "album") {
      nav.go("album", pin.target);
    } else if (pin.kind === "playlist") {
      nav.go("playlist", pin.target);
    } else {
      const index = library.tracks.findIndex((track) => track.path === pin.target);
      if (index >= 0) player.setQueue(library.tracks, index);
    }
  }
</script>

<nav
  class="sidebar"
  style="width:{layout.sidebarWidth}px"
  data-tauri-drag-region
  aria-label="Primary navigation"
>
  <label class="search">
    <SidebarIcon name="search" size={16} />
    <input
      aria-label="Search library"
      placeholder="Search"
      value={nav.query}
      oninput={onSearch}
    />
  </label>

  <div class="nav-scroll">
    <section>
      <div class="section-head">Library</div>
      {#each libraryItems as item, index}
        {#if index !== 1 || library.recentSongs.length > 0}
          <button
            class="item"
            class:active={nav.view === item.id}
            onclick={() => nav.go(item.id)}
          >
            <span class="icon"><SidebarIcon name={item.icon} size={18} /></span>
            <span class="label">{item.label}</span>
          </button>
        {/if}
      {/each}
    </section>

    <section>
      <div class="section-head pin-head">
        <span>Pins</span>
        <span class="pin-count">{validPins.length || ""}</span>
      </div>
      {#each validPins as pin (pin.kind + pin.target)}
        <div class="pin-row">
          <button class="pin-item" onclick={() => openPin(pin)}>
            <Artwork src={pinArt(pin)} size="28px" radius="6px" />
            <span class="pin-copy">
              <strong>{pinLabel(pin)}</strong>
              <small>{pinSubtitle(pin)}</small>
            </span>
          </button>
          <button
            class="unpin"
            title={`Unpin ${pinLabel(pin)}`}
            aria-label={`Unpin ${pinLabel(pin)}`}
            onclick={() => library.togglePin(pin.kind, pin.target)}
          >
            ×
          </button>
        </div>
      {/each}
      {#if validPins.length === 0}
        <div class="empty-note">Pin albums, songs, or playlists for quick access.</div>
      {/if}
    </section>

    <section>
      <div class="section-head playlist-head">
        <span>Playlists</span>
        <button class="add" title="New playlist" aria-label="New playlist" onclick={newPlaylist}>
          <SidebarIcon name="add" size={17} />
        </button>
      </div>
      {#each library.playlists as playlist}
        <button
          class="item playlist"
          class:active={nav.view === "playlist" && nav.param === playlist.id}
          onclick={() => nav.go("playlist", playlist.id)}
        >
          <Artwork
            src={library.playlistTracks(playlist.id).find((track) => track.art)?.art ?? null}
            size="26px"
            radius="6px"
          />
          <span class="label">{playlist.name}</span>
        </button>
      {/each}
      {#if library.playlists.length === 0}
        <div class="empty-note">No playlists yet</div>
      {/if}
    </section>
  </div>

  {#if library.scanning}
    <div class="scan-status" role="status" aria-live="polite">
      <span class="scan-spinner" aria-hidden="true"></span>
      <span>Refreshing library…</span>
    </div>
  {/if}

  <button
    class="item settings"
    class:active={nav.view === "settings"}
    onclick={() => nav.go("settings")}
  >
    <span class="icon"><SidebarIcon name="settings" size={18} /></span>
    <span class="label">Settings</span>
  </button>
</nav>

<style>
  .sidebar {
    flex-shrink: 0;
    min-width: 190px;
    background: var(--chrome-tint);
    backdrop-filter: var(--chrome-blur);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 14px 12px 12px;
    gap: 9px;
    overflow: hidden;
  }
  .search {
    min-height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 11px;
    color: var(--text-dim);
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .search:focus-within {
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .search input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }
  .nav-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 7px;
    scrollbar-width: none;
  }
  .nav-scroll::-webkit-scrollbar {
    display: none;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .section-head {
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 9px 3px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 720;
  }
  .pin-count {
    font-variant-numeric: tabular-nums;
  }
  .item {
    min-height: 35px;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 6px 9px;
    border-radius: 8px;
    color: var(--text-dim);
    text-align: left;
    font-size: 13px;
    transition:
      background 150ms ease,
      color 150ms ease,
      transform 220ms var(--motion-spring);
  }
  .item:hover {
    color: var(--text);
    background: var(--hover);
    transform: translateX(2px);
  }
  .item.active {
    color: var(--text);
    background: var(--active);
    font-weight: 650;
  }
  .icon {
    width: 20px;
    display: grid;
    place-items: center;
    color: var(--accent);
    flex: none;
  }
  .label {
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .playlist {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .playlist-head {
    padding-right: 4px;
  }
  .add {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    color: var(--text-dim);
  }
  .add:hover {
    color: var(--text);
    background: var(--hover);
  }
  .pin-row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  .pin-row:hover {
    background: var(--hover);
  }
  .pin-item {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 4px 30px 4px 7px;
    text-align: left;
  }
  .pin-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .pin-copy strong,
  .pin-copy small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pin-copy strong {
    color: var(--text);
    font-size: 12px;
    font-weight: 650;
  }
  .pin-copy small {
    color: var(--text-faint);
    font-size: 10px;
    margin-top: 1px;
  }
  .unpin {
    position: absolute;
    right: 5px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--text-faint);
    opacity: 0;
  }
  .pin-row:hover .unpin,
  .unpin:focus-visible {
    opacity: 1;
  }
  .unpin:hover {
    color: var(--text);
    background: var(--active);
  }
  .empty-note {
    padding: 5px 9px 8px;
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.35;
  }
  .settings {
    flex: none;
  }
  .scan-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 9px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .scan-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .item:hover {
      transform: none;
    }
    .scan-spinner {
      animation: none;
      border-style: dotted;
    }
  }
</style>
