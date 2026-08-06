<script lang="ts">
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";
  import { player, formatTime } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import Artwork from "$lib/Artwork.svelte";
  import ArtistLink from "$lib/ArtistLink.svelte";
  import LyricsPanel from "$lib/LyricsPanel.svelte";
  import ImmersiveIcon from "$lib/icons/ImmersiveIcon.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import WindowControls from "$lib/WindowControls.svelte";
  import MainView from "$lib/MainView.svelte";
  import DynamicBackground from "$lib/DynamicBackground.svelte";
  import { theme } from "$lib/theme.svelte";
  import type { ArtworkPalette } from "$lib/accent";

  // The colour field is derived once in +page.svelte and handed down, so
  // immersive mode shows the same backdrop as the window behind it rather than
  // re-deriving a second, subtly different one.
  let {
    backdrop,
  }: {
    backdrop: { key: string; art: string | null; palette: ArtworkPalette };
  } = $props();

  let seeking = $state(false);
  let seekValue = $state(0);
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWake = 0;
  let menuOpen = $state(false);

  const pos = $derived(seeking ? seekValue : player.position);
  const progress = $derived(player.duration > 0 ? (pos / player.duration) * 100 : 0);
  const volPct = $derived(player.volume * 100);
  const upcoming = $derived(
    player.queue.slice(Math.max(0, player.currentIndex + 1)),
  );

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (seeking) return;
    idleTimer = setTimeout(() => {
      idle = true;
    }, 3200);
  }

  function wake(force = false) {
    const now = performance.now();
    if (!force && !idle && now - lastWake < 120) return;
    lastWake = now;
    idle = false;
    scheduleIdle();
  }

  function choosePanel(panel: "none" | "queue" | "lyrics") {
    ui.panel = panel;
    if (panel !== "none") ui.lastPanel = panel;
    wake(true);
  }

  function onSeekInput(e: Event) {
    seeking = true;
    player.scrubbing = true;
    seekValue = +(e.target as HTMLInputElement).value;
    wake(true);
  }

  async function onSeekCommit() {
    await player.seek(seekValue);
    seeking = false;
    player.scrubbing = false;
    scheduleIdle();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      ui.exit();
      return;
    }
    wake(true);
  }

  onMount(() => {
    window.scrollTo(0, 0);
    wake(true);
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
    };
  });
</script>

<svelte:window
  onkeydown={onKey}
  onpointermove={() => wake()}
  onpointerdown={() => wake(true)}
/>

<div
  class="immersive"
  class:idle
  class:has-panel={ui.panel !== "none"}
  transition:fade={{ duration: 260 }}
>
  <!-- Same layer as the main window, and the same reason it isn't keyed: the
       artwork dissolves inside the field. A fixed-palette skin paints no colour
       field, so the whole stack is left out rather than rendered at zero
       opacity. -->
  {#if theme.artworkField}
    <div class="background-stack" aria-hidden="true">
      <div class="background-frame">
        <DynamicBackground art={backdrop.art} palette={backdrop.palette} label="immersive" />
      </div>
    </div>
  {/if}
  <div class="scrim"></div>

  {#if !idle}
    <div class="window-chrome" transition:fade={{ duration: 160 }}>
      <WindowControls fullscreenAware />
    </div>

    <div class="menu-wrap" transition:fade={{ duration: 160 }}>
      <button
        class="menu-button"
        class:selected={menuOpen}
        title="Menu"
        aria-label="Immersive menu"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <ImmersiveIcon name="sidebar" size={18} />
      </button>
      {#if menuOpen}
        <button
          class="menu-scrim"
          aria-label="Close menu"
          onclick={() => (menuOpen = false)}
        ></button>
        <div class="menu" role="menu" transition:fade={{ duration: 120 }}>
          <button
            class="menu-item"
            role="menuitem"
            onclick={() => {
              menuOpen = false;
              ui.exit();
            }}
          >
            <ImmersiveIcon name="exit" size={16} />
            <span>Exit Immersive</span>
          </button>
          <button
            class="menu-item"
            role="menuitem"
            class:selected={ui.browserOpen}
            onclick={() => {
              menuOpen = false;
              ui.toggleBrowser();
            }}
          >
            <ImmersiveIcon name="browser" size={16} />
            <span>Browser</span>
          </button>
        </div>
      {/if}
    </div>

    <button
      class="exit-button"
      title="Exit immersive mode"
      aria-label="Exit immersive mode"
      onclick={() => ui.exit()}
      transition:fade={{ duration: 160 }}
    >
      <ImmersiveIcon name="exit" size={18} />
    </button>
  {/if}

  <main class="stage">
    <section class="player-column" aria-label="Now playing">
      <button
        class="art-hero"
        title={ui.panel === "none" ? "Show lyrics/queue" : "Hide panel"}
        aria-label={ui.panel === "none" ? "Show lyrics or queue" : "Hide panel"}
        onclick={() => {
          ui.toggleArtworkPanel();
          wake(true);
        }}
      >
        <Artwork
          src={player.current?.art}
          size="100%"
          radius="8px"
          kind={player.current?.kind ?? "audio"}
        />
      </button>

      <div class="transport" class:transport-idle={idle}>
        <!-- Scrubber first, then the track centred beneath it. The heading used
             to sit above the bar with its actions pushed out to the right,
             which reads as a list row; centred under the artwork it reads as a
             caption for it. -->
        <div class="seekrow">
          <span class="time">{formatTime(pos)}</span>
          <div class="track" style="--pct:{progress}%">
            <input
              aria-label="Playback position"
              type="range"
              min="0"
              max={player.duration || 0}
              step="0.1"
              value={pos}
              oninput={onSeekInput}
              onchange={onSeekCommit}
              disabled={!player.loaded}
            />
          </div>
          <span class="time">-{formatTime(Math.max(0, player.duration - pos))}</span>
        </div>

        <!-- Permanent, where it used to appear only when the controls faded
             out. The title of what you're listening to isn't chrome. -->
        <div class="meta">
          <div class="track-title">{player.current?.title ?? "Not Playing"}</div>
          <div class="track-subtitle">
            {#if player.current?.artist}<ArtistLink artist={player.current.artist} />{/if}
          </div>
          <div class="meta-actions">
            <button class="circle-action" title="More options" aria-label="More options">
              <ImmersiveIcon name="more" size={16} />
            </button>
          </div>
        </div>

        {#if !idle}
          <div class="main-controls" transition:fade={{ duration: 180 }}>
            <button
              class="control secondary"
              class:on={player.shuffled}
              title="Shuffle"
              aria-label="Shuffle"
              aria-pressed={player.shuffled}
              onclick={() => player.toggleShuffle()}
            >
              <ImmersiveIcon name="shuffle" size={21} />
            </button>
            <button class="control" title="Previous" aria-label="Previous" onclick={() => player.prev()}>
              <ImmersiveIcon name="previous" size={25} />
            </button>
            <button
              class="control play"
              title={player.playing ? "Pause" : "Play"}
              aria-label={player.playing ? "Pause" : "Play"}
              onclick={() => player.togglePlay()}
            >
              <ImmersiveIcon name={player.playing ? "pause" : "play"} size={30} />
            </button>
            <button class="control" title="Next" aria-label="Next" onclick={() => player.next()}>
              <ImmersiveIcon name="next" size={25} />
            </button>
            <button
              class="control secondary repeat"
              class:on={player.repeat !== "off"}
              title="Repeat"
              aria-label="Repeat"
              onclick={() => player.cycleRepeat()}
            >
              <ImmersiveIcon name="repeat" size={21} />
              {#if player.repeat === "one"}<span class="repeat-one">1</span>{/if}
            </button>
            <button
              class="control secondary"
              class:on={player.autoplay}
              title={player.autoplay
                ? "Autoplay on — keeps playing similar tracks"
                : "Autoplay off — stops at the end of the queue"}
              aria-label="Autoplay"
              aria-pressed={player.autoplay}
              onclick={() => player.toggleAutoplay()}
            >
              <ImmersiveIcon name="infinity" size={21} />
            </button>
          </div>

          <div class="volume-row" transition:fade={{ duration: 180 }}>
            <ImmersiveIcon name="volume" size={17} />
            <div class="track volume" style="--pct:{volPct}%">
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.volume}
                oninput={(e) =>
                  player.setVolume(+(e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        {/if}
      </div>
    </section>

    {#if ui.panel === "lyrics"}
      <section class="content-panel lyrics-stage" aria-label="Lyrics" transition:fade={{ duration: 220 }}>
        <LyricsPanel />
      </section>
    {:else if ui.panel === "queue"}
      <section class="content-panel queue-stage" aria-label="Play queue" transition:fade={{ duration: 220 }}>
        <div class="queue-scroll">
          <h2>Now Playing</h2>
          {#if player.current}
            <button class="now-card" onclick={() => player.playIndex(player.currentIndex)}>
              <img src={player.current.art ?? ""} alt="" class:empty={!player.current.art} />
              <span>
                <strong>{player.current.title}</strong>
                <small>{player.current.artist} — {player.current.album}</small>
              </span>
            </button>
          {/if}

          <div class="queue-heading">
            <div>
              <h2>Playing Next</h2>
              <p>{player.current?.album ? `From ${player.current.album}` : "Up next"}</p>
            </div>
            <span>{Math.max(0, player.currentIndex + 1)} of {player.queue.length}</span>
          </div>

          <div class="queue-list">
            {#each upcoming as track, i (track.path + i)}
              <button
                class="queue-row"
                onclick={() => player.playIndex(player.currentIndex + i + 1)}
              >
                <span class="queue-number">{player.currentIndex + i + 2}</span>
                <img src={track.art ?? ""} alt="" class:empty={!track.art} />
                <span class="queue-meta">
                  <strong>{track.title}</strong>
                  <small>{track.artist} — {track.album}</small>
                </span>
              </button>
            {/each}
          </div>
        </div>
      </section>
    {/if}
  </main>

  {#if !idle && ui.panel !== "none"}
    <div class="panel-toggle" aria-label="Panel switcher" transition:fade={{ duration: 160 }}>
      <button
        class:selected={ui.panel === "queue"}
        title="Queue"
        aria-label="Queue"
        aria-pressed={ui.panel === "queue"}
        onclick={() => choosePanel("queue")}
      >
        <ImmersiveIcon name="queue" size={21} />
      </button>
      <button
        class:selected={ui.panel === "lyrics"}
        title="Lyrics"
        aria-label="Lyrics"
        aria-pressed={ui.panel === "lyrics"}
        onclick={() => choosePanel("lyrics")}
      >
        <ImmersiveIcon name="lyrics" size={21} />
      </button>
    </div>
  {/if}

  {#if ui.browserOpen}
    <div class="browser-overlay" transition:fade={{ duration: 200 }}>
      <div class="browser-panel">
        <button
          class="browser-close"
          title="Close browser"
          aria-label="Close browser"
          onclick={() => ui.toggleBrowser()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div class="browser-body">
          <Sidebar />
          <div class="browser-main">
            <MainView />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .immersive {
    --immersive-text: rgba(255, 255, 255, 0.96);
    --immersive-muted: rgba(255, 255, 255, 0.7);
    --immersive-faint: rgba(255, 255, 255, 0.3);
    --immersive-glass: rgba(38, 20, 31, 0.34);
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    z-index: 2147483647;
    overflow: hidden;
    overscroll-behavior: none;
    isolation: isolate;
    background: var(--bg-deep);
    color: var(--immersive-text);
  }
  .immersive.idle {
    cursor: none;
  }
  /* Mirrors the main window's stack so both surfaces composite identically. */
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
  /* Svelte scopes keyframes per component, so this is redeclared here rather
     than inherited from the copy in +page.svelte. */
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
  .scrim {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 50% 45%, transparent 0, rgba(18, 8, 14, 0.05) 54%, rgba(18, 8, 14, 0.16) 100%),
      linear-gradient(rgba(15, 8, 12, 0.04), rgba(15, 8, 12, 0.12));
    pointer-events: none;
  }

  .panel-toggle {
    display: flex;
    align-items: center;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: var(--immersive-glass);
    backdrop-filter: blur(28px) saturate(1.35);
    box-shadow: 0 12px 35px rgba(25, 8, 17, 0.2);
  }
  .panel-toggle button {
    width: 42px;
    height: 36px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.78);
    transition:
      background 180ms ease,
      color 180ms ease,
      transform 220ms var(--motion-spring);
  }
  .panel-toggle button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    transform: scale(1.06);
  }
  .panel-toggle button.selected {
    color: #fff;
    background: rgba(255, 255, 255, 0.16);
  }
  .window-chrome {
    position: absolute;
    top: 34px;
    left: 32px;
    z-index: 7;
  }
  .menu-wrap {
    position: absolute;
    top: 28px;
    /* Clear of the window controls to its left. */
    left: 108px;
    z-index: 6;
  }
  .menu-button {
    width: 42px;
    height: 36px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: var(--immersive-glass);
    backdrop-filter: blur(28px) saturate(1.35);
    box-shadow: 0 12px 35px rgba(25, 8, 17, 0.2);
    transition:
      background 180ms ease,
      color 180ms ease,
      transform 220ms var(--motion-spring);
  }
  .menu-button:hover,
  .menu-button.selected {
    color: #fff;
    background: rgba(255, 255, 255, 0.16);
  }
  .menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 5;
    background: transparent;
  }
  .menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 190px;
    padding: 6px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(28, 16, 24, 0.82);
    backdrop-filter: blur(28px) saturate(1.35);
    box-shadow: 0 16px 45px rgba(15, 5, 10, 0.35);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    transition: background 150ms ease, color 150ms ease;
  }
  .menu-item:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
  .menu-item.selected {
    color: #fff;
    background: rgba(255, 255, 255, 0.16);
  }
  .exit-button {
    position: absolute;
    top: 28px;
    right: 32px;
    z-index: 5;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: var(--immersive-glass);
    backdrop-filter: blur(28px);
    transition:
      background 180ms ease,
      transform 220ms var(--motion-spring);
  }
  .exit-button:hover {
    background: rgba(255, 255, 255, 0.16);
    transform: scale(1.06);
  }

  .stage {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    justify-items: center;
    padding: 6vh 6vw 4vh;
    transition: transform 360ms var(--motion-spring);
  }
  .has-panel .stage {
    grid-template-columns: minmax(360px, 44%) minmax(420px, 56%);
    gap: clamp(42px, 6vw, 112px);
    padding-left: 8vw;
    padding-right: 3vw;
  }
  .player-column {
    width: clamp(360px, 34vw, 560px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: clamp(20px, 3vh, 34px);
    transition:
      transform 360ms var(--motion-spring),
      width 360ms var(--motion-spring);
  }
  .has-panel .player-column {
    width: clamp(350px, 31vw, 500px);
  }
  .idle .player-column {
    transform: translateY(2.5vh);
  }
  .art-hero {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    transition: transform 220ms var(--motion-spring);
  }
  .art-hero:hover {
    transform: scale(1.008);
  }
  .art-hero:active {
    transform: scale(0.992);
  }
  .art-hero :global(.art) {
    width: 100% !important;
    height: 100% !important;
    box-shadow: 0 32px 85px rgba(28, 6, 18, 0.28);
  }

  .transport {
    display: flex;
    flex-direction: column;
    gap: 17px;
    width: 100%;
    color: #fff;
    text-shadow: 0 1px 16px rgba(16, 5, 12, 0.28);
    transition: gap 240ms ease;
  }
  .transport-idle {
    gap: 15px;
  }
  /* Centred under the artwork, in the order you'd read it: what's playing, who
     by, then what you can do with it. */
  .meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 3px;
    min-width: 0;
  }
  .track-title {
    max-width: 100%;
    font-size: 16px;
    font-weight: 750;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-subtitle {
    max-width: 100%;
    color: var(--immersive-muted);
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 9px;
  }
  .circle-action {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: background 160ms ease, transform 220ms var(--motion-spring);
  }
  .circle-action:hover {
    background: rgba(255, 255, 255, 0.24);
    transform: scale(1.06);
  }
  .seekrow {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 48px;
    align-items: center;
    gap: 10px;
  }
  .time {
    font-size: 12px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.88);
    text-align: center;
  }
  .track {
    --pct: 0%;
    position: relative;
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      rgba(255, 255, 255, 0.94) var(--pct),
      rgba(255, 255, 255, 0.2) var(--pct)
    );
  }
  .track input {
    -webkit-appearance: none;
    appearance: none;
    position: absolute;
    inset: -8px 0;
    width: 100%;
    height: 21px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  .track input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    opacity: 0;
    box-shadow: 0 2px 8px rgba(20, 4, 12, 0.28);
    transition: opacity 140ms ease;
  }
  .track:hover input::-webkit-slider-thumb,
  .track input:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }
  .main-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: clamp(6px, 1.2vw, 18px);
  }
  .control {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: #fff;
    display: grid;
    place-items: center;
    transition:
      background 160ms ease,
      transform 220ms var(--motion-spring);
  }
  .control:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: scale(1.08);
  }
  .control:active {
    transform: scale(0.9);
  }
  .control.play {
    width: 52px;
    height: 52px;
  }
  .control.secondary {
    color: rgba(255, 255, 255, 0.78);
  }
  .control.on {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
  }
  .repeat {
    position: relative;
  }
  .repeat-one {
    position: absolute;
    font-size: 8px;
    font-weight: 800;
  }
  .volume-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--immersive-muted);
  }
  .volume {
    width: min(82%, 470px);
    background: linear-gradient(
      to right,
      rgba(183, 157, 210, 0.9) var(--pct),
      rgba(78, 61, 102, 0.46) var(--pct)
    );
  }

  .content-panel {
    width: 100%;
    height: min(78vh, 780px);
    min-height: 0;
    align-self: center;
    color: #fff;
    text-shadow: 0 1px 22px rgba(25, 5, 16, 0.32);
  }
  .lyrics-stage {
    overflow: hidden;
    mask-image: linear-gradient(transparent 0%, #000 13%, #000 84%, transparent 100%);
  }
  .lyrics-stage :global(.lyrics) {
    padding: 18% 3% 20%;
    scrollbar-width: none;
  }
  .lyrics-stage :global(.lyrics::-webkit-scrollbar) {
    display: none;
  }
  .lyrics-stage :global(.synced) {
    gap: 22px;
  }
  .lyrics-stage :global(.line) {
    width: 100%;
    max-width: 820px;
    padding: 2px 8px;
    font-size: clamp(27px, 2.25vw, 43px);
    line-height: 1.3;
    color: #fff;
    /* Set the ramp's knobs, not `opacity` — writing opacity here would flatten
       the per-line dim/blur falloff back to one value. */
    --lyric-dim: 0.46;
    --lyric-past: 0;
    --lyric-past-hover: 0.2;
    --lyric-lit: 0.97;
    --lyric-blur-step: 0.62px;
    /* Only safe over the artwork field, where the backdrop is always dark. */
    --lyric-glow: 0 0 22px rgba(255, 255, 255, 0.45);
    text-align: left;
    transform-origin: left center;
  }
  .lyrics-stage :global(.line.active) {
    color: #fff;
    transform: none;
  }
  .lyrics-stage :global(.line:hover) {
    background: rgba(255, 255, 255, 0.08);
    opacity: 0.72;
  }

  .queue-stage {
    overflow: hidden;
  }
  .queue-scroll {
    height: 100%;
    overflow-y: auto;
    padding: 24px 16px 80px 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.32) transparent;
  }
  .queue-scroll h2 {
    font-size: 18px;
    font-weight: 760;
    margin: 0 0 10px 8px;
  }
  .now-card {
    width: 100%;
    min-height: 58px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px;
    text-align: left;
    color: #fff;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.09);
    transition:
      background 160ms ease,
      transform 220ms var(--motion-spring);
  }
  .now-card:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-1px);
  }
  .now-card img,
  .queue-row img {
    width: 42px;
    height: 42px;
    object-fit: cover;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
  }
  img.empty {
    visibility: hidden;
  }
  .now-card > span,
  .queue-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .now-card strong,
  .queue-row strong {
    font-size: 13px;
    font-weight: 720;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .now-card small,
  .queue-row small {
    color: var(--immersive-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .queue-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin: 28px 8px 7px;
  }
  .queue-heading h2 {
    margin: 0;
  }
  .queue-heading p,
  .queue-heading > span {
    color: var(--immersive-muted);
    font-size: 13px;
    margin: 4px 0 0;
  }
  .queue-list {
    display: flex;
    flex-direction: column;
  }
  .queue-row {
    min-height: 58px;
    width: 100%;
    display: grid;
    grid-template-columns: 34px 42px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 7px 8px;
    color: #fff;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    transition:
      background 160ms ease,
      transform 220ms var(--motion-spring);
  }
  .queue-row:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateX(3px);
  }
  .queue-number {
    color: var(--immersive-muted);
    text-align: right;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .panel-toggle {
    position: absolute;
    z-index: 5;
    left: 75%;
    bottom: 5vh;
    transform: translateX(-50%);
    border-radius: 11px;
  }
  .panel-toggle button {
    border-radius: 8px;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.96);
    outline-offset: 3px;
  }

  @media (max-width: 1040px) {
    .stage,
    .has-panel .stage {
      grid-template-columns: minmax(0, 42%) minmax(0, 58%);
      gap: 28px;
      padding: 7vh 24px 4vh;
    }
    .stage:not(:has(.content-panel)) {
      grid-template-columns: minmax(0, 1fr);
    }
    .player-column,
    .has-panel .player-column {
      width: min(100%, 430px);
    }
    .lyrics-stage :global(.line) {
      font-size: clamp(23px, 3vw, 33px);
    }
  }

  @media (max-width: 760px), (max-height: 620px) {
    .stage,
    .has-panel .stage {
      grid-template-columns: minmax(0, 1fr);
      padding: 74px 20px 24px;
      overflow-y: auto;
      align-content: start;
      gap: 28px;
    }
    .has-panel .player-column {
      width: min(46vh, 78vw);
    }
    .has-panel .art-hero {
      display: none;
    }
    .has-panel .transport {
      margin-top: 8px;
    }
    .content-panel {
      height: 62vh;
      min-height: 380px;
    }
    .panel-toggle {
      left: 50%;
      bottom: 16px;
    }
    .menu-wrap {
      top: 16px;
      left: 16px;
    }
    .exit-button {
      top: 16px;
      right: 16px;
    }
    .browser-panel {
      right: 3%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage,
    .player-column,
    .menu-button,
    .panel-toggle button,
    .exit-button,
    .control,
    .now-card,
    .queue-row,
    .art-hero {
      transition: none;
    }
    .idle .player-column {
      transform: none;
    }
  }

  .browser-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
  }
  .browser-panel {
    position: absolute;
    inset: 4vh 8% 4vh 4vw;
    display: flex;
    border-radius: 16px;
    overflow: hidden;
    background: var(--bg-deep);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 30px 90px rgba(5, 2, 6, 0.5);
  }
  .browser-close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 2;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: background 150ms ease, color 150ms ease;
  }
  .browser-close:hover {
    color: var(--text);
    background: var(--hover);
  }
  .browser-body {
    display: flex;
    width: 100%;
    height: 100%;
  }
  .browser-main {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(22px) saturate(1.08);
  }
</style>
