<script lang="ts">
  import { fade } from "svelte/transition";
  import { nav } from "$lib/nav.svelte";

  import Home from "$lib/views/Home.svelte";
  import Recent from "$lib/views/Recent.svelte";
  import Songs from "$lib/views/Songs.svelte";
  import Albums from "$lib/views/Albums.svelte";
  import AlbumDetail from "$lib/views/AlbumDetail.svelte";
  import Videos from "$lib/views/Videos.svelte";
  import Playlists from "$lib/views/Playlists.svelte";
  import PlaylistDetail from "$lib/views/PlaylistDetail.svelte";
  import QueueView from "$lib/views/QueueView.svelte";
  import Lyrics from "$lib/views/Lyrics.svelte";
  import Settings from "$lib/views/Settings.svelte";
</script>

{#key `${nav.view}:${nav.param ?? ""}`}
  <div class="page" in:fade={{ duration: 150 }} out:fade={{ duration: 90 }}>
    {#if nav.view === "home"}
      <Home />
    {:else if nav.view === "recent"}
      <Recent />
    {:else if nav.view === "songs"}
      <Songs />
    {:else if nav.view === "albums"}
      <Albums />
    {:else if nav.view === "album"}
      <AlbumDetail />
    {:else if nav.view === "videos"}
      <Videos />
    {:else if nav.view === "playlists"}
      <Playlists />
    {:else if nav.view === "playlist"}
      <PlaylistDetail />
    {:else if nav.view === "queue"}
      <QueueView />
    {:else if nav.view === "lyrics"}
      <Lyrics />
    {:else if nav.view === "settings"}
      <Settings />
    {/if}
  </div>
{/key}

<style>
  .page {
    position: absolute;
    inset: 0;
    animation: page-arrive 360ms var(--motion-spring) both;
    transform-origin: 50% 45%;
  }
  @keyframes page-arrive {
    from {
      transform: translateY(5px) scale(0.993);
    }
    to {
      transform: translateY(0) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .page {
      animation: none;
    }
  }
</style>
