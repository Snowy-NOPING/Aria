<script lang="ts">
  import { player } from "$lib/player.svelte";
  import { ui } from "$lib/ui.svelte";
  import LyricsPanel from "$lib/LyricsPanel.svelte";
  import ImmersiveIcon from "$lib/icons/ImmersiveIcon.svelte";

  const upcoming = $derived(
    player.queue.slice(Math.max(0, player.currentIndex + 1)),
  );
</script>

<aside class="panel" aria-label={ui.sidePanel === "lyrics" ? "Lyrics" : "Play queue"}>
  <header>
    <div class="tabs">
      <button
        class:active={ui.sidePanel === "lyrics"}
        aria-pressed={ui.sidePanel === "lyrics"}
        onclick={() => (ui.sidePanel = "lyrics")}
      >
        <ImmersiveIcon name="lyrics" size={17} />
        <span>Lyrics</span>
      </button>
      <button
        class:active={ui.sidePanel === "queue"}
        aria-pressed={ui.sidePanel === "queue"}
        onclick={() => (ui.sidePanel = "queue")}
      >
        <ImmersiveIcon name="queue" size={17} />
        <span>Queue</span>
      </button>
    </div>
    <button class="close" title="Close panel" aria-label="Close panel" onclick={() => (ui.sidePanel = "none")}>
      ×
    </button>
  </header>

  {#if ui.sidePanel === "lyrics"}
    <div class="lyrics-wrap"><LyricsPanel /></div>
  {:else}
    <div class="queue">
      <div class="queue-title">
        <strong>Playing Next</strong>
        <span>{upcoming.length} songs</span>
      </div>
      {#each upcoming as track, index (track.path + index)}
        <button
          class="queue-row"
          onclick={() => player.playIndex(player.currentIndex + index + 1)}
        >
          <span class="number">{player.currentIndex + index + 2}</span>
          <img src={track.art ?? ""} alt="" class:empty={!track.art} />
          <span class="meta">
            <strong>{track.title}</strong>
            <small>{track.artist}</small>
          </span>
        </button>
      {/each}
      {#if upcoming.length === 0}
        <div class="empty">Nothing is queued next.</div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .panel {
    width: clamp(320px, 29vw, 510px);
    flex: none;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--chrome-tint);
    backdrop-filter: var(--chrome-blur);
    border-left: 1px solid var(--border);
  }
  header {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px 5px 14px;
    border-bottom: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    min-height: 34px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 11px;
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 650;
  }
  .tabs button:hover {
    background: var(--hover);
    color: var(--text);
  }
  .tabs button.active {
    background: var(--active);
    color: var(--accent);
  }
  .close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--text-dim);
    font-size: 19px;
  }
  .close:hover {
    color: var(--text);
    background: var(--hover);
  }
  .lyrics-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .lyrics-wrap :global(.lyrics) {
    padding: 18% 7%;
  }
  .lyrics-wrap :global(.line) {
    font-size: clamp(21px, 1.65vw, 30px);
    color: var(--text);
    /* Knobs, not `opacity` — see LyricsPanel. Narrow panel, so a gentler blur
       step: fewer lines are visible and heavy softening just reads as blurry. */
    --lyric-dim: 0.34;
    --lyric-past: 0.22;
    --lyric-lit: 0.95;
    --lyric-blur-step: 0.4px;
  }
  .lyrics-wrap :global(.line.active) {
    color: var(--text);
  }
  .queue {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 12px 30px;
  }
  .queue-title {
    display: flex;
    justify-content: space-between;
    margin: 0 5px 10px;
  }
  .queue-title span {
    color: var(--text-faint);
    font-size: 12px;
  }
  .queue-row {
    width: 100%;
    display: grid;
    grid-template-columns: 28px 38px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 6px;
    border-radius: 8px;
    text-align: left;
  }
  .queue-row:hover {
    background: var(--hover);
  }
  .number {
    text-align: right;
    color: var(--text-faint);
    font-size: 11px;
  }
  .queue-row img {
    width: 38px;
    height: 38px;
    object-fit: cover;
    border-radius: 5px;
    background: var(--surface);
  }
  img.empty {
    visibility: hidden;
  }
  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .meta strong,
  .meta small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta strong {
    font-size: 12px;
  }
  .meta small {
    color: var(--text-dim);
    font-size: 11px;
    margin-top: 2px;
  }
  .empty {
    padding: 40px 12px;
    text-align: center;
    color: var(--text-faint);
    font-size: 12px;
  }
  @media (max-width: 1060px) {
    .panel {
      position: absolute;
      z-index: 10;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(420px, 52vw);
      box-shadow: -18px 0 55px rgba(0, 0, 0, 0.25);
    }
  }
  /* Too narrow to share: the panel takes the whole content area instead of
     squeezing the library into a leftover sliver. */
  @media (max-width: 780px) {
    .panel {
      left: 0;
      width: auto;
    }
  }
</style>
