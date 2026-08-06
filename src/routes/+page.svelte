<script lang="ts">
  import { player } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import { layout } from "$lib/layout.svelte";
  import { theme } from "$lib/theme.svelte";
  import {
    DEFAULT_ARTWORK_PALETTE,
    extractArtworkPalette,
    type ArtworkPalette,
  } from "$lib/accent";
  import Sidebar from "$lib/Sidebar.svelte";
  import Resizer from "$lib/Resizer.svelte";
  import NowPlayingPanel from "$lib/NowPlayingPanel.svelte";
  import DynamicBackground from "$lib/DynamicBackground.svelte";
  import { probeArtworkField } from "$lib/artworkField";
  import EditTagsModal from "$lib/EditTagsModal.svelte";
  import Immersive from "$lib/Immersive.svelte";
  import Titlebar from "$lib/Titlebar.svelte";
  import ContextMenu from "$lib/ContextMenu.svelte";
  import MainView from "$lib/MainView.svelte";

  let viewportWidth = $state(1280);
  $effect(() => layout.setViewport(viewportWidth));

  // Records whether the GPU colour field can run, before any track is played.
  // Without this the answer only exists while something is playing, which is
  // the one moment nobody is reading a log.
  $effect(() => {
    probeArtworkField();
  });

  let backdrop = $state<{
    key: string;
    art: string | null;
    palette: ArtworkPalette;
  }>({
    key: "fallback",
    art: null,
    palette: DEFAULT_ARTWORK_PALETTE,
  });

  /** `null` means there is no artwork to take colour from — see `data-idle`. */
  function applyPalette(palette: ArtworkPalette | null) {
    const root = document.documentElement;
    const entries: [string, string][] = palette
      ? [
          ["--accent", palette.accent],
          ["--accent-2", palette.accentLight],
          ["--art-primary", palette.primary],
          ["--art-secondary", palette.secondary],
          ["--art-tertiary", palette.tertiary],
          ["--art-deep", palette.deep],
        ]
      : [];
    // A fixed-palette skin (Claude) must not be repainted by the artwork, and
    // neither must an idle window. These are inline properties, which outrank
    // the stylesheet, so it isn't enough to stop writing them — the previous
    // track's colours have to be cleared.
    const names = [
      "--accent",
      "--accent-2",
      "--art-primary",
      "--art-secondary",
      "--art-tertiary",
      "--art-deep",
    ];
    const values = new Map(entries);
    for (const name of names) {
      const value = values.get(name);
      if (value && theme.artworkField) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    // Nothing to derive colour from: the stylesheet drops the window back to
    // plain theme surfaces rather than tinting them toward a default palette
    // nobody chose.
    root.toggleAttribute("data-idle", !palette);
  }

  // Hand the field the new artwork only once its palette is ready, so the
  // shader's dissolve and the surrounding chrome's colours move together.
  $effect(() => {
    // Read explicitly: the palette write below happens in a promise callback,
    // outside this effect's tracking scope, so a skin change would not
    // otherwise re-run it and clear the stale inline colours.
    void theme.skin;
    const art = player.current?.art;
    const key = player.current?.path ?? art ?? "fallback";
    if (!art) {
      applyPalette(null);
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

<svelte:window bind:innerWidth={viewportWidth} />

<div class="app">
  <Titlebar />
  <!-- Skins without a colour field paint nothing here, so the layer is left out
       entirely rather than rendered at zero opacity — four blurred, animating
       blobs are not free. -->
  {#if theme.artworkField}
    <!-- One long-lived layer, not one per track: the field dissolves between
         artworks inside the shader, and remounting it would throw away the
         WebGL context (and the outgoing texture) on every track change. -->
    <div class="background-stack" aria-hidden="true">
      <div class="background-frame">
        <DynamicBackground art={backdrop.art} palette={backdrop.palette} />
      </div>
    </div>
  {/if}

  <div class="workspace">
    <Sidebar />
    {#if !layout.rail}
      <Resizer onmove={(x) => layout.setSidebar(x)} />
    {/if}
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
  <Immersive {backdrop} />
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
    backdrop-filter: var(--content-blur);
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
