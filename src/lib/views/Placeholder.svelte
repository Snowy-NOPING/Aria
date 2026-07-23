<script lang="ts">
  let {
    title,
    icon,
    milestone,
    children,
  }: {
    title: string;
    icon: string;
    milestone: string;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<div class="view">
  <header><h1>{title}</h1></header>
  <div class="empty">
    <div class="icon">{icon}</div>
    {#if children}
      {@render children()}
    {:else}
      <p>Coming in <strong>{milestone}</strong>.</p>
    {/if}
    <span class="tag">{milestone}</span>
  </div>
</div>

<style>
  .view {
    padding: 24px 28px;
    height: 100%;
  }
  h1 {
    margin: 0 0 20px;
    font-size: 26px;
    font-weight: 700;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 60%;
    color: var(--text-dim);
    gap: 10px;
  }
  .icon {
    font-size: 48px;
    opacity: 0.35;
  }
  .tag {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 20px;
    padding: 2px 12px;
    opacity: 0.8;
  }
</style>
