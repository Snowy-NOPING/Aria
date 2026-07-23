<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { player } from "$lib/player.svelte";
  import { library } from "$lib/library.svelte";
  import { layout } from "$lib/layout.svelte";
  import { lastfm } from "$lib/lastfm.svelte";

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
    layout.load();
    player.init();
    library.load();
    lastfm.load();
  });
</script>

<svelte:window onkeydown={onRefreshShortcut} />

{@render children()}
