<script lang="ts">
  import Artwork from "./Artwork.svelte";
  import SidebarIcon from "$lib/icons/SidebarIcon.svelte";

  let {
    art = null,
    title,
    subtitle = "",
    round = false,
    kind = "audio",
    onclick,
    onplay,
    onpin,
    pinned = false,
  }: {
    art?: string | null;
    title: string;
    subtitle?: string;
    round?: boolean;
    kind?: "audio" | "video";
    onclick?: () => void;
    onplay?: () => void;
    onpin?: () => void;
    pinned?: boolean;
  } = $props();
</script>

<div
  class="card"
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => e.key === "Enter" && onclick?.()}
>
  <div class="art-wrap">
    <Artwork src={art} {kind} radius={round ? "50%" : "10px"} />
    {#if onplay}
      <button
        class="play"
        aria-label="Play"
        onclick={(e) => {
          e.stopPropagation();
          onplay();
        }}
      >
        ▶
      </button>
    {/if}
    {#if onpin}
      <button
        class="pin"
        class:pinned
        aria-label={pinned ? "Unpin" : "Pin"}
        title={pinned ? "Unpin" : "Pin"}
        onclick={(e) => {
          e.stopPropagation();
          onpin();
        }}
      >
        <SidebarIcon name="pin" size={16} />
      </button>
    {/if}
  </div>
  <div class="title" class:center={round}>{title}</div>
  {#if subtitle}
    <div class="subtitle" class:center={round}>{subtitle}</div>
  {/if}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: pointer;
    outline: none;
  }
  .art-wrap {
    position: relative;
    margin-bottom: 8px;
    transition:
      transform 360ms var(--motion-spring),
      filter 240ms ease;
  }
  .card:hover .art-wrap {
    transform: translateY(-4px) scale(1.018);
  }
  .card:active .art-wrap {
    transform: translateY(0) scale(0.975);
  }
  .play {
    position: absolute;
    right: 10px;
    bottom: 10px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 15px;
    display: grid;
    place-items: center;
    box-shadow: var(--shadow);
    opacity: 0;
    transform: translateY(8px) scale(0.78);
    transition:
      opacity 0.18s,
      transform 320ms var(--motion-spring-strong);
  }
  .pin {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(20, 15, 19, 0.64);
    backdrop-filter: blur(14px);
    opacity: 0;
    transform: translateY(-5px) scale(0.86);
    transition:
      opacity 180ms ease,
      transform 240ms var(--motion-spring),
      background 160ms ease;
  }
  .pin.pinned {
    opacity: 1;
    color: var(--accent-2);
  }
  .card:hover .pin,
  .pin:focus-visible {
    opacity: 1;
    transform: none;
  }
  .pin:hover {
    background: rgba(20, 15, 19, 0.82);
  }
  .card:hover .play,
  .card:focus-visible .play {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  .play:hover {
    background: var(--accent-2);
    transform: translateY(0) scale(1.09);
  }
  .play:active {
    transform: translateY(0) scale(0.9);
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle {
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .center {
    text-align: center;
  }
  .card:focus-visible .title {
    color: var(--accent);
  }
  @media (prefers-reduced-motion: reduce) {
    .card:hover .art-wrap,
    .card:active .art-wrap,
    .card:hover .play,
    .card:focus-visible .play,
    .play:hover,
    .play:active {
      transform: none;
    }
  }
</style>
