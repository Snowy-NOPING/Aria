<script lang="ts">
  let {
    name,
    size = 18,
  }: {
    name:
      | "home"
      | "recent"
      | "songs"
      | "albums"
      | "videos"
      | "queue"
      | "playlists"
      | "settings"
      | "search"
      | "pin"
      | "add";
    size?: number;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "home"}
    <path d="m3.5 11 8.5-7 8.5 7v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-8Z" />
    <path d="M9 20.5v-7h6v7" />
  {:else if name === "recent"}
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.5 2" />
  {:else if name === "songs"}
    <path d="M9 18V6l10-2v12" />
    <ellipse cx="6.5" cy="18" rx="2.5" ry="2" />
    <ellipse cx="16.5" cy="16" rx="2.5" ry="2" />
  {:else if name === "albums"}
    <path d="M5 6.5h14M4 9h16l-1.4 10.5H5.4L4 9Z" />
    <path d="M8 4h8" />
  {:else if name === "videos"}
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
  {:else if name === "queue"}
    <path d="M4 6h11M4 12h8M4 18h8" />
    <path d="M17 11v7a2.5 2.5 0 1 1-2-2.4M17 11l3-1" />
  {:else if name === "playlists"}
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  {:else if name === "settings"}
    <circle cx="12" cy="12" r="3" />
    <path d="M19.2 13.8a7.8 7.8 0 0 0 0-3.6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-3.1-1.8L13.4 2H9.5l-.3 2.5a8 8 0 0 0-3.1 1.8l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3.6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 3.1 1.8l.3 2.5h3.9l.3-2.5a8 8 0 0 0 3.1-1.8l2.4 1 2-3.4-2-1.5Z" />
  {:else if name === "search"}
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4.5 4.5" />
  {:else if name === "pin"}
    <!-- Thumbtack seen side-on, symmetric about x=12: cap, neck, flange, needle.
         Drawn upright rather than tilted so the needle never crosses the body —
         at 16px an overlapping outline just reads as a blob. -->
    <path d="M9 3.5h6" />
    <path d="M10.5 3.5v5.8L7.5 13h9l-3-3.7V3.5" />
    <path d="M12 13v7.5" />
  {:else if name === "add"}
    <path d="M12 5v14M5 12h14" />
  {/if}
</svg>
