<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { library } from "$lib/library.svelte";
  import { lastfm } from "$lib/lastfm.svelte";
  import { discord } from "$lib/discord.svelte";
  import { theme, BACKDROPS, SKINS } from "$lib/theme.svelte";
  import { lyricsStyle, LYRIC_FX } from "$lib/lyricsStyle.svelte";

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
    <h2>Appearance</h2>
    <p class="desc">
      Both themes follow your system light and dark setting.
    </p>

    <div class="skins" role="radiogroup" aria-label="Theme">
      {#each SKINS as option}
        <button
          class="skin"
          class:on={theme.skin === option.id}
          role="radio"
          aria-checked={theme.skin === option.id}
          onclick={() => theme.setSkin(option.id)}
        >
          <span class="preview" data-skin-preview={option.id} aria-hidden="true">
            <span class="p-rail">
              <span class="p-nav on"></span>
              <span class="p-nav"></span>
              <span class="p-nav"></span>
            </span>
            <span class="p-body">
              <span class="p-title">Aa</span>
              <span class="p-row"></span>
              <span class="p-row short"></span>
              <span class="p-accent"></span>
            </span>
          </span>
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </button>
      {/each}
    </div>

    <h3>Window backdrop</h3>
    <p class="desc">
      Aria's window is transparent, so it can either paint its own surface or let a
      blurred material show through. Pick <strong>Mica For Everyone</strong> if you use that
      tool — Aria then applies no backdrop of its own and simply gets out of its way.
    </p>

    <div class="backdrops" role="radiogroup" aria-label="Window backdrop">
      {#each BACKDROPS as option}
        <button
          class="backdrop"
          class:on={theme.backdrop === option.id}
          role="radio"
          aria-checked={theme.backdrop === option.id}
          onclick={() => theme.setBackdrop(option.id)}
        >
          <span class="swatch" data-preview={option.id}></span>
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </button>
      {/each}
    </div>

    <!-- The wash only has meaning where there is an artwork colour field to
         fade. The Claude theme paints none, so the control is left out rather
         than shown doing nothing. -->
    {#if theme.artworkField}
      <label class="wash-row">
        <span>
          <strong>Artwork wash</strong>
          <small>How strongly the album-colour field is painted over the backdrop.</small>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-label="Artwork wash strength"
          value={theme.wash}
          oninput={(e) => theme.setWash(+(e.target as HTMLInputElement).value)}
        />
        <span class="wash-value">{Math.round(theme.wash * 100)}%</span>
      </label>
    {/if}

    {#if theme.lastError}
      <div class="feedback">
        <span class="error" role="alert">
          Windows refused that backdrop ({theme.lastError}). The window stays transparent, so an
          external compositor can still paint behind it.
        </span>
      </div>
    {/if}
  </section>

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

    <div class="sec-head">
      <h3>Karaoke rendering</h3>
      {#if !lyricsStyle.isDefault}
        <div class="tools">
          <button class="pill-btn" onclick={() => lyricsStyle.reset()}>Reset</button>
        </div>
      {/if}
    </div>
    <p class="desc">
      These affect word-synced lyrics, which need per-word timing from a
      <code>.lyricsfile.yaml</code> file. Line-synced sources such as LRC still use the
      line transition and cascade.
    </p>
    {#each LYRIC_FX as knob (knob.key)}
      <label class="wash-row">
        <span>
          <strong>{knob.label}</strong>
          <small>{knob.hint}</small>
        </span>
        <input
          type="range"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          aria-label={knob.label}
          value={lyricsStyle[knob.key]}
          oninput={(e) => lyricsStyle.set(knob.key, +(e.target as HTMLInputElement).value)}
        />
        <span class="wash-value">{Math.round(lyricsStyle[knob.key] * 100)}%</span>
      </label>
    {/each}
  </section>

  <section aria-busy={discord.busy}>
    <div class="sec-head">
      <div>
        <h2>Discord</h2>
        {#if discord.enabled && discord.connected}
          <div class="connection">Connected — showing your current track</div>
        {/if}
      </div>
    </div>
    <p class="desc">
      Shows what you're playing on your Discord profile, with album art and a progress
      bar. Works as-is — Aria publishes under its own Discord application, the same way
      Cider and other players do.
    </p>

    <details class="advanced">
      <summary>Use your own Discord application</summary>
      <p class="desc">
        Only needed if you want the card to carry a different name or your own fallback
        art. Whatever you <strong>name</strong> the application is what the card says
        you're listening to. Leave blank to keep Aria's.
      </p>
      <div class="credential-grid one">
        <label>
          <span>Application ID</span>
          <input
            autocomplete="off"
            spellcheck="false"
            bind:value={discord.appId}
            placeholder={discord.usingDefault ? "Using Aria's built-in application" : ""}
          />
        </label>
      </div>
      <button
        class="text-link"
        onclick={() => openUrl("https://discord.com/developers/applications")}
      >
        Open the Discord developer portal
      </button>
    </details>

    <div class="switches">
      <label class="switch-row">
        <span>
          <strong>Enable Rich Presence</strong>
          <small>
            Album art is looked up on Deezer, then iTunes, since Discord can't read
            covers off your disk. Anything neither has falls back to your app's icon.
          </small>
        </span>
        <input type="checkbox" bind:checked={discord.enabled} />
      </label>
    </div>

    <div class="lastfm-actions">
      <button class="pill-btn filled" disabled={discord.busy} onclick={() => discord.save()}>
        {discord.busy ? "Saving…" : "Save Settings"}
      </button>
    </div>

    <div class="feedback" aria-live="polite">
      {#if discord.enabled && !discord.connected}
        <span class="error" role="alert">
          {#if /client id/i.test(discord.lastError)}
            Discord rejected that application ID. Copy the <strong>Application ID</strong>
            from your app's General Information page — not the public key or a bot token.
          {:else if discord.lastError}
            Can't reach Discord ({discord.lastError}). Aria reconnects on its own once
            Discord is running.
          {:else}
            Waiting for Discord — start it and play something.
          {/if}
        </span>
      {:else if discord.notice}
        <span>{discord.notice}</span>
      {/if}
    </div>
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
  h3 {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-dim);
    margin: 26px 0 0;
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
    color: var(--danger);
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
  /* Theme picker ---------------------------------------------------------- */

  .skins {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
  }
  .skin {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 10px 12px 12px;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 220ms var(--motion-spring);
  }
  .skin:hover {
    background: var(--hover);
  }
  .skin.on {
    border-color: var(--accent);
    background: var(--active);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .skin strong {
    font-size: 13px;
    margin-top: 8px;
  }
  .skin small {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.35;
  }

  /* Each preview paints the theme it offers, not the one currently applied, so
     its colours are literal rather than tokens. It follows the system light/dark
     setting because both themes do. */
  .preview {
    display: flex;
    height: 82px;
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .p-rail {
    width: 34%;
    flex: none;
    border-right: 1px solid;
    padding: 9px 7px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .p-nav {
    height: 6px;
    border-radius: 3px;
    width: 84%;
  }
  .p-nav.on {
    width: 100%;
  }
  .p-body {
    flex: 1;
    position: relative;
    padding: 9px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .p-title {
    font-size: 15px;
    line-height: 1;
    font-weight: 700;
  }
  .p-row {
    height: 5px;
    border-radius: 3px;
    width: 100%;
  }
  .p-row.short {
    width: 62%;
  }
  .p-accent {
    position: absolute;
    right: 9px;
    bottom: 9px;
    width: 20px;
    height: 8px;
    border-radius: 4px;
  }

  [data-skin-preview="claude"] .p-rail {
    background: #f0eee6;
    border-right-color: rgba(61, 48, 33, 0.14);
  }
  [data-skin-preview="claude"] .p-body {
    background: #faf9f5;
  }
  [data-skin-preview="claude"] .p-title {
    color: #141413;
    font-family: "Copernicus", "Tiempos Text", Charter, Georgia, serif;
    font-weight: 600;
  }
  [data-skin-preview="claude"] .p-row {
    background: rgba(20, 20, 19, 0.14);
  }
  [data-skin-preview="claude"] .p-nav {
    background: rgba(20, 20, 19, 0.13);
  }
  [data-skin-preview="claude"] .p-nav.on {
    background: rgba(174, 83, 48, 0.28);
  }
  [data-skin-preview="claude"] .p-accent {
    background: #ae5330;
  }

  /* Aria's identity is the blurred album-colour field, so the preview shows the
     default artwork palette under a frosted panel. */
  [data-skin-preview="aria"] .p-rail {
    background:
      linear-gradient(160deg, rgba(245, 245, 247, 0.62), rgba(245, 245, 247, 0.42)),
      linear-gradient(140deg, rgb(182, 141, 93), rgb(122, 75, 100));
    border-right-color: rgba(0, 0, 0, 0.1);
  }
  [data-skin-preview="aria"] .p-body {
    background:
      linear-gradient(0deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.72)),
      radial-gradient(circle at 20% 0%, rgb(216, 177, 128), transparent 62%),
      radial-gradient(circle at 90% 100%, rgb(71, 62, 113), transparent 66%),
      linear-gradient(140deg, rgb(182, 141, 93), rgb(122, 75, 100));
  }
  [data-skin-preview="aria"] .p-title {
    color: #1d1d1f;
    letter-spacing: -0.5px;
    font-weight: 800;
    /* Spelled out rather than inherited — a preview must show its own theme's
       face, not the one currently applied to the app around it. */
    font-family:
      "SF Pro Display", -apple-system, "Segoe UI Variable", "Segoe UI", system-ui,
      sans-serif;
  }
  [data-skin-preview="aria"] .p-row {
    background: rgba(0, 0, 0, 0.16);
  }
  [data-skin-preview="aria"] .p-nav {
    background: rgba(0, 0, 0, 0.14);
  }
  [data-skin-preview="aria"] .p-nav.on {
    background: rgba(255, 255, 255, 0.6);
  }
  [data-skin-preview="aria"] .p-accent {
    background: rgb(182, 141, 93);
    border-radius: 980px;
  }

  @media (prefers-color-scheme: dark) {
    [data-skin-preview="claude"] .p-rail {
      background: #1f1e1d;
      border-right-color: rgba(255, 255, 255, 0.1);
    }
    [data-skin-preview="claude"] .p-body {
      background: #262624;
    }
    [data-skin-preview="claude"] .p-title {
      color: #f5f4ee;
    }
    [data-skin-preview="claude"] .p-row {
      background: rgba(245, 244, 238, 0.17);
    }
    [data-skin-preview="claude"] .p-nav {
      background: rgba(245, 244, 238, 0.16);
    }
    [data-skin-preview="claude"] .p-nav.on {
      background: rgba(217, 119, 87, 0.4);
    }
    [data-skin-preview="claude"] .p-accent {
      background: #d97757;
    }

    [data-skin-preview="aria"] .p-rail {
      background:
        linear-gradient(160deg, rgba(24, 24, 27, 0.6), rgba(24, 24, 27, 0.4)),
        linear-gradient(140deg, rgb(182, 141, 93), rgb(122, 75, 100));
      border-right-color: rgba(255, 255, 255, 0.1);
    }
    [data-skin-preview="aria"] .p-body {
      background:
        linear-gradient(0deg, rgba(16, 16, 18, 0.66), rgba(16, 16, 18, 0.66)),
        radial-gradient(circle at 20% 0%, rgb(216, 177, 128), transparent 62%),
        radial-gradient(circle at 90% 100%, rgb(71, 62, 113), transparent 66%),
        linear-gradient(140deg, rgb(182, 141, 93), rgb(122, 75, 100));
    }
    [data-skin-preview="aria"] .p-title {
      color: #f5f5f7;
    }
    [data-skin-preview="aria"] .p-row {
      background: rgba(255, 255, 255, 0.22);
    }
    [data-skin-preview="aria"] .p-nav {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  .backdrops {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
  }
  .backdrop {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 12px 12px;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 220ms var(--motion-spring);
  }
  .backdrop:hover {
    background: var(--hover);
    transform: translateY(-1px);
  }
  .backdrop.on {
    border-color: var(--accent);
    background: var(--active);
  }
  .backdrop strong {
    font-size: 13px;
  }
  .backdrop small {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.35;
  }
  .swatch {
    width: 100%;
    height: 38px;
    margin-bottom: 6px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background:
      linear-gradient(135deg, var(--art-primary), var(--art-tertiary));
  }
  .swatch[data-preview="mica"] {
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--art-primary) 45%, transparent),
        color-mix(in srgb, var(--art-tertiary) 45%, transparent)),
      repeating-linear-gradient(45deg, var(--hover) 0 6px, var(--surface) 6px 12px);
  }
  .swatch[data-preview="mica-alt"] {
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--art-primary) 70%, transparent),
        color-mix(in srgb, var(--art-secondary) 70%, transparent)),
      repeating-linear-gradient(45deg, var(--hover) 0 6px, var(--surface) 6px 12px);
  }
  .swatch[data-preview="acrylic"] {
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--art-secondary) 30%, transparent),
        color-mix(in srgb, var(--art-primary) 30%, transparent)),
      repeating-linear-gradient(45deg, var(--active) 0 4px, transparent 4px 8px);
  }
  .swatch[data-preview="external"] {
    background: repeating-conic-gradient(var(--hover) 0 25%, transparent 0 50%) 0 0 / 12px 12px;
  }
  /* Under a flat theme "Solid" is paper, not an artwork field — the default
     gradient would promise colour the window will never paint. */
  :global(html[data-skin="claude"]) .swatch[data-preview="opaque"] {
    background:
      radial-gradient(
        circle at 100% 100%,
        color-mix(in srgb, var(--art-primary) 26%, transparent),
        transparent 62%
      ),
      linear-gradient(135deg, var(--bg), var(--sidebar));
  }
  .wash-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 12px;
    min-height: 54px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .wash-row > span:first-child {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .wash-row strong {
    font-size: 13px;
  }
  .wash-row small {
    color: var(--text-dim);
    font-size: 12px;
  }
  .wash-row input {
    width: 160px;
    accent-color: var(--accent);
  }
  .wash-value {
    width: 40px;
    text-align: right;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .credential-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  /* A lone field shouldn't stretch to the full 720px measure. */
  .credential-grid.one {
    grid-template-columns: minmax(0, 420px);
  }
  /* Escape hatch for the one setting almost nobody needs, folded away so the
     section reads as "it already works" rather than "configure me". */
  .advanced {
    margin: 4px 0 14px;
  }
  .advanced > summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
    color: var(--text-dim);
    padding: 6px 0;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .advanced > summary::-webkit-details-marker {
    display: none;
  }
  .advanced > summary::before {
    content: "›";
    display: inline-block;
    transition: transform 160ms var(--motion-spring);
    font-size: 14px;
  }
  .advanced[open] > summary::before {
    transform: rotate(90deg);
  }
  .advanced > summary:hover {
    color: var(--text);
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
    color: var(--danger);
  }
  @media (max-width: 760px) {
    .credential-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
