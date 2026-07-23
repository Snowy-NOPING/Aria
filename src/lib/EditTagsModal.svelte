<script lang="ts">
  import { edit } from "$lib/edit.svelte";
  import { library } from "$lib/library.svelte";
  import Artwork from "$lib/Artwork.svelte";

  let title = $state("");
  let artist = $state("");
  let album = $state("");
  let artPreview = $state<string | null>(null);
  let artChanged = $state(false);
  let artValue = $state<string | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const t = edit.target;
    if (t) {
      title = t.title;
      artist = t.artist;
      album = t.album;
      artPreview = t.art;
      artChanged = false;
      artValue = null;
      error = null;
    }
  });

  async function changeImage() {
    const img = await library.pickImage();
    if (img) {
      artPreview = img;
      artValue = img;
      artChanged = true;
    }
  }
  function resetImage() {
    artPreview = null;
    artValue = null;
    artChanged = true;
  }
  async function setArtistImage() {
    const img = await library.pickImage();
    if (img && artist.trim()) await library.setArtistImage(artist.trim(), img);
  }

  async function save() {
    const t = edit.target;
    if (!t) return;
    saving = true;
    error = null;
    try {
      await library.setOverride(t.path, {
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim(),
        ...(artChanged ? { art: artValue } : {}),
      });
      edit.close();
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  async function revertAll() {
    const t = edit.target;
    if (t) await library.clearOverride(t.path);
    edit.close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") edit.close();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
  }
</script>

{#if edit.target}
  <div class="backdrop" role="button" tabindex="-1" onclick={() => edit.close()} onkeydown={onKey}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Edit track info">
    <h2>Edit Info</h2>
    <p class="note">Changes are saved in Aria only — your file is never modified.</p>

    <div class="body">
      <div class="art-col">
        <Artwork src={artPreview} size="140px" radius="10px" kind={edit.target.kind} />
        <button class="link" onclick={changeImage}>Change Image</button>
        <button class="link" onclick={resetImage}>Use Embedded</button>
        <button class="link" onclick={setArtistImage}>Set Artist Image…</button>
      </div>
      <div class="fields">
        <label><span>Title</span><input bind:value={title} onkeydown={onKey} /></label>
        <label><span>Artist</span><input bind:value={artist} onkeydown={onKey} /></label>
        <label><span>Album (tag)</span><input bind:value={album} onkeydown={onKey} /></label>
      </div>
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="actions">
      <button class="btn ghost" onclick={revertAll} disabled={saving}>Revert All</button>
      <div class="spacer"></div>
      <button class="btn" onclick={() => edit.close()} disabled={saving}>Cancel</button>
      <button class="btn primary" onclick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 200;
  }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 201;
    width: 520px;
    max-width: calc(100vw - 40px);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 24px;
  }
  h2 {
    font-size: 20px;
    font-weight: 700;
  }
  .note {
    color: var(--text-faint);
    font-size: 12px;
    margin: 4px 0 18px;
  }
  .body {
    display: flex;
    gap: 22px;
  }
  .art-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .link {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    padding: 3px 4px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .fields {
    flex: 1;
  }
  label {
    display: block;
    margin-bottom: 14px;
  }
  label span {
    display: block;
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 5px;
  }
  input {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 9px 12px;
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  .error {
    color: #ff5a5a;
    font-size: 12px;
    margin: 0 0 12px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .spacer {
    flex: 1;
  }
  .btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 600;
  }
  .btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: transparent;
  }
  .btn.ghost {
    border-color: transparent;
    color: var(--text-dim);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
