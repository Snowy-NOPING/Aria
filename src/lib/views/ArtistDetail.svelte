<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import AlbumCard from "$lib/AlbumCard.svelte";
  import TrackList from "$lib/TrackList.svelte";

  const name = $derived(nav.param ?? "");
  const tracks = $derived(name ? library.artistTracks(name) : []);
  const albums = $derived(name ? library.artistAlbums(name) : []);
  const image = $derived(name ? library.artistArt(name) : null);
  const totalTime = $derived(tracks.reduce((s, t) => s + t.duration, 0));

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

<div class="view">
  {#if !name || tracks.length === 0}
    <div class="note">Nothing in your library is credited to {name || "this artist"}.</div>
  {:else}
    <!-- Same bleed as the album page so the two detail pages feel like one
         family; the portrait is round to tell a person from a record. -->
    <div class="hero-wrap">
      <!-- An artist is reached from wherever you saw the name, so back means
           back — with Songs as the floor when there's no history to pop. -->
      <button class="back" onclick={() => (nav.canGoBack ? nav.goBack() : nav.go("songs"))}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        <span>Back</span>
      </button>
      <div class="hero">
        <button class="portrait" onclick={pickImage} title="Change artist image">
          <Artwork src={image} size="clamp(200px, 22vw, 280px)" radius="50%" />
          <span class="portrait-hint">Change Image</span>
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
            <button class="pill-btn" onclick={pickImage}>Set Image</button>
          </div>
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
  /* Mirrors `.view`'s padding exactly — see the narrow breakpoint below. */
  .hero-wrap {
    margin: -28px -32px 24px;
    padding: 28px 42px 34px;
    background:
      linear-gradient(to bottom, color-mix(in srgb, var(--art-primary) 58%, transparent), transparent),
      linear-gradient(120deg, color-mix(in srgb, var(--art-secondary) 34%, transparent), transparent 70%);
  }
  :global(html[data-skin="claude"]) .hero-wrap {
    background: var(--bg-deep);
    border-bottom: 1px solid var(--border);
  }
  .hero {
    display: flex;
    gap: clamp(28px, 3.5vw, 54px);
    align-items: center;
    min-height: 320px;
  }
  .portrait {
    position: relative;
    padding: 0;
    line-height: 0;
    border-radius: 50%;
  }
  .portrait-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .portrait:hover .portrait-hint {
    opacity: 1;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 6px;
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
    font-size: clamp(34px, 3.3vw, 54px);
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .stats {
    font-size: 13px;
    color: var(--text-faint);
    margin-top: 2px;
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
  .note {
    color: var(--text-dim);
    margin-top: 40px;
    text-align: center;
  }
</style>
