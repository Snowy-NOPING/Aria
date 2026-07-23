<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { library } from "$lib/library.svelte";
  import { player, type TrackMeta } from "$lib/player.svelte";
  import { nav } from "$lib/nav.svelte";
  import AlbumCard from "$lib/AlbumCard.svelte";

  let selected = $state<TrackMeta | null>(null);
  const src = $derived(selected ? convertFileSrc(selected.path) : "");

  const filtered = $derived.by(() => {
    const q = nav.query.trim().toLowerCase();
    if (!q) return library.videos;
    return library.videos.filter((v) => v.title.toLowerCase().includes(q));
  });

  async function playVideo(v: TrackMeta) {
    await player.pausePlayback(); // don't let music and video overlap
    selected = v;
  }
</script>

<div class="view">
  <div class="view-title">Videos</div>

  {#if selected}
    <div class="player">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video {src} controls autoplay></video>
      <div class="pbar">
        <div class="pinfo">{selected.title}</div>
        <button class="pill-btn" onclick={() => (selected = null)}>Close</button>
      </div>
    </div>
  {/if}

  {#if library.videos.length === 0}
    <div class="note">
      No videos found. Add a video folder in <strong>Settings</strong>
      (your <code>Videos</code> folder is watched by default).
    </div>
  {:else}
    <div class="grid">
      {#each filtered as v (v.path)}
        <AlbumCard
          art={v.art}
          title={v.title}
          kind="video"
          onclick={() => playVideo(v)}
          onplay={() => playVideo(v)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .player {
    margin-bottom: 26px;
  }
  video {
    width: 100%;
    max-height: 56vh;
    background: #000;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    display: block;
  }
  .pbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
  }
  .pinfo {
    font-weight: 600;
  }
  .note {
    color: var(--text-dim);
    margin-top: 60px;
    text-align: center;
  }
  code {
    background: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
  }
</style>
