<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import TrackList from "$lib/TrackList.svelte";

  const album = $derived(nav.param ? library.albumById(nav.param) : undefined);
  const tracks = $derived(nav.param ? library.albumTracks(nav.param) : []);
  const totalTime = $derived(tracks.reduce((s, t) => s + t.duration, 0));
  const cover = $derived(album?.art ?? tracks.find((t) => t.art)?.art ?? null);

  let editingName = $state(false);
  let nameDraft = $state("");
  let editingArtist = $state(false);
  let artistDraft = $state("");

  function startRename() {
    if (!album) return;
    nameDraft = album.name;
    editingName = true;
  }
  async function commitName() {
    if (album) await library.renameAlbum(album.id, nameDraft);
    editingName = false;
  }
  function startArtist() {
    if (!album) return;
    artistDraft = album.artist;
    editingArtist = true;
  }
  async function commitArtist() {
    if (album) await library.setAlbumArtist(album.id, artistDraft.trim());
    editingArtist = false;
  }
  async function pickCover() {
    if (!album) return;
    const img = await library.pickImage();
    if (img) await library.setAlbumCover(album.id, img);
  }
  async function del() {
    if (album && confirm(`Delete album "${album.name}"? (Songs stay in your library.)`)) {
      await library.deleteAlbum(album.id);
      nav.go("albums");
    }
  }
  function play(i: number) {
    player.setQueue(tracks, i);
  }
</script>

<div class="view">
  {#if !album}
    <div class="note">Album not found.</div>
  {:else}
    <button class="back" onclick={() => nav.go("albums")}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      <span>Albums</span>
    </button>
    <div class="hero">
      <button class="cover" onclick={pickCover} title="Change cover">
        <Artwork src={cover} size="clamp(240px, 28vw, 360px)" radius="10px" />
        <span class="cover-hint">Change Cover</span>
      </button>
      <div class="info">
        <div class="kicker">Album</div>
        {#if editingName}
          <input class="name-input" bind:value={nameDraft} onblur={commitName}
            onkeydown={(e) => e.key === "Enter" && commitName()} />
        {:else}
          <h1 ondblclick={startRename}>{album.name}</h1>
        {/if}
        {#if editingArtist}
          <input class="artist-input" bind:value={artistDraft} onblur={commitArtist}
            onkeydown={(e) => e.key === "Enter" && commitArtist()} placeholder="Album artist" />
        {:else}
          <button class="artist" onclick={startArtist}>
            {album.artist || "Add artist…"}
          </button>
        {/if}
        <div class="stats">{tracks.length} songs · {formatTime(totalTime)}</div>
        <div class="cta">
          <button class="pill-btn filled" onclick={() => play(0)} disabled={!tracks.length}>▶ Play</button>
          <button class="pill-btn" onclick={() => library.togglePin("album", album.id)}>
            {library.isPinned("album", album.id) ? "Unpin" : "Pin Album"}
          </button>
          <button class="pill-btn" onclick={pickCover}>Set Cover</button>
          <button class="pill-btn" onclick={startRename}>Rename</button>
          <button class="pill-btn danger" onclick={del}>Delete</button>
        </div>
      </div>
    </div>

    {#if tracks.length > 0}
      <TrackList
        {tracks}
        onplay={play}
        showAlbum={false}
        albumId={album.id}
        onreorder={(f, t) => library.reorderAlbum(album.id, f, t)}
      />
    {:else}
      <div class="note">
        No songs yet. Add songs from the ⋯ menu on any track in your library.
      </div>
    {/if}
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 14px 6px 10px;
    font-size: 13px;
    font-weight: 650;
    margin-bottom: 16px;
    transition: background 0.15s, color 0.15s, transform 220ms var(--motion-spring);
  }
  .back:hover {
    color: var(--text);
    background: var(--hover);
    transform: translateX(-1px);
  }
  .hero {
    display: flex;
    gap: clamp(28px, 3.5vw, 54px);
    margin: -28px -32px 24px;
    padding: 54px 42px 34px;
    align-items: center;
    min-height: 390px;
    background:
      linear-gradient(to bottom, color-mix(in srgb, var(--art-primary) 58%, transparent), transparent),
      linear-gradient(120deg, color-mix(in srgb, var(--art-secondary) 34%, transparent), transparent 70%);
  }
  .cover {
    position: relative;
    padding: 0;
    line-height: 0;
    border-radius: 12px;
  }
  .cover-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    border-radius: 12px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .cover:hover .cover-hint {
    opacity: 1;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 6px;
  }
  .kicker {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--accent);
  }
  h1 {
    font-size: clamp(34px, 3.3vw, 54px);
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .name-input {
    font-size: 34px;
    font-weight: 800;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: inherit;
    padding: 2px 10px;
    outline: none;
  }
  .artist {
    font-size: 17px;
    color: var(--text-dim);
    text-align: left;
    width: fit-content;
  }
  .artist:hover {
    color: var(--accent);
  }
  .artist-input {
    font-size: 17px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: inherit;
    padding: 3px 10px;
    outline: none;
    width: fit-content;
  }
  .stats {
    font-size: 13px;
    color: var(--text-faint);
    margin-top: 2px;
  }
  @media (max-width: 780px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
      min-height: 0;
    }
  }
  .cta {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .danger {
    color: #ff5a5a;
  }
  .note {
    color: var(--text-dim);
    margin-top: 40px;
    text-align: center;
  }
</style>
