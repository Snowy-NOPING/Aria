<script lang="ts">
  import { fade } from "svelte/transition";
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
  import NowPlayingPanel from "$lib/NowPlayingPanel.svelte";
  import DynamicBackground from "$lib/DynamicBackground.svelte";
  import EditTagsModal from "$lib/EditTagsModal.svelte";
  import Immersive from "$lib/Immersive.svelte";
  import Titlebar from "$lib/Titlebar.svelte";
  import ContextMenu from "$lib/ContextMenu.svelte";
  import MainView from "$lib/MainView.svelte";

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
      <div class="content-row">
        <main>
          <MainView />
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
    /* Full-window base fill. Opaque by default, because the artwork wash above
       it (DynamicBackground) is blob-shaped and doesn't cover every pixel — the
       gaps would render as flat black. It only drops to `transparent` when a
       backdrop is active (Mica/Acrylic, or Mica For Everyone), i.e. when
       something really is compositing behind the window. */
    background: var(--app-base);
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
    background: color-mix(in srgb, var(--bg) var(--content-alpha), transparent);
    backdrop-filter: blur(22px) saturate(1.08);
  }
  @keyframes background-arrive {
    from {
      transform: scale(1.055);
    }
    to {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .background-frame {
      animation: none;
    }
  }
</style>
