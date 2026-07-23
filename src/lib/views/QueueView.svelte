<script lang="ts">
  import { player } from "$lib/player.svelte";
  import TrackList from "$lib/TrackList.svelte";

  function play(i: number) {
    player.playIndex(i);
  }
</script>

<div class="view">
  <div class="view-title">Play Queue</div>
  {#if player.queue.length === 0}
    <div class="note">Queue is empty. Play something from your library.</div>
  {:else}
    <TrackList
      tracks={player.queue}
      onplay={play}
      showArt={true}
      onreorder={(f, t) => player.reorderQueue(f, t)}
    />
  {/if}
</div>

<style>
  .note {
    color: var(--text-dim);
    margin-top: 60px;
    text-align: center;
  }
</style>
