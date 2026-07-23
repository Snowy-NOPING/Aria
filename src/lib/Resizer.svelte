<script lang="ts">
  let { onmove }: { onmove: (x: number, y: number) => void } = $props();

  let active = $state(false);

  function down(e: PointerEvent) {
    e.preventDefault();
    active = true;
    const move = (ev: PointerEvent) => onmove(ev.clientX, ev.clientY);
    const up = () => {
      active = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

<div
  class="resizer"
  class:active
  role="separator"
  aria-orientation="vertical"
  tabindex="-1"
  onpointerdown={down}
></div>

<style>
  .resizer {
    width: 6px;
    flex-shrink: 0;
    cursor: col-resize;
    position: relative;
    z-index: 6;
  }
  .resizer::after {
    content: "";
    position: absolute;
    inset: 0 2px;
    border-radius: 2px;
    background: transparent;
    transition: background 0.15s;
  }
  .resizer:hover::after,
  .resizer.active::after {
    background: var(--accent);
  }
</style>
