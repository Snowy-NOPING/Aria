<script lang="ts">
  import { contextMenu, type MenuItem } from "./contextMenuState.svelte";
  import { onMount } from "svelte";

  let activeSubmenuIndex = $state<number | null>(null);
  let menuEl = $state<HTMLElement | null>(null);

  let adjustedX = $state(0);
  let adjustedY = $state(0);

  $effect(() => {
    if (contextMenu.visible && menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const winWidth = window.innerWidth;
      const winHeight = window.innerHeight;
      
      adjustedX = contextMenu.x;
      adjustedY = contextMenu.y;

      if (contextMenu.x + rect.width > winWidth) {
        adjustedX = winWidth - rect.width - 8;
      }
      if (contextMenu.y + rect.height > winHeight) {
        adjustedY = winHeight - rect.height - 8;
      }
    }
  });

  onMount(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (contextMenu.visible && menuEl && !menuEl.contains(e.target as Node)) {
        contextMenu.close();
      }
    }
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  });
</script>

{#if contextMenu.visible}
  <div 
    class="context-menu" 
    bind:this={menuEl} 
    style="left: {adjustedX}px; top: {adjustedY}px"
    role="menu"
    tabindex="-1"
  >
    {#each contextMenu.items as item, index}
      {#if item.label === "SEPARATOR"}
        <div class="separator"></div>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div 
          class="menu-item-container"
          onmouseenter={() => { if (item.submenu) activeSubmenuIndex = index; else activeSubmenuIndex = null; }}
        >
          <button 
            class="menu-item" 
            class:disabled={item.disabled}
            class:danger={item.isDanger}
            onclick={(e) => { 
              if (item.submenu) return;
              e.stopPropagation(); 
              item.action?.(); 
              contextMenu.close(); 
            }}
            disabled={item.disabled}
          >
            <span class="icon">
              {#if item.icon}
                {@render icon(item.icon)}
              {/if}
            </span>
            <span class="label">{item.label}</span>
            {#if item.submenu}
              <span class="arrow">›</span>
            {/if}
          </button>

          {#if item.submenu && activeSubmenuIndex === index}
            <div class="submenu">
              {#each item.submenu as subitem}
                {#if subitem.label === "SEPARATOR"}
                  <div class="separator"></div>
                {:else}
                  <button 
                    class="menu-item" 
                    class:disabled={subitem.disabled}
                    class:danger={subitem.isDanger}
                    onclick={(e) => { 
                      e.stopPropagation(); 
                      subitem.action?.(); 
                      contextMenu.close(); 
                    }}
                    disabled={subitem.disabled}
                  >
                    <span class="icon">
                      {#if subitem.icon}
                        {@render icon(subitem.icon)}
                      {/if}
                    </span>
                    <span class="label">{subitem.label}</span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#snippet icon(name: string)}
  {#if name === "pin"}
    <!-- Same thumbtack as SidebarIcon's "pin"; kept in sync by hand since this
         menu draws its icons inline. -->
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6"/><path d="M10.5 3.5v5.8L7.5 13h9l-3-3.7V3.5"/><path d="M12 13v7.5"/></svg>
  {:else if name === "playlist-add" || name === "playlist"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h8M4 18h8M17 11v7a2.5 2.5 0 1 1-2-2.4M17 11l3-1"/></svg>
  {:else if name === "play-next"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h10M17 14l3 3-3 3M20 17H14"/></svg>
  {:else if name === "play-later"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h11M4 18h7M17 15v6M14 18h6"/></svg>
  {:else if name === "radio"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>
  {:else if name === "favorite" || name === "star"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  {:else if name === "suggest-less" || name === "thumbs-down"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
  {:else if name === "properties" || name === "info"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  {:else if name === "artist" || name === "user"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  {:else if name === "album"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M12 2a10 10 0 0 1 8 4"/></svg>
  {:else if name === "song" || name === "music"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="18.5" cy="16" r="2.5"/></svg>
  {:else if name === "share"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
  {:else if name === "plugin"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/></svg>
  {:else if name === "remove" || name === "trash"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="2" rx="1"/><path d="M19 4v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V4M10 11v5M14 11v5M9 2h6"/></svg>
  {:else if name === "immersive" || name === "fullscreen"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
  {:else if name === "miniplayer"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="9" y="9" width="12" height="12" rx="1"/></svg>
  {:else if name === "developer" || name === "code"}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
  {/if}
{/snippet}

<style>
  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--menu-bg);
    backdrop-filter: var(--menu-blur);
    border: 1px solid var(--menu-border);
    border-radius: 9px;
    box-shadow: var(--menu-shadow);
    padding: 5px;
    min-width: 230px;
    display: flex;
    flex-direction: column;
    color: var(--menu-text);
    animation: menu-pop 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes menu-pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .menu-item-container {
    position: relative;
    width: 100%;
  }

  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: transparent;
    padding: 7px 10px;
    border-radius: 5px;
    color: var(--menu-text);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    user-select: none;
  }

  .menu-item:hover {
    background: var(--accent, #b68d5d);
    color: var(--menu-accent-text);
  }

  .menu-item.disabled {
    opacity: 0.35;
    cursor: default;
  }

  .menu-item.disabled:hover {
    background: transparent;
    color: var(--menu-text);
  }

  .menu-item.danger:hover {
    background: var(--menu-danger);
  }

  .icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 10px;
    opacity: 0.9;
  }

  .label {
    flex: 1;
  }

  .arrow {
    font-size: 14px;
    font-weight: 400;
    margin-left: 8px;
    opacity: 0.7;
  }

  .separator {
    height: 1px;
    background: var(--menu-sep);
    margin: 4px 5px;
  }

  .submenu {
    position: absolute;
    left: 98%;
    top: -5px;
    background: var(--menu-bg);
    backdrop-filter: var(--menu-blur);
    border: 1px solid var(--menu-border);
    border-radius: 9px;
    box-shadow: var(--menu-shadow);
    padding: 5px;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    color: var(--menu-text);
    z-index: 10001;
    animation: menu-pop 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
</style>
