<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { nav } from "./nav.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import ImmersiveIcon from "$lib/icons/ImmersiveIcon.svelte";
  import { edit } from "$lib/edit.svelte";
  import { library } from "$lib/library.svelte";
  import { contextMenu } from "$lib/contextMenuState.svelte";

  let isHovered = $state(false);
  let maximized = $state(false);
  const appWindow = getCurrentWindow();

  function minimize() {
    void appWindow.minimize();
  }

  function toggleMaximize() {
    void appWindow.toggleMaximize();
  }

  function close() {
    void appWindow.close();
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then((m) => (maximized = m));
    appWindow
      .onResized(() => {
        void appWindow.isMaximized().then((m) => (maximized = m));
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  });

  function handleContextMenu(e: MouseEvent) {
    const track = player.current;
    if (!track) return;
    e.preventDefault();

    const playlistsMenu = library.playlists.map(pl => ({
      label: pl.name,
      icon: "playlist",
      action: () => library.addToPlaylist(pl.id, [track.path])
    }));

    playlistsMenu.push({
      label: "+ New Playlist...",
      icon: "playlist-add",
      action: async () => {
        const pl = await library.createPlaylist("New Playlist");
        await library.addToPlaylist(pl.id, [track.path]);
      }
    });

    const lastPlaylist = library.lastPlaylistId ? library.playlistById(library.lastPlaylistId) : null;
    const lastPlaylistLabel = lastPlaylist ? `Add to Last Playlist, ${lastPlaylist.name}` : "Add to Last Playlist";

    contextMenu.show(e.clientX, e.clientY, [
      {
        label: library.isPinned("song", track.path) ? "Unpin" : "Pin",
        icon: "pin",
        action: () => library.togglePin("song", track.path)
      },
      {
        label: lastPlaylistLabel,
        icon: "playlist",
        disabled: !library.lastPlaylistId,
        action: () => library.lastPlaylistId && library.addToPlaylist(library.lastPlaylistId, [track.path])
      },
      {
        label: "Add to Playlist",
        icon: "playlist-add",
        submenu: playlistsMenu
      },
      { label: "SEPARATOR" },
      {
        label: "Play Next",
        icon: "play-next",
        action: () => player.playNext(track)
      },
      {
        label: "Play Later",
        icon: "play-later",
        action: () => player.addToQueue([track])
      },
      {
        label: "Start Radio",
        icon: "radio",
        disabled: true
      },
      { label: "SEPARATOR" },
      {
        label: "Favorite",
        icon: "star",
        disabled: true
      },
      {
        label: "Suggest Less",
        icon: "suggest-less",
        disabled: true
      },
      {
        label: "Properties",
        icon: "properties",
        action: () => edit.open(track)
      },
      { label: "SEPARATOR" },
      {
        label: "Go to Artist",
        icon: "artist",
        action: () => {
          nav.query = track.artist;
          nav.go("songs");
        }
      },
      {
        label: "Go to Album",
        icon: "album",
        action: () => {
          const album = library.albums.find(a => a.name === track.album);
          if (album) {
            nav.go("album", album.id);
          } else {
            nav.query = track.album;
            nav.go("albums");
          }
        }
      },
      {
        label: "Go to Song",
        icon: "song",
        action: () => {
          nav.query = track.title;
          nav.go("songs");
        }
      },
      { label: "SEPARATOR" },
      {
        label: "Share",
        icon: "share",
        submenu: [
          { label: "Copy Link", disabled: true },
          { label: "Copy Embed Code", disabled: true }
        ]
      },
      {
        label: "Plugins",
        icon: "plugin",
        submenu: [
          { label: "No Plugins Installed", disabled: true }
        ]
      },
      { label: "SEPARATOR" },
      {
        label: "Remove from Library",
        icon: "remove",
        isDanger: true,
        disabled: true
      },
      { label: "SEPARATOR" },
      {
        label: "Immersive",
        icon: "immersive",
        action: () => ui.enter()
      },
      {
        label: "MiniPlayer",
        icon: "miniplayer",
        disabled: true
      },
      {
        label: "Developer",
        icon: "developer",
        submenu: [
          { label: "Developer Options", disabled: true }
        ]
      }
    ]);
  }

  // --- Seek bar -------------------------------------------------------------

  let seekEl = $state<HTMLElement | null>(null);
  let dragging = $state(false);
  let dragValue = $state(0);

  /** Show the dragged position while scrubbing so the bar tracks the pointer. */
  const seekPos = $derived(dragging ? dragValue : player.position);
  const progress = $derived(
    player.duration > 0
      ? Math.max(0, Math.min(1, seekPos / player.duration)) * 100
      : 0,
  );
  const volume = $derived(player.volume * 100);

  function positionFromEvent(e: PointerEvent): number {
    if (!seekEl || player.duration <= 0) return 0;
    const rect = seekEl.getBoundingClientRect();
    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(1, ratio)) * player.duration;
  }

  function seekPointerDown(e: PointerEvent) {
    if (e.button !== 0 || player.duration <= 0) return;
    // Keep the click off the pill underneath (which opens the lyrics panel).
    e.preventDefault();
    e.stopPropagation();
    seekEl?.setPointerCapture(e.pointerId);
    dragging = true;
    // Suppress incoming position updates so the thumb doesn't fight the drag.
    player.scrubbing = true;
    dragValue = positionFromEvent(e);
  }

  function seekPointerMove(e: PointerEvent) {
    if (!dragging) return;
    dragValue = positionFromEvent(e);
  }

  async function seekPointerUp(e: PointerEvent) {
    if (!dragging) return;
    const target = positionFromEvent(e);
    dragging = false;
    seekEl?.releasePointerCapture?.(e.pointerId);
    await player.seek(target);
    player.scrubbing = false;
  }

  function seekCancel() {
    if (!dragging) return;
    dragging = false;
    player.scrubbing = false;
  }

  async function seekKeydown(e: KeyboardEvent) {
    if (player.duration <= 0) return;
    const step = e.shiftKey ? 30 : 5;
    let target: number | null = null;
    if (e.key === "ArrowLeft") target = player.position - step;
    else if (e.key === "ArrowRight") target = player.position + step;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = player.duration;
    if (target === null) return;
    e.preventDefault();
    await player.seek(Math.max(0, Math.min(player.duration, target)));
  }
</script>

<!-- `deep` makes the whole bar draggable, including its layout containers and
     labels. Tauri exempts interactive descendants (buttons, inputs, and
     anything with an interactive role or a focusable tabindex — the seek bar),
     so grabbing empty chrome moves the window while every control still takes
     its own clicks. Double-clicking the bar maximizes/restores. -->
<div class="titlebar" data-tauri-drag-region="deep">
  <div class="left">
    <div
      class="window-controls"
      role="group"
      aria-label="Window controls"
      onmouseenter={() => isHovered = true}
      onmouseleave={() => isHovered = false}
    >
      <button class="window-btn close" onclick={close} aria-label="Close">
        {#if isHovered}
          <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        {/if}
      </button>
      <button class="window-btn minimize" onclick={minimize} aria-label="Minimize">
        {#if isHovered}
          <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14" /></svg>
        {/if}
      </button>
      <button class="window-btn maximize" onclick={toggleMaximize} aria-label={maximized ? "Restore" : "Maximize"}>
        {#if isHovered}
          {#if maximized}
            <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="4.5" y="8.5" width="10" height="10" rx="1.5" /><rect x="8.5" y="4.5" width="10" height="10" rx="1.5" /></svg>
          {:else}
            <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
          {/if}
        {/if}
      </button>
    </div>

    <div class="nav-controls">
      <button class="nav-btn" onclick={() => nav.goBack()} disabled={!nav.canGoBack} aria-label="Go back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      </button>
      <button class="nav-btn" onclick={() => nav.goForward()} disabled={!nav.canGoForward} aria-label="Go forward">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </button>
    </div>

    <div class="brand">Aria</div>

    <div class="transport">
      <button
        class="control secondary"
        class:on={player.shuffled}
        title="Shuffle"
        aria-label="Shuffle"
        aria-pressed={player.shuffled}
        onclick={() => player.toggleShuffle()}
      >
        <ImmersiveIcon name="shuffle" size={17} />
      </button>
      <button class="control" title="Previous" aria-label="Previous" onclick={() => player.prev()}>
        <ImmersiveIcon name="previous" size={20} />
      </button>
      <button
        class="control play"
        title={player.playing ? "Pause" : "Play"}
        aria-label={player.playing ? "Pause" : "Play"}
        onclick={() => player.togglePlay()}
      >
        <ImmersiveIcon name={player.playing ? "pause" : "play"} size={22} />
      </button>
      <button class="control" title="Next" aria-label="Next" onclick={() => player.next()}>
        <ImmersiveIcon name="next" size={20} />
      </button>
      <button
        class="control secondary"
        class:on={player.repeat !== "off"}
        title="Repeat"
        aria-label="Repeat"
        onclick={() => player.cycleRepeat()}
      >
        <ImmersiveIcon name="repeat" size={17} />
      </button>
    </div>
  </div>

  <!-- The seek bar sits beside the pill rather than inside it: a slider nested
       in a button can't receive its own pointer/keyboard input. -->
  <div class="now-playing-wrap" oncontextmenu={handleContextMenu} role="presentation">
    <button
      class="now-playing"
      onclick={() => player.current && ui.toggleSidePanel("lyrics")}
    >
      <Artwork src={player.current?.art} size="40px" radius="5px" />
      <span class="now-copy">
        <strong>{player.current?.title ?? "Not Playing"}</strong>
        <small>
          {#if player.current}
            {player.current.album} — {player.current.artist}
          {/if}
        </small>
      </span>
    </button>

    <div
      class="seek"
      class:dragging
      class:idle={player.duration <= 0}
      bind:this={seekEl}
      role="slider"
      tabindex={player.duration > 0 ? 0 : -1}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={player.duration}
      aria-valuenow={seekPos}
      aria-valuetext={`${formatTime(seekPos)} of ${formatTime(player.duration)}`}
      onpointerdown={seekPointerDown}
      onpointermove={seekPointerMove}
      onpointerup={seekPointerUp}
      onpointercancel={seekCancel}
      onkeydown={seekKeydown}
    >
      <div class="seek-track" style="--pct:{progress}%">
        <span class="seek-knob"></span>
      </div>
      {#if dragging}
        <span class="seek-bubble" style="left:{progress}%">
          {formatTime(seekPos)}
        </span>
      {/if}
    </div>
  </div>

  <div class="right">
    <ImmersiveIcon name="volume" size={17} />
    <div class="slider" style="--pct:{volume}%">
      <input
        aria-label="Volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={player.volume}
        oninput={(e) => player.setVolume(+(e.target as HTMLInputElement).value)}
      />
    </div>
    <button
      class="panel-button"
      class:on={ui.sidePanel === "lyrics"}
      title="Lyrics"
      aria-label="Lyrics"
      aria-pressed={ui.sidePanel === "lyrics"}
      onclick={() => ui.toggleSidePanel("lyrics")}
    >
      <ImmersiveIcon name="lyrics" size={18} />
    </button>
    <button
      class="panel-button"
      class:on={ui.sidePanel === "queue"}
      title="Queue"
      aria-label="Queue"
      aria-pressed={ui.sidePanel === "queue"}
      onclick={() => ui.toggleSidePanel("queue")}
    >
      <ImmersiveIcon name="queue" size={18} />
    </button>
    <button
      class="panel-button"
      title="Immersive mode"
      aria-label="Immersive mode"
      onclick={() => ui.enter()}
    >
      <ImmersiveIcon name="exit" size={17} />
    </button>
  </div>
</div>

<style>
  .titlebar {
    height: 56px;
    flex-shrink: 0;
    position: relative;
    /* Above the DynamicBackground layer (z-index: 0) so backdrop-filter
       actually samples the artwork wash instead of the flat app background —
       this is what was producing the flat black strip at the top. */
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(280px, 480px) minmax(210px, 1fr);
    align-items: center;
    gap: 14px;
    padding: 0 14px;
    color: var(--text);
    background: var(--chrome-tint);
    backdrop-filter: var(--chrome-blur);
    border-bottom: 1px solid var(--border);
    user-select: none;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .window-btn {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    position: relative;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.65);
    transition: filter 0.1s ease;
  }
  .window-btn:hover {
    filter: brightness(0.85);
  }
  .window-btn.close {
    background-color: #ff5f56;
    border: 0.5px solid #e0443e;
  }
  .window-btn.minimize {
    background-color: #ffbd2e;
    border: 0.5px solid #dfa123;
  }
  .window-btn.maximize {
    background-color: #27c93f;
    border: 0.5px solid #1aab29;
  }
  .symbol {
    position: absolute;
  }
  .nav-controls {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .nav-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--text-dim);
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
    transform: scale(1.03);
  }
  .nav-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .nav-btn:disabled {
    color: var(--text-faint);
    cursor: default;
    opacity: 0.45;
  }
  .brand {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: -0.3px;
    color: var(--text);
    white-space: nowrap;
    flex: none;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: none;
  }
  .control,
  .panel-button {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--text);
    transition:
      color 150ms ease,
      background 150ms ease,
      transform 220ms var(--motion-spring);
  }
  .control:hover,
  .panel-button:hover {
    background: var(--hover);
    transform: scale(1.07);
  }
  .control:active,
  .panel-button:active {
    transform: scale(0.9);
  }
  .control.secondary {
    color: var(--text-dim);
  }
  .control.on,
  .panel-button.on {
    color: var(--accent);
    background: var(--active);
  }
  .control.play {
    width: 36px;
    height: 36px;
  }
  .now-playing-wrap {
    position: relative;
    width: 100%;
  }
  .now-playing {
    position: relative;
    width: 100%;
    height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px 7px 5px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text);
    background: color-mix(in srgb, var(--surface) 80%, transparent);
    overflow: hidden;
    text-align: left;
  }
  .now-playing:hover {
    background: var(--hover);
  }
  .now-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-right: 40px;
  }
  .now-copy strong,
  .now-copy small {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now-copy strong {
    font-size: 12px;
    font-weight: 720;
  }
  .now-copy small {
    margin-top: 2px;
    color: var(--text-dim);
    font-size: 10px;
  }
  /* Overlays the bottom edge of the pill. The hit area is deliberately much
     taller than the 2px line so it's grabbable without hunting for it. */
  .seek {
    position: absolute;
    left: 50px;
    right: 7px;
    bottom: 0;
    height: 14px;
    display: flex;
    align-items: flex-end;
    padding-bottom: 3px;
    cursor: pointer;
    touch-action: none;
  }
  .seek.idle {
    pointer-events: none;
  }
  .seek-track {
    --pct: 0%;
    position: relative;
    width: 100%;
    height: 2px;
    border-radius: 99px;
    background: linear-gradient(
      to right,
      var(--accent) var(--pct),
      var(--active) var(--pct)
    );
    transition: height 140ms ease;
  }
  .seek:hover .seek-track,
  .seek:focus-visible .seek-track,
  .seek.dragging .seek-track {
    height: 4px;
  }
  .seek:focus-visible {
    outline: none;
  }
  .seek:focus-visible .seek-track {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .seek-knob {
    position: absolute;
    top: 50%;
    left: var(--pct);
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: var(--shadow-sm);
    opacity: 0;
    transform: translateY(-50%) scale(0.6);
    transition:
      opacity 140ms ease,
      transform 200ms var(--motion-spring);
  }
  .seek:hover .seek-knob,
  .seek:focus-visible .seek-knob,
  .seek.dragging .seek-knob {
    opacity: 1;
    transform: translateY(-50%) scale(1);
  }
  .seek-bubble {
    position: absolute;
    bottom: 15px;
    transform: translateX(-50%);
    padding: 2px 7px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--chrome-tint);
    backdrop-filter: var(--chrome-blur);
    color: var(--text);
    font-size: 11px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    color: var(--text-dim);
    min-width: 0;
  }
  .slider {
    --pct: 0%;
    position: relative;
    width: 82px;
    height: 4px;
    border-radius: 99px;
    background: linear-gradient(
      to right,
      var(--accent) var(--pct),
      var(--active) var(--pct)
    );
  }
  .slider input {
    -webkit-appearance: none;
    appearance: none;
    position: absolute;
    inset: -7px 0;
    width: 100%;
    height: 18px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  .slider input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0;
  }
  .slider:hover input::-webkit-slider-thumb,
  .slider input:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }
  @media (max-width: 1040px) {
    .titlebar {
      grid-template-columns: auto minmax(260px, 1fr) auto;
      gap: 8px;
    }
    .brand,
    .control.secondary,
    .slider,
    .right :global(svg) {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .control:hover,
    .control:active,
    .panel-button:hover,
    .panel-button:active {
      transform: none;
    }
    .nav-btn:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
