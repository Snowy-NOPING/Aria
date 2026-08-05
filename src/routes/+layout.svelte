<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { player } from "$lib/player.svelte";
  import { library } from "$lib/library.svelte";
  import { layout } from "$lib/layout.svelte";
  import { lastfm } from "$lib/lastfm.svelte";
  import { discord } from "$lib/discord.svelte";
  import { theme } from "$lib/theme.svelte";
  import { lyricsStyle } from "$lib/lyricsStyle.svelte";

  let { children } = $props();

  function onRefreshShortcut(event: KeyboardEvent) {
    const refresh =
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
    if (!refresh) return;
    event.preventDefault();
    void library.rescan();
  }

  onMount(() => {
    theme.load();
    lyricsStyle.load();
    layout.load();
    player.init();
    library.load();
    lastfm.load();
    discord.load();
  });
</script>

<svelte:window onkeydown={onRefreshShortcut} />

{@render children()}
