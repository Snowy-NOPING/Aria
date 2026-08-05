<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import TrackList from "$lib/TrackList.svelte";
  import ArtistLink from "$lib/ArtistLink.svelte";

  const album = $derived(nav.param ? library.albumById(nav.param) : undefined);
  const tracks = $derived(nav.param ? library.albumTracks(nav.param) : []);
  const totalTime = $derived(tracks.reduce((s, t) => s + t.duration, 0));
  const cover = $derived(album?.art ?? tracks.find((t) => t.art)?.art ?? null);
  /** Folder albums mirror what's on disk, so their name, artist and cover
   *  aren't editable here — changing one would only desync it from the files.
   *  The running order isn't part of that: it's ours to set either way. */
  const readOnly = $derived(!!album && library.isFolderAlbum(album.id));
  const customOrder = $derived(!!album && library.hasCustomOrder(album.id));

  let editingName = $state(false);
  let nameDraft = $state("");
  let editingArtist = $state(false);
  let artistDraft = $state("");

  function startRename() {
    if (!album || readOnly) return;
    nameDraft = album.name;
    editingName = true;
  }
  async function commitName() {
    if (album) await library.renameAlbum(album.id, nameDraft);
    editingName = false;
  }
  function startArtist() {
    if (!album || readOnly) return;
    artistDraft = album.artist;
    editingArtist = true;
  }
  async function commitArtist() {
    if (album) await library.setAlbumArtist(album.id, artistDraft.trim());
    editingArtist = false;
  }
  async function pickCover() {
    if (!album || readOnly) return;
    const img = await library.pickImage();
    if (img) await library.setAlbumCover(album.id, img);
  }
  async function del() {
    if (!album || readOnly) return;
    if (confirm(`Delete album "${album.name}"? (Songs stay in your library.)`)) {
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
    <!-- Back button lives inside the bleed so the artwork gradient reaches the
         very top of the view; otherwise it starts below the button and leaves
         a flat band across the top of the page. -->
    <div class="hero-wrap">
      <button class="back" onclick={() => nav.go("albums")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        <span>Albums</span>
      </button>
      <div class="hero">
        {#if readOnly}
          <div class="cover">
            <Artwork src={cover} size="clamp(240px, 28vw, 360px)" radius="10px" />
          </div>
        {:else}
          <button class="cover" onclick={pickCover} title="Change cover">
            <Artwork src={cover} size="clamp(240px, 28vw, 360px)" radius="10px" />
            <span class="cover-hint">Change Cover</span>
          </button>
        {/if}
        <div class="info">
          <div class="kicker">{readOnly ? "Folder" : "Album"}</div>
          {#if editingName}
            <input class="name-input" bind:value={nameDraft} onblur={commitName}
              onkeydown={(e) => e.key === "Enter" && commitName()} />
          {:else}
            <h1 ondblclick={startRename}>{album.name}</h1>
          {/if}
          {#if editingArtist}
            <input class="artist-input" bind:value={artistDraft} onblur={commitArtist}
              onkeydown={(e) => e.key === "Enter" && commitArtist()} placeholder="Album artist" />
          {:else if album.artist}
            <!-- The name is a link to the artist; editing it is a double-click,
                 the same gesture that renames the album title above. -->
            <div class="artist" ondblclick={startArtist} role="presentation">
              <ArtistLink artist={album.artist} />
            </div>
          {:else if !readOnly}
            <button class="artist" onclick={startArtist}>Add artist…</button>
          {/if}
          <div class="stats">{tracks.length} songs · {formatTime(totalTime)}</div>
          <div class="cta">
            <button class="pill-btn filled" onclick={() => play(0)} disabled={!tracks.length}>▶ Play</button>
            <button class="pill-btn" onclick={() => library.togglePin("album", album.id)}>
              {library.isPinned("album", album.id) ? "Unpin" : "Pin Album"}
            </button>
            {#if !readOnly}
              <button class="pill-btn" onclick={pickCover}>Set Cover</button>
              <button class="pill-btn" onclick={startRename}>Rename</button>
              <button class="pill-btn danger" onclick={del}>Delete</button>
            {:else if customOrder}
              <!-- Only offered once there's something to undo: a folder in tag
                   order has nothing to reset to. -->
              <button class="pill-btn" onclick={() => library.clearFolderOrder(album.id)}>
                Reset Order
              </button>
            {/if}
          </div>
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
        {readOnly
          ? "This folder has no playable audio."
          : "No songs yet. Add songs from the ⋯ menu on any track in your library."}
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
  /* Bleeds out through `.view`'s padding on all three sides so the artwork
     gradient runs edge to edge and up to the very top of the page. The
     negative margin must mirror `.view`'s padding exactly — see the narrow
     breakpoint below, where that padding changes. */
  .hero-wrap {
    margin: -28px -32px 24px;
    padding: 28px 42px 34px;
    background:
      linear-gradient(to bottom, color-mix(in srgb, var(--art-primary) 58%, transparent), transparent),
      linear-gradient(120deg, color-mix(in srgb, var(--art-secondary) 34%, transparent), transparent 70%);
  }
  /* A fixed-palette theme has no artwork colour to bleed, so the same gradient
     would just be a slab of brand orange. Claude puts a page header on a second
     paper tone instead, and lets the cover supply the only colour. */
  :global(html[data-skin="claude"]) .hero-wrap {
    background: var(--bg-deep);
    border-bottom: 1px solid var(--border);
  }
  .hero {
    display: flex;
    gap: clamp(28px, 3.5vw, 54px);
    align-items: center;
    min-height: 390px;
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
  /* Only the "Add artist…" affordance highlights as a whole; when the line
     holds real names, each one lights up on its own. */
  button.artist:hover {
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
  /* `.view` drops to `20px 18px` here, so the bleed has to follow or the
     gradient stops short of the edges. */
  @media (max-width: 900px) {
    .hero-wrap {
      margin: -20px -18px 20px;
      padding: 20px 18px 28px;
    }
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
