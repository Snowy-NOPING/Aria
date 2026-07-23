<script lang="ts">
  let {
    name,
    size = 20,
  }: {
    name:
      | "exit"
      | "queue"
      | "lyrics"
      | "shuffle"
      | "previous"
      | "play"
      | "pause"
      | "next"
      | "repeat"
      | "volume"
      | "more";
    size?: number;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "exit"}
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    <path d="m4 9 6-6M20 9l-6-6M4 15l6 6M20 15l-6 6" />
  {:else if name === "queue"}
    <path d="M4 6h11M4 12h8M4 18h8" />
    <path d="M17 11v7.5a2.5 2.5 0 1 1-2-2.45" />
    <path d="M17 11l3-1" />
  {:else if name === "lyrics"}
    <path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
    <path d="M8 10h8M8 13h5" />
  {:else if name === "shuffle"}
    <path d="M4 7h2.5c4 0 6.5 10 11 10H20" />
    <path d="m17 14 3 3-3 3M4 17h2.5c1.6 0 3-1.6 4.2-3.5M14 7.6c1.1-.5 2.2-.6 3.3-.6H20" />
    <path d="m17 4 3 3-3 3" />
  {:else if name === "previous"}
    <path d="M6 5v14M19 6 9 12l10 6Z" fill="currentColor" stroke="none" />
  {:else if name === "play"}
    <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
  {:else if name === "pause"}
    <path d="M8 5h3v14H8zM14 5h3v14h-3z" fill="currentColor" stroke="none" />
  {:else if name === "next"}
    <path d="M18 5v14M5 6l10 6-10 6Z" fill="currentColor" stroke="none" />
  {:else if name === "repeat"}
    <path d="M17 4l3 3-3 3" />
    <path d="M4 11V9a2 2 0 0 1 2-2h14M7 20l-3-3 3-3" />
    <path d="M20 13v2a2 2 0 0 1-2 2H4" />
  {:else if name === "volume"}
    <path d="M5 9v6h4l5 4V5L9 9H5Z" />
    <path d="M17 9.5a4 4 0 0 1 0 5M19 7a7 7 0 0 1 0 10" />
  {:else if name === "more"}
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  {/if}
</svg>
