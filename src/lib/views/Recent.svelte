<script lang="ts">
  import { library } from "$lib/library.svelte";
  import { player } from "$lib/player.svelte";
  import TrackList from "$lib/TrackList.svelte";

  function play(index: number) {
    player.setQueue(library.recentSongs, index);
  }
</script>

<div class="view">
  <div class="header">
    <div>
      <div class="view-title">Recently Added</div>
      <p>Your newest music, ready to play.</p>
    </div>
    {#if library.recentSongs.length}
      <button class="pill-btn filled" onclick={() => play(0)}>▶ Play All</button>
    {/if}
  </div>

  {#if library.recentSongs.length}
    <TrackList tracks={library.recentSongs} onplay={play} showArt={true} />
  {:else}
    <div class="empty">Your recently added songs will appear here.</div>
  {/if}
</div>

<style>
  .header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 18px;
  }
  .view-title {
    margin-bottom: 4px;
  }
  p {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }
  .empty {
    padding-top: 70px;
    color: var(--text-faint);
    text-align: center;
  }
</style>
