<script lang="ts">
  import MusicNote from "$lib/icons/MusicNote.svelte";
  let {
    src = null,
    size = "100%",
    radius = "8px",
    kind = "audio",
  }: {
    src?: string | null;
    size?: string;
    radius?: string;
    kind?: "audio" | "video";
  } = $props();
</script>

<div class="art" style="width:{size};height:{size};border-radius:{radius};">
  {#if src}
    <img {src} alt="" />
  {:else}
    <div class="placeholder">
      {#if kind === "video"}▶{:else}<MusicNote size={28} />{/if}
    </div>
  {/if}
</div>

<style>
  .art {
    overflow: hidden;
    flex-shrink: 0;
    background: var(--surface);
    box-shadow: var(--art-shadow);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    font-size: 22px;
    background: linear-gradient(135deg, var(--surface), var(--active));
  }
</style>
