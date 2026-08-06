<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import { theme } from "$lib/theme.svelte";
  import {
    DEFAULT_ARTWORK_PALETTE,
    extractArtworkPalette,
    type ArtworkPalette,
  } from "$lib/accent";
  import AlbumCard from "$lib/AlbumCard.svelte";
  import DynamicBackground from "$lib/DynamicBackground.svelte";
  import TrackList from "$lib/TrackList.svelte";

  const name = $derived(nav.param ?? "");
  const tracks = $derived(name ? library.artistTracks(name) : []);
  const albums = $derived(name ? library.artistAlbums(name) : []);
  const image = $derived(name ? library.artistArt(name) : null);
  /** A set portrait is meant to be looked at; a borrowed square cover is not —
   *  blown up to banner width it's just a pixelated crop, so it runs blurred
   *  behind the name as a colour field instead. */
  const borrowed = $derived(!!image && !library.artistImages[name]);
  const totalTime = $derived(tracks.reduce((s, t) => s + t.duration, 0));

  /**
   * The page carries its own colour field, taken from the banner, so the artist
   * you're reading colours the pane while the sidebar, player and lyrics keep
   * the playing track's. It lives inside this view rather than replacing the
   * window backdrop for that reason — two different things are on screen and
   * each keeps its own colour.
   */
  let field = $state<ArtworkPalette>(DEFAULT_ARTWORK_PALETTE);
  $effect(() => {
    const src = image;
    if (!src) {
      field = DEFAULT_ARTWORK_PALETTE;
      return;
    }
    let cancelled = false;
    extractArtworkPalette(src).then((palette) => {
      if (!cancelled) field = palette ?? DEFAULT_ARTWORK_PALETTE;
    });
    return () => {
      cancelled = true;
    };
  });

  function play(i: number) {
    player.setQueue(tracks, i);
  }
  async function shuffle() {
    if (!tracks.length) return;
    await player.setQueue(tracks, Math.floor(Math.random() * tracks.length));
    // `toggleShuffle` only shuffles what sits after the current track, so a
    // queue already flagged shuffled has to be cleared and re-set to reshuffle.
    if (player.shuffled) player.toggleShuffle();
    player.toggleShuffle();
  }
  async function pickImage() {
    const img = await library.pickImage();
    if (img) await library.setArtistImage(name, img);
  }
</script>

<div class="artist-page">
  <!-- Behind the scroller, not in it, so the field stays put while the page
       moves over it. A fixed-palette skin paints no field at all. -->
  {#if image && theme.artworkField}
    <div class="field" aria-hidden="true">
      <DynamicBackground art={image} palette={field} label="artist" />
    </div>
  {/if}
  <div class="view">
  {#if !name || tracks.length === 0}
    <div class="note">Nothing in your library is credited to {name || "this artist"}.</div>
  {:else}
    <!-- A banner rather than the album page's cover-and-column: a record is an
         object you look at, an artist is a person you look through to their
         work. The image runs the full width and the name sits in it. -->
    <div class="banner" class:photo={!!image}>
      {#if image}
        <div class="art" class:borrowed style="background-image: url('{image}')"></div>
      {/if}
      <!-- An artist is reached from wherever you saw the name, so back means
           back — with Songs as the floor when there's no history to pop. -->
      <button class="back" onclick={() => (nav.canGoBack ? nav.goBack() : nav.go("songs"))}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        <span>Back</span>
      </button>
      <div class="info">
        <div class="kicker">Artist</div>
        <h1>{name}</h1>
        <div class="stats">
          {tracks.length}
          {tracks.length === 1 ? "song" : "songs"}
          {#if albums.length}· {albums.length} {albums.length === 1 ? "album" : "albums"}{/if}
          · {formatTime(totalTime)}
        </div>
        <div class="cta">
          <button class="pill-btn filled" onclick={() => play(0)}>▶ Play</button>
          <button class="pill-btn" onclick={shuffle}>⤮ Shuffle</button>
          <button class="pill-btn" onclick={pickImage}>
            {image ? "Change Image" : "Set Image"}
          </button>
        </div>
      </div>
    </div>

    {#if albums.length > 0}
      <section>
        <h2>Albums</h2>
        <div class="grid">
          {#each albums as a (a.id)}
            <AlbumCard
              art={a.art ?? library.albumTracks(a.id).find((t) => t.art)?.art ?? null}
              title={a.name}
              subtitle={a.artist || `${a.trackPaths.length} songs`}
              onclick={() => nav.go("album", a.id)}
              onplay={() => player.setQueue(library.albumTracks(a.id), 0)}
            />
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <h2>Songs</h2>
      <TrackList {tracks} onplay={play} showArt={true} />
    </section>
  {/if}
  </div>
</div>

<style>
  /* The view is the scroller; the field sits behind it, both filling the pane. */
  .artist-page {
    position: absolute;
    inset: 0;
  }
  .field {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .view {
    position: relative;
    z-index: 1;
  }
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
  /* Bleeds through `.view`'s padding on three sides so the image runs edge to
     edge and up to the very top. The negative margin must mirror that padding
     exactly — see the narrow breakpoint below, where it changes. */
  .banner {
    position: relative;
    margin: -28px -32px 26px;
    padding: 28px 42px 30px;
    min-height: clamp(300px, 40vh, 440px);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .art {
    position: absolute;
    inset: 0;
    /* Faces sit above centre in most press shots, so bias the crop upward. */
    background-position: center 32%;
    background-size: cover;
    background-repeat: no-repeat;
    /* The photo is masked away at the bottom rather than covered by a fade to
       the page colour: what's underneath is the artist's own colour field, and
       painting a band of `--bg` over it would put a seam between the two. */
    -webkit-mask-image: linear-gradient(to bottom, #000 56%, transparent 98%);
    mask-image: linear-gradient(to bottom, #000 56%, transparent 98%);
  }
  /* Scaled past the edges so the blur has material to work with instead of
     fading out against the sides. */
  .art.borrowed {
    filter: blur(34px) saturate(1.3);
    transform: scale(1.18);
  }
  /* No image: the artwork-derived field, same as the album page. */
  .banner:not(.photo) {
    background-image:
      linear-gradient(to bottom, color-mix(in srgb, var(--art-primary) 58%, transparent), transparent),
      linear-gradient(120deg, color-mix(in srgb, var(--art-secondary) 34%, transparent), transparent 70%);
  }
  :global(html[data-skin="claude"]) .banner:not(.photo) {
    background-image: none;
    background: var(--bg-deep);
    border-bottom: 1px solid var(--border);
  }
  /* Holds white text legible over a photo nobody chose for contrast: a wash at
     the top for the Back button, and one from the left running the full height,
     since the name sits low where the image has already faded into the field.
     A pseudo-element keeps it off the content. */
  .banner.photo::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to bottom, rgba(0, 0, 0, 0.34) 0%, transparent 32%),
      linear-gradient(to right, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.12) 45%, transparent 70%);
    pointer-events: none;
  }
  /* Above both the image layer and the scrim. */
  .banner > :not(.art) {
    position: relative;
    z-index: 1;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .kicker {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--accent);
  }
  h1 {
    font-size: clamp(38px, 4.4vw, 68px);
    font-weight: 800;
    letter-spacing: -0.8px;
    line-height: 1.05;
  }
  .stats {
    font-size: 13px;
    color: var(--text-faint);
    margin-top: 2px;
  }
  /* Over a photo the type carries its own contrast rather than relying on the
     theme, which may be light. */
  .photo .kicker {
    color: rgba(255, 255, 255, 0.82);
  }
  .photo h1 {
    color: #fff;
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.45);
  }
  .photo .stats {
    color: rgba(255, 255, 255, 0.76);
    text-shadow: 0 1px 12px rgba(0, 0, 0, 0.4);
  }
  /* Glass over the image: the theme's own surface tint disappears on a photo. */
  .photo .cta .pill-btn:not(.filled),
  .photo .back {
    background: rgba(255, 255, 255, 0.16);
    backdrop-filter: blur(16px);
    border-color: rgba(255, 255, 255, 0.22);
    color: #fff;
  }
  .photo .cta .pill-btn:not(.filled):hover,
  .photo .back:hover {
    background: rgba(255, 255, 255, 0.26);
    color: #fff;
  }
  .back {
    align-self: flex-start;
  }
  .cta {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  section {
    margin-bottom: 32px;
  }
  h2 {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 16px;
  }
  /* `.view` drops to `20px 18px` here, so the bleed has to follow or the image
     stops short of the edges. */
  @media (max-width: 900px) {
    .banner {
      margin: -20px -18px 20px;
      padding: 20px 18px 24px;
      min-height: clamp(240px, 34vh, 340px);
    }
  }
  .note {
    color: var(--text-dim);
    margin-top: 40px;
    text-align: center;
  }
</style>
