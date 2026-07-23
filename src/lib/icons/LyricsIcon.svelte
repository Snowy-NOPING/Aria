<script lang="ts">
  let { size = 20 }: { size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
>
  <!-- speech bubble -->
  <path
    d="M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7.5L6 21v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
    fill="currentColor"
    opacity="0.16"
  />
  <path
    d="M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7.5L6 21v-4H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linejoin="round"
  />
  <!-- two closing quotation marks -->
  <path
    d="M10.1 8c-1.8.2-3.1 1.6-3.1 3.4 0 1.2.8 2.1 2 2.1.95 0 1.7-.65 1.7-1.6 0-.85-.62-1.45-1.45-1.45-.13 0-.3.02-.42.06.24-.66.9-1.06 1.72-1.16L10.1 8z"
    fill="currentColor"
  />
  <path
    d="M15.4 8c-1.8.2-3.1 1.6-3.1 3.4 0 1.2.8 2.1 2 2.1.95 0 1.7-.65 1.7-1.6 0-.85-.62-1.45-1.45-1.45-.13 0-.3.02-.42.06.24-.66.9-1.06 1.72-1.16L15.4 8z"
    fill="currentColor"
  />
</svg>
