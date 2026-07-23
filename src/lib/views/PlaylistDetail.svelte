<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import TrackList from "$lib/TrackList.svelte";

  const playlist = $derived(
    library.playlists.find((p) => p.id === nav.param) ?? null,
  );
  const tracks = $derived(nav.param ? library.playlistTracks(nav.param) : []);
  const totalTime = $derived(tracks.reduce((s, t) => s + t.duration, 0));

  let editingName = $state(false);
  let nameDraft = $state("");

  function startRename() {
    if (!playlist) return;
    nameDraft = playlist.name;
    editingName = true;
  }
  async function commitRename() {
    if (playlist) await library.renamePlaylist(playlist.id, nameDraft);
    editingName = false;
  }
  async function del() {
    if (playlist && confirm(`Delete playlist "${playlist.name}"?`)) {
      await library.deletePlaylist(playlist.id);
      nav.go("home");
    }
  }
  function play(i: number) {
    player.setQueue(tracks, i);
  }
</script>

<div class="view">
  {#if !playlist}
    <div class="note">Playlist not found.</div>
  {:else}
    <div class="kicker">Playlist</div>
    <div class="head">
      {#if editingName}
        <input
          class="name-input"
          bind:value={nameDraft}
          onblur={commitRename}
          onkeydown={(e) => e.key === "Enter" && commitRename()}
        />
      {:else}
        <h1 ondblclick={startRename}>{playlist.name}</h1>
      {/if}
      <div class="tools">
        <button class="pill-btn" onclick={() => library.togglePin("playlist", playlist.id)}>
          {library.isPinned("playlist", playlist.id) ? "Unpin" : "Pin Playlist"}
        </button>
        <button class="pill-btn" onclick={startRename}>Rename</button>
        <button class="pill-btn danger" onclick={del}>Delete</button>
      </div>
    </div>
    <div class="stats">{tracks.length} songs · {formatTime(totalTime)}</div>

    {#if tracks.length > 0}
      <div class="cta">
        <button class="pill-btn filled" onclick={() => play(0)}>▶ Play</button>
      </div>
      <TrackList
        {tracks}
        onplay={play}
        playlistId={playlist.id}
        showArt={true}
        onreorder={(f, t) => library.reorderPlaylist(playlist.id, f, t)}
      />
    {:else}
      <div class="note">
        This playlist is empty. Add songs from the ⋯ menu on any track.
      </div>
    {/if}
  {/if}
</div>

<style>
  .kicker {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--accent);
    margin-bottom: 6px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  h1 {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .name-input {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.5px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: inherit;
    padding: 2px 10px;
    outline: none;
  }
  .tools {
    display: flex;
    gap: 8px;
  }
  .danger {
    color: #ff5a5a;
  }
  .stats {
    color: var(--text-faint);
    font-size: 13px;
    margin: 6px 0 16px;
  }
  .cta {
    margin-bottom: 12px;
  }
  .note {
    color: var(--text-dim);
    margin-top: 40px;
    text-align: center;
  }
</style>
