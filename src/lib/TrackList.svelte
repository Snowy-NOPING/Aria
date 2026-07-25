<script lang="ts">
  import { player, formatTime, type TrackMeta } from "$lib/player.svelte";
  import { library } from "$lib/library.svelte";
  import { edit } from "$lib/edit.svelte";
  import NowPlayingWaveform from "$lib/NowPlayingWaveform.svelte";

  let {
    tracks,
    onplay,
    showAlbum = true,
    showArt = false,
    playlistId = null,
    albumId = null,
    onreorder = null,
  }: {
    tracks: TrackMeta[];
    onplay: (index: number) => void;
    showAlbum?: boolean;
    showArt?: boolean;
    playlistId?: string | null;
    albumId?: string | null;
    onreorder?: ((from: number, to: number) => void) | null;
  } = $props();

  // Which row's "…" menu is open (by path), and where.
  let menuFor = $state<string | null>(null);

  // Drag-to-reorder state.
  const reorderable = $derived(!!onreorder);
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  // Pointer-based reordering — HTML5 drag-and-drop is unreliable in WebView2,
  // so we hit-test rows manually while the pointer is down on a grip.
  let listEl = $state<HTMLElement | null>(null);

  function gripPointerDown(e: PointerEvent, i: number) {
    if (!onreorder) return;
    e.preventDefault();
    dragFrom = i;
    dragOver = i;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }
  function onPointerMove(e: PointerEvent) {
    if (dragFrom === null || !listEl) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const row = el?.closest<HTMLElement>(".row");
    if (row && listEl.contains(row) && row.dataset.i != null) {
      dragOver = +row.dataset.i;
    }
  }
  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
      onreorder?.(dragFrom, dragOver);
    }
    dragFrom = null;
    dragOver = null;
  }

  function isCurrent(t: TrackMeta) {
    return player.current?.path === t.path;
  }
  function toggleMenu(path: string) {
    menuFor = menuFor === path ? null : path;
  }
  async function addTo(pl: string, track: TrackMeta) {
    await library.addToPlaylist(pl, [track.path]);
    menuFor = null;
  }
  async function newPlaylistWith(track: TrackMeta) {
    const pl = await library.createPlaylist("New Playlist");
    await library.addToPlaylist(pl.id, [track.path]);
    menuFor = null;
  }
  async function addToAlbum(id: string, track: TrackMeta) {
    await library.addToAlbum(id, [track.path]);
    menuFor = null;
  }
  async function newAlbumWith(track: TrackMeta) {
    const a = await library.createAlbum("New Album");
    await library.addToAlbum(a.id, [track.path]);
    menuFor = null;
  }
  async function removeHere(track: TrackMeta) {
    if (playlistId) await library.removeFromPlaylist(playlistId, track.path);
    if (albumId) await library.removeFromAlbum(albumId, track.path);
    menuFor = null;
  }
</script>

<svelte:window onclick={() => (menuFor = null)} />

<div class="list" bind:this={listEl}>
  {#each tracks as track, i (track.path + i)}
    <div
      class="row"
      class:current={isCurrent(track)}
      class:art={showArt}
      class:reorderable
      class:dragover={dragOver === i && dragFrom !== i}
      class:dragging={dragFrom === i}
      data-i={i}
      role="button"
      tabindex="0"
      onclick={() => onplay(i)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onplay(i);
        }
      }}
    >
      {#if reorderable}
        <button
          class="grip"
          tabindex="-1"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          onpointerdown={(e) => gripPointerDown(e, i)}
          onclick={(e) => e.stopPropagation()}
        >⠿</button>
      {/if}
      <span class="num">
        {#if isCurrent(track)}
          <NowPlayingWaveform
            playing={player.playing && dragFrom !== i}
            bands={player.analyzerBands}
          />
        {:else}
          <span class="idx">{i + 1}</span>
          <button
            class="mini-play"
            aria-label="Play"
            onclick={(e) => {
              e.stopPropagation();
              onplay(i);
            }}>▶</button
          >
        {/if}
      </span>

      {#if showArt}
        <img class="thumb" src={track.art ?? ""} alt="" class:empty={!track.art} />
      {/if}

      <span class="titlecell">
        <span class="title">{track.title}</span>
        {#if !showAlbum}<span class="sub">{track.artist}</span>{/if}
      </span>

      {#if showAlbum}
        <span class="cell dim">{track.artist}</span>
        <span class="cell dim">{track.album}</span>
      {/if}

      <span class="dur">{formatTime(track.duration)}</span>

      <div class="actions">
        <button
          class="act"
          title="Edit info"
          aria-label="Edit info"
          onclick={(e) => {
            e.stopPropagation();
            edit.open(track);
          }}>✎</button
        >
        <button
          class="act"
          title="More"
          aria-label="More"
          onclick={(e) => {
            e.stopPropagation();
            toggleMenu(track.path);
          }}>⋯</button
        >
        {#if menuFor === track.path}
          <div class="menu" role="menu">
            <div class="menu-head">Add to Album</div>
            {#each library.albums as al}
              <button class="menu-item" onclick={(e) => { e.stopPropagation(); addToAlbum(al.id, track); }}>
                {al.name}
              </button>
            {/each}
            <button class="menu-item accent" onclick={(e) => { e.stopPropagation(); newAlbumWith(track); }}>
              + New Album
            </button>
            <div class="sep"></div>
            <div class="menu-head">Add to Playlist</div>
            {#each library.playlists as pl}
              <button class="menu-item" onclick={(e) => { e.stopPropagation(); addTo(pl.id, track); }}>
                {pl.name}
              </button>
            {/each}
            <button class="menu-item accent" onclick={(e) => { e.stopPropagation(); newPlaylistWith(track); }}>
              + New Playlist
            </button>
            <div class="sep"></div>
            <button
              class="menu-item"
              onclick={(e) => {
                e.stopPropagation();
                library.togglePin("song", track.path);
                menuFor = null;
              }}
            >
              {library.isPinned("song", track.path) ? "Unpin Song" : "Pin Song"}
            </button>
            {#if playlistId || albumId}
              <div class="sep"></div>
              <button class="menu-item danger" onclick={(e) => { e.stopPropagation(); removeHere(track); }}>
                Remove from {albumId ? "Album" : "Playlist"}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: grid;
    grid-template-columns: 34px 2fr 1.3fr 1.3fr 56px 64px;
    align-items: center;
    gap: 14px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    color: var(--text);
    outline: none;
    position: relative;
    z-index: 0;
    cursor: pointer;
    transform-origin: center;
    transition:
      background 150ms ease,
      box-shadow 180ms ease,
      transform 260ms var(--motion-spring);
  }
  .row.art {
    grid-template-columns: 34px 40px 2fr 1.3fr 1.3fr 56px 64px;
  }
  .row:not(.dragging):hover {
    background: var(--hover);
    box-shadow: var(--shadow-sm);
    transform: translateY(-2px) scale(1.008);
    z-index: 1;
  }
  .row:not(.dragging):active {
    transform: translateY(0) scale(0.985);
    transition-duration: 90ms;
  }
  .row.current {
    color: var(--accent);
    font-weight: 600;
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .row.reorderable {
    position: relative;
    padding-left: 26px;
  }
  .grip {
    position: absolute;
    left: 2px;
    top: 0;
    bottom: 0;
    width: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    font-size: 14px;
    cursor: grab;
    opacity: 0;
    user-select: none;
  }
  .row:hover .grip {
    opacity: 1;
  }
  .grip:active {
    cursor: grabbing;
  }
  .row.dragging {
    opacity: 0.4;
    transform: none;
    box-shadow: none;
  }
  .row.dragging,
  .row.dragging * {
    animation: none !important;
    transition: none !important;
  }
  .row.dragging .thumb {
    transform: none;
  }
  .row.dragover {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .num {
    text-align: center;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    position: relative;
  }
  .row.current .num {
    color: var(--accent);
  }
  .mini-play {
    display: none;
    color: var(--text);
    font-size: 11px;
  }
  .row:hover .mini-play {
    display: inline;
  }
  .row:hover .idx {
    display: none;
  }
  .thumb {
    width: 40px;
    height: 40px;
    border-radius: 5px;
    object-fit: cover;
    background: var(--surface);
    transition: transform 280ms var(--motion-spring);
  }
  .row:not(.dragging):hover .thumb {
    transform: scale(1.06);
  }
  .titlecell {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 12px;
    color: var(--text-dim);
  }
  .cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dim {
    color: var(--text-dim);
    font-size: 13px;
  }
  .dur {
    text-align: right;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 2px;
    justify-content: flex-end;
    position: relative;
  }
  .act {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--text-dim);
    opacity: 0;
    font-size: 13px;
  }
  .row:hover .act {
    opacity: 1;
  }
  .act:hover {
    background: var(--active);
    color: var(--text);
  }
  .menu {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: 50;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    padding: 5px;
    min-width: 180px;
    max-height: 280px;
    overflow-y: auto;
  }
  .menu-head {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-faint);
    padding: 6px 10px 4px;
  }
  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu-item:hover {
    background: var(--hover);
  }
  .menu-item.accent {
    color: var(--accent);
    font-weight: 600;
  }
  .menu-item.danger {
    color: #ff5a5a;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .row:not(.dragging):hover,
    .row:not(.dragging):active,
    .row.dragging,
    .row:not(.dragging):hover .thumb {
      transform: none;
    }
  }
</style>
