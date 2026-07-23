<script lang="ts">
  import { player } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import ImmersiveIcon from "$lib/icons/ImmersiveIcon.svelte";
  import { nav } from "$lib/nav.svelte";
  import { edit } from "$lib/edit.svelte";
  import { library } from "$lib/library.svelte";
  import { contextMenu } from "$lib/contextMenuState.svelte";

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

  const progress = $derived(
    player.duration > 0 ? (player.position / player.duration) * 100 : 0,
  );
  const volume = $derived(player.volume * 100);
</script>

<footer class="bar" data-tauri-drag-region>
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

  <button 
    class="now-playing" 
    onclick={() => player.current && ui.toggleSidePanel("lyrics")} 
    oncontextmenu={handleContextMenu}
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
    <span class="center-progress" style="--pct:{progress}%"></span>
  </button>

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
</footer>

<style>
  .bar {
    height: 58px;
    flex: none;
    position: relative;
    z-index: 8;
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(300px, 500px) minmax(220px, 1fr);
    align-items: center;
    gap: 18px;
    padding: 0 14px;
    color: var(--text);
    background: color-mix(in srgb, var(--sidebar) 78%, transparent);
    backdrop-filter: blur(30px) saturate(1.4);
    border-bottom: 1px solid var(--border);
  }
  .transport,
  .right {
    display: flex;
    align-items: center;
  }
  .transport {
    justify-content: flex-start;
    gap: 3px;
  }
  .right {
    justify-content: flex-end;
    gap: 7px;
    color: var(--text-dim);
  }
  .control,
  .panel-button {
    width: 34px;
    height: 34px;
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
    width: 38px;
    height: 38px;
  }
  .now-playing {
    position: relative;
    width: 100%;
    height: 50px;
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
  .center-progress {
    --pct: 0%;
    position: absolute;
    left: 50px;
    right: 7px;
    bottom: 3px;
    height: 2px;
    border-radius: 99px;
    background: linear-gradient(
      to right,
      var(--accent) var(--pct),
      var(--active) var(--pct)
    );
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
  @media (max-width: 900px) {
    .bar {
      grid-template-columns: auto minmax(220px, 1fr) auto;
      gap: 7px;
    }
    .control.secondary,
    .slider,
    .right > :global(svg) {
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
  }
</style>
