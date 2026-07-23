<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { nav } from "./nav.svelte";

  let isHovered = $state(false);
  const appWindow = getCurrentWindow();

  function minimize() {
    void appWindow.minimize();
  }

  function toggleMaximize() {
    void appWindow.toggleMaximize();
  }

  function close() {
    void appWindow.close();
  }
</script>

<div class="titlebar" data-tauri-drag-region>
  <div 
    class="window-controls" 
    role="group"
    aria-label="Window controls"
    onmouseenter={() => isHovered = true}
    onmouseleave={() => isHovered = false}
  >
    <button class="window-btn close" onclick={close} aria-label="Close">
      {#if isHovered}
        <span class="symbol">x</span>
      {/if}
    </button>
    <button class="window-btn minimize" onclick={minimize} aria-label="Minimize">
      {#if isHovered}
        <span class="symbol">-</span>
      {/if}
    </button>
    <button class="window-btn maximize" onclick={toggleMaximize} aria-label="Maximize">
      {#if isHovered}
        <span class="symbol">+</span>
      {/if}
    </button>
  </div>

  <div class="nav-controls" data-tauri-drag-region>
    <button class="nav-btn" onclick={() => nav.goBack()} disabled={!nav.canGoBack} aria-label="Go back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
    </button>
    <button class="nav-btn" onclick={() => nav.goForward()} disabled={!nav.canGoForward} aria-label="Go forward">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
    </button>
  </div>

  <div class="app-title" data-tauri-drag-region>
    Aria
  </div>

  <div class="right-spacer" data-tauri-drag-region></div>
</div>

<style>
  .titlebar {
    height: 38px;
    background: color-mix(in srgb, var(--sidebar) 68%, transparent);
    backdrop-filter: blur(34px) saturate(1.45);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 16px;
    user-select: none;
    z-index: 999;
    flex-shrink: 0;
  }
  .window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 60px;
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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 8px;
    font-weight: 700;
    color: rgba(0, 0, 0, 0.65);
    line-height: 1;
    position: absolute;
  }
  .window-btn.close .symbol {
    font-size: 8px;
    transform: translateY(-0.5px);
  }
  .window-btn.minimize .symbol {
    font-size: 10px;
    transform: translateY(-1.5px);
  }
  .window-btn.maximize .symbol {
    font-size: 8px;
    transform: translateY(-0.5px);
  }
  .nav-controls {
    display: flex;
    gap: 6px;
    margin-left: 10px;
  }
  .nav-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--text-dim);
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
    transform: scale(1.03);
  }
  .nav-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .nav-btn:disabled {
    color: var(--text-faint);
    cursor: default;
    opacity: 0.45;
  }
  .app-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-dim);
    letter-spacing: 0.2px;
    flex: 1;
    text-align: center;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 96px; /* Offset to center title perfectly */
  }
  .right-spacer {
    width: 0;
  }
</style>
