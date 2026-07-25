<script lang="ts">
  import type { ArtworkPalette } from "$lib/accent";

  let {
    art = null,
    palette,
  }: {
    art?: string | null;
    palette: ArtworkPalette;
  } = $props();

  const paletteStyle = $derived(
    [
      `--art-primary:${palette.primary}`,
      `--art-secondary:${palette.secondary}`,
      `--art-tertiary:${palette.tertiary}`,
      `--art-deep:${palette.deep}`,
    ].join(";"),
  );
</script>

<div class="dynamic-background" style={paletteStyle}>
  {#if art}
    <div class="cover-wash" style="background-image:url({art})"></div>
  {/if}
  <div class="colour-blob blob-one"></div>
  <div class="colour-blob blob-two"></div>
  <div class="colour-blob blob-three"></div>
  <div class="colour-blob blob-four"></div>
  <div class="readability-veil"></div>
</div>

<style>
  .dynamic-background {
    position: absolute;
    inset: 0;
    overflow: hidden;
    isolation: isolate;
    /* The radial gradient and blobs don't cover every pixel, so the base fill
       underneath keeps the gaps from reading as flat black. With a backdrop
       active that base is transparent and the whole wash fades to
       `--wash-opacity` so the Mica/Acrylic material shows through it. */
    background:
      radial-gradient(circle at 50% 45%, var(--art-primary), transparent 70%),
      var(--app-base);
    opacity: var(--wash-opacity);
    pointer-events: none;
  }

  .cover-wash {
    position: absolute;
    inset: -4%;
    background-position: center;
    background-size: cover;
    filter: blur(var(--dynamic-bg-blur)) brightness(var(--dynamic-bg-brightness))
      saturate(1.25);
    opacity: 0.68;
    transform: scale(1.04);
  }

  .colour-blob {
    position: absolute;
    width: 76vmax;
    height: 76vmax;
    border-radius: 50%;
    filter: blur(56px) saturate(1.18);
    opacity: 0.74;
    mix-blend-mode: screen;
    will-change: transform;
  }

  .blob-one {
    left: -32vmax;
    top: -35vmax;
    background: radial-gradient(circle, var(--art-primary) 0 22%, transparent 68%);
    animation: orbit-one 25s linear infinite;
  }

  .blob-two {
    right: -35vmax;
    top: -30vmax;
    background: radial-gradient(circle, var(--art-secondary) 0 20%, transparent 67%);
    animation: orbit-two 30s linear infinite reverse;
  }

  .blob-three {
    left: -28vmax;
    bottom: -42vmax;
    background: radial-gradient(circle, var(--art-tertiary) 0 24%, transparent 69%);
    animation: orbit-two 27s linear infinite;
  }

  .blob-four {
    right: -30vmax;
    bottom: -40vmax;
    background: radial-gradient(circle, var(--art-primary) 0 18%, transparent 66%);
    animation: orbit-one 29s linear infinite reverse;
  }

  .readability-veil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgb(7 6 10 / 0.1), rgb(7 6 10 / 0.28)),
      radial-gradient(circle at 50% 35%, transparent 10%, rgb(7 6 10 / 0.18) 100%);
  }

  @keyframes orbit-one {
    from {
      transform: rotate(0deg) translate3d(0, 0, 0) scale(1);
    }
    50% {
      transform: rotate(180deg) translate3d(8vmax, 4vmax, 0) scale(1.08);
    }
    to {
      transform: rotate(360deg) translate3d(0, 0, 0) scale(1);
    }
  }

  @keyframes orbit-two {
    from {
      transform: rotate(0deg) translate3d(0, 0, 0) scale(1.08);
    }
    50% {
      transform: rotate(180deg) translate3d(-6vmax, 7vmax, 0) scale(0.96);
    }
    to {
      transform: rotate(360deg) translate3d(0, 0, 0) scale(1.08);
    }
  }

  @media (prefers-color-scheme: light) {
    .colour-blob {
      opacity: 0.58;
      mix-blend-mode: multiply;
    }
    .readability-veil {
      background: rgb(255 255 255 / 0.08);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .colour-blob {
      animation: none;
      will-change: auto;
    }
  }
</style>
