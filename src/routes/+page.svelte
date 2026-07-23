<script lang="ts">
  import { fade } from "svelte/transition";
  import { nav } from "$lib/nav.svelte";
  import { player } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import { layout } from "$lib/layout.svelte";
  import {
    DEFAULT_ARTWORK_PALETTE,
    extractArtworkPalette,
    type ArtworkPalette,
  } from "$lib/accent";
  import Sidebar from "$lib/Sidebar.svelte";
  import Resizer from "$lib/Resizer.svelte";
  import PlayerBar from "$lib/PlayerBar.svelte";
  import NowPlayingPanel from "$lib/NowPlayingPanel.svelte";
  import DynamicBackground from "$lib/DynamicBackground.svelte";
  import EditTagsModal from "$lib/EditTagsModal.svelte";
  import Immersive from "$lib/Immersive.svelte";
  import Titlebar from "$lib/Titlebar.svelte";
  import ContextMenu from "$lib/ContextMenu.svelte";

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

  let backdrop = $state<{
    key: string;
    art: string | null;
    palette: ArtworkPalette;
  }>({
    key: "fallback",
    art: null,
    palette: DEFAULT_ARTWORK_PALETTE,
  });

  function applyPalette(palette: ArtworkPalette) {
    const root = document.documentElement;
    root.style.setProperty("--accent", palette.accent);
    root.style.setProperty("--accent-2", palette.accentLight);
    root.style.setProperty("--art-primary", palette.primary);
    root.style.setProperty("--art-secondary", palette.secondary);
    root.style.setProperty("--art-tertiary", palette.tertiary);
    root.style.setProperty("--art-deep", palette.deep);
  }

  // Keep the previous background visible until the next artwork palette is ready,
  // then crossfade the entire colour field as one layer.
  $effect(() => {
    const art = player.current?.art;
    const key = player.current?.path ?? art ?? "fallback";
    if (!art) {
      applyPalette(DEFAULT_ARTWORK_PALETTE);
      backdrop = {
        key: "fallback",
        art: null,
        palette: DEFAULT_ARTWORK_PALETTE,
      };
      return;
    }

    let cancelled = false;
    extractArtworkPalette(art).then((result) => {
      if (cancelled) return;
      const palette = result ?? DEFAULT_ARTWORK_PALETTE;
      applyPalette(palette);
      backdrop = { key, art, palette };
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="app">
  <Titlebar />
  <div class="background-stack" aria-hidden="true">
    {#key backdrop.key}
      <div
        class="background-frame"
        in:fade={{ duration: 650 }}
        out:fade={{ duration: 420 }}
      >
        <DynamicBackground art={backdrop.art} palette={backdrop.palette} />
      </div>
    {/key}
  </div>

  <div class="workspace">
    <Sidebar />
    <Resizer onmove={(x) => layout.setSidebar(x)} />
    <section class="content-shell">
      <PlayerBar />
      <div class="content-row">
        <main>
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
        </main>
        {#if ui.sidePanel !== "none"}
          <NowPlayingPanel />
        {/if}
      </div>
    </section>
  </div>
</div>

<EditTagsModal />
{#if ui.immersive}
  <Immersive />
{/if}

<ContextMenu />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    position: relative;
    overflow: hidden;
    background: var(--art-deep);
  }
  .background-stack,
  .background-frame {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .background-stack {
    overflow: hidden;
  }
  .background-frame {
    animation: background-arrive 720ms var(--motion-spring-strong) both;
  }
  .workspace {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
    z-index: 1;
  }
  .content-shell {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .content-row {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    position: relative;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(22px) saturate(1.08);
  }
  .page {
    position: absolute;
    inset: 0;
    animation: page-arrive 360ms var(--motion-spring) both;
    transform-origin: 50% 45%;
  }
  @keyframes background-arrive {
    from {
      transform: scale(1.055);
    }
    to {
      transform: scale(1);
    }
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
    .background-frame,
    .page {
      animation: none;
    }
  }
</style>
