<script lang="ts">
  import { nav } from "$lib/nav.svelte";
  import { library } from "$lib/library.svelte";

  let { artist }: { artist: string } = $props();

  const parts = $derived(library.artistCredits(artist));

  function open(e: MouseEvent, name: string) {
    // Track rows are clickable too, and a click on the artist means the artist.
    e.stopPropagation();
    nav.go("artist", name);
  }
</script>

{#each parts as part (part.name + part.sep)}<button
    class="link"
    title="Go to {part.name}"
    onclick={(e) => open(e, part.name)}>{part.name}</button
  >{#if part.sep}<span class="sep">{part.sep}</span>{/if}{/each}

<style>
  /* Inherits type and colour so it reads as the text it replaced, and only
     looks like a control once the pointer is on it. */
  .link {
    /* `display: inline` keeps the name part of the sentence around it: the
       cells it sits in clip with an ellipsis, which an inline-block button
       would defeat by refusing to break. */
    display: inline;
    font: inherit;
    color: inherit;
    padding: 0;
    text-align: left;
    border-radius: 3px;
  }
  .link:hover {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .sep {
    white-space: pre;
  }
</style>
