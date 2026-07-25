<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let {
    /** Immersive mode is fullscreen, where "maximize" should restore down. */
    fullscreenAware = false,
  }: { fullscreenAware?: boolean } = $props();

  let isHovered = $state(false);
  let maximized = $state(false);
  const appWindow = getCurrentWindow();

  function minimize() {
    void appWindow.minimize();
  }

  async function toggleMaximize() {
    if (fullscreenAware && (await appWindow.isFullscreen())) {
      // Leaving fullscreen is the meaningful "restore down" here.
      await appWindow.setFullscreen(false);
      return;
    }
    await appWindow.toggleMaximize();
  }

  function close() {
    void appWindow.close();
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then((m) => (maximized = m));
    appWindow
      .onResized(() => {
        void appWindow.isMaximized().then((m) => (maximized = m));
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  });
</script>

<div
  class="window-controls"
  role="group"
  aria-label="Window controls"
  onmouseenter={() => (isHovered = true)}
  onmouseleave={() => (isHovered = false)}
>
  <button class="window-btn close" onclick={close} aria-label="Close">
    {#if isHovered}
      <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
    {/if}
  </button>
  <button class="window-btn minimize" onclick={minimize} aria-label="Minimize">
    {#if isHovered}
      <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14" /></svg>
    {/if}
  </button>
  <button
    class="window-btn maximize"
    onclick={toggleMaximize}
    aria-label={maximized ? "Restore" : "Maximize"}
  >
    {#if isHovered}
      {#if maximized}
        <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="4.5" y="8.5" width="10" height="10" rx="1.5" /><rect x="8.5" y="4.5" width="10" height="10" rx="1.5" /></svg>
      {:else}
        <svg class="symbol" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
      {/if}
    {/if}
  </button>
</div>

<style>
  .window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .window-btn {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    position: relative;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.65);
    transition: filter 0.1s ease;
  }
  .window-btn:hover {
    filter: brightness(0.85);
  }
  .window-btn.close {
    background-color: #ff5f56;
    border: 0.5px solid #e0443e;
  }
  .window-btn.minimize {
    background-color: #ffbd2e;
    border: 0.5px solid #dfa123;
  }
  .window-btn.maximize {
    background-color: #27c93f;
    border: 0.5px solid #1aab29;
  }
  .symbol {
    position: absolute;
  }
</style>
