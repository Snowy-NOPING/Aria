<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { library } from "$lib/library.svelte";
  import { lastfm } from "$lib/lastfm.svelte";

  let apiSecret = $state("");

  async function saveLastFm() {
    if (await lastfm.saveSettings(apiSecret)) apiSecret = "";
  }

  async function connectLastFm() {
    await lastfm.beginAuth(apiSecret);
    if (lastfm.awaitingApproval) apiSecret = "";
  }
</script>

<div class="view">
  <div class="view-title">Settings</div>

  <section>
    <div class="sec-head">
      <h2>Media Folders</h2>
      <div class="tools">
        <button class="pill-btn" onclick={() => library.rescan()} disabled={library.scanning}>
          {library.scanning ? "Scanning…" : "Rescan"}
        </button>
        <button class="pill-btn filled" onclick={() => library.addFolder()}>+ Add Folder</button>
      </div>
    </div>
    <p class="desc">
      Aria scans these folders for music and video. Your <code>Music</code> and
      <code>Videos</code> folders are added by default.
    </p>

    {#if library.folders.length === 0}
      <div class="empty">No folders. Add one to build your library.</div>
    {:else}
      <div class="folders">
        {#each library.folders as folder}
          <div class="folder">
            <span class="folder-icon">🗀</span>
            <span class="path" title={folder}>{folder}</span>
            <button class="remove" title="Remove" onclick={() => library.removeFolder(folder)}>
              ✕
            </button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="counts">
      {library.tracks.length} songs · {library.videos.length} videos
    </div>
  </section>

  <section>
    <h2>Lyrics</h2>
    <p class="desc">
      Successful LRCLIB results are cached permanently. Missing results are retried after
      seven days, and you can force a fresh lookup from the Lyrics view at any time.
    </p>
  </section>

  <section aria-busy={lastfm.busy}>
    <div class="sec-head">
      <div>
        <h2>Last.fm</h2>
        {#if lastfm.connected}
          <div class="connection">Connected as {lastfm.username || "Last.fm user"}</div>
        {/if}
      </div>
      {#if lastfm.connected}
        <button class="pill-btn" disabled={lastfm.busy} onclick={() => lastfm.disconnect()}>
          Disconnect
        </button>
      {/if}
    </div>
    <p class="desc">
      Connect with Last.fm's desktop authorization flow. Aria stores the API credentials and
      session key locally; it never asks for or stores your Last.fm password.
    </p>

    <div class="credential-grid">
      <label>
        <span>API key</span>
        <input
          autocomplete="off"
          spellcheck="false"
          bind:value={lastfm.apiKey}
          placeholder="32-character Last.fm API key"
        />
      </label>
      <label>
        <span>Shared secret</span>
        <input
          type="password"
          autocomplete="off"
          bind:value={apiSecret}
          placeholder={lastfm.hasSecret ? "Saved — leave blank to keep" : "Last.fm shared secret"}
        />
      </label>
    </div>

    <button
      class="text-link"
      onclick={() => openUrl("https://www.last.fm/api/account/create")}
    >
      Create or view a Last.fm API account
    </button>

    <div class="switches">
      <label class="switch-row">
        <span>
          <strong>Enable Last.fm scrobbling</strong>
          <small>Submit a listen after half the track or four minutes, whichever comes first.</small>
        </span>
        <input type="checkbox" bind:checked={lastfm.scrobblingEnabled} />
      </label>
      <label class="switch-row">
        <span>
          <strong>Show Now Playing</strong>
          <small>Update your Last.fm profile as soon as a track begins.</small>
        </span>
        <input type="checkbox" bind:checked={lastfm.nowPlayingEnabled} />
      </label>
    </div>

    <div class="lastfm-actions">
      <button class="pill-btn" disabled={lastfm.busy} onclick={saveLastFm}>
        Save Settings
      </button>
      {#if !lastfm.connected}
        <button class="pill-btn filled" disabled={lastfm.busy} onclick={connectLastFm}>
          Connect Last.fm
        </button>
      {/if}
      {#if lastfm.awaitingApproval && !lastfm.connected}
        <button class="pill-btn filled" disabled={lastfm.busy} onclick={() => lastfm.finishAuth()}>
          I Approved It — Finish
        </button>
      {/if}
    </div>

    {#if lastfm.pendingScrobbles > 0}
      <div class="queue-note">
        <span>
          {lastfm.pendingScrobbles}
          {lastfm.pendingScrobbles === 1 ? "scrobble is" : "scrobbles are"} waiting to retry.
        </span>
        <button class="pill-btn" disabled={lastfm.busy} onclick={() => lastfm.flush()}>
          Retry Now
        </button>
      </div>
    {/if}

    <div class="feedback" aria-live="polite">
      {#if lastfm.busy}
        <span>Working…</span>
      {:else if lastfm.lastError}
        <span class="error" role="alert">{lastfm.lastError}</span>
      {:else if lastfm.notice}
        <span>{lastfm.notice}</span>
      {/if}
    </div>
  </section>
</div>

<style>
  section {
    max-width: 720px;
    margin-bottom: 34px;
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    font-size: 19px;
    font-weight: 700;
  }
  .tools {
    display: flex;
    gap: 8px;
  }
  .desc {
    color: var(--text-dim);
    font-size: 13px;
    margin: 6px 0 16px;
  }
  .connection {
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
    margin-top: 4px;
  }
  code {
    background: var(--surface);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .folders {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .folder {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
  }
  .folder-icon {
    opacity: 0.7;
  }
  .path {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .remove {
    color: var(--text-faint);
    width: 24px;
    height: 24px;
    border-radius: 6px;
  }
  .remove:hover {
    background: var(--active);
    color: #ff5a5a;
  }
  .empty {
    color: var(--text-dim);
    padding: 20px 0;
  }
  .counts {
    margin-top: 14px;
    font-size: 12px;
    color: var(--text-faint);
  }
  .credential-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .credential-grid label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 650;
  }
  .credential-grid input {
    width: 100%;
    min-height: 40px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    padding: 0 12px;
    outline: none;
  }
  .credential-grid input:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .text-link {
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
    padding: 8px 0;
  }
  .switches {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0 16px;
  }
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 54px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .switch-row span {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .switch-row strong {
    font-size: 13px;
  }
  .switch-row small {
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 400;
  }
  .switch-row input {
    width: 18px;
    height: 18px;
    flex: none;
    accent-color: var(--accent);
  }
  .lastfm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .queue-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 14px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 12px;
  }
  .feedback {
    min-height: 20px;
    margin-top: 10px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .error {
    color: #ff6b6b;
  }
  @media (max-width: 760px) {
    .credential-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
