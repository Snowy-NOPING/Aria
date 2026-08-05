//! Discord Rich Presence.
//!
//! Publishes the current track as a `Listening` activity so Discord renders the
//! Spotify-style card: album art, title, artist, and a progress bar derived from
//! `timestamps`.
//!
//! Two things are worth knowing before changing this:
//!
//! * **The card header is the Discord application's name.** It reads "Listening
//!   to <app name>", so the user names their own application "Aria". Discord's
//!   own Spotify card (green button, "Listening to Spotify") is a first-party
//!   integration and is not reachable through Rich Presence.
//! * **Art must be a public URL.** Rich Presence has no way to show a local
//!   file or a data URI, and this library's covers are either embedded in the
//!   FLAC or absent. So album art is looked up once per album on Deezer (with
//!   iTunes as a second pass) and cached for the session.
//!
//! The IPC client is blocking and lives on its own thread; commands only push
//! messages onto a channel, so a stalled pipe can never freeze the UI. Artwork
//! lookups happen in the async command *before* handing off, because reqwest
//! here is the async flavour.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Discord rejects `details`/`state` shorter than 2 bytes and truncates past
/// 128. Padding a 1-character title is nicer than dropping the field.
const MIN_FIELD: usize = 2;
const MAX_FIELD: usize = 128;

/// Aria's own Discord application, shipped so presence works on first launch
/// with no setup — the same thing Cider and every other RPC-capable player
/// does. An application ID is not a secret: it's public in the handshake of
/// every client that connects, and grants nothing on its own.
///
/// The application's *name* is what the card reads ("Listening to …"), and its
/// uploaded art assets are what `large_image` falls back to. Point `app_id` at
/// your own application to override both.
const DEFAULT_APP_ID: &str = "1531467826659856564";

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    /// Empty means "use `DEFAULT_APP_ID`" rather than "disabled", so the
    /// Settings field can be left blank.
    app_id: String,
    enabled: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            enabled: true,
        }
    }
}

impl Config {
    /// The ID actually handed to Discord.
    fn resolved_app_id(&self) -> String {
        let trimmed = self.app_id.trim();
        if trimmed.is_empty() {
            DEFAULT_APP_ID.to_string()
        } else {
            trimmed.to_string()
        }
    }
}

/// What the frontend is allowed to see.
#[derive(Clone, Serialize, Default)]
pub struct View {
    /// As stored — blank when the built-in application is in use.
    pub app_id: String,
    /// What's actually being published under, so Settings can say which.
    pub effective_app_id: String,
    pub using_default: bool,
    pub enabled: bool,
    pub connected: bool,
    pub last_error: String,
}

/// Track fields the frontend submits. Mirrors `lastfm::TrackPayload` minus the
/// bits Rich Presence has no use for.
#[derive(Clone, Deserialize)]
pub struct TrackPayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub position: f64,
    pub playing: bool,
}

/// Messages for the IPC thread.
enum Cmd {
    Connect(String),
    Activity(Box<Presence>),
    Clear,
    Disconnect,
}

/// A fully resolved activity — every lookup already done, so the IPC thread
/// never needs to touch the network or the cache.
struct Presence {
    details: String,
    state: String,
    large_image: String,
    large_text: String,
    button_label: String,
    button_url: String,
    /// Unix seconds. `None` while paused, which is what removes the progress
    /// bar instead of letting it run on without the audio.
    start: Option<i64>,
    end: Option<i64>,
}

#[derive(Default)]
struct Status {
    connected: bool,
    last_error: String,
}

pub struct Discord {
    tx: Sender<Cmd>,
    status: Arc<Mutex<Status>>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    config: Config,
    /// "artist|album" (lowercased) -> artwork URL, or `None` for a miss we
    /// already know about. Session-only: covers change rarely but a restart is
    /// a cheap way to retry misses.
    art: HashMap<String, Option<String>>,
    /// Last payload actually sent, so repeated identical syncs (the frontend
    /// ticks once a second) don't spam the socket.
    last_sent: String,
}

impl Discord {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Cmd>();
        let status = Arc::new(Mutex::new(Status::default()));
        let thread_status = Arc::clone(&status);

        std::thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || ipc_loop(rx, thread_status))
            .expect("spawn discord thread");

        Self {
            tx,
            status,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn send(&self, cmd: Cmd) {
        // A dead thread means shutdown is underway; nothing useful to do.
        let _ = self.tx.send(cmd);
    }

    fn view(&self) -> View {
        let inner = self.inner.lock().unwrap();
        let status = self.status.lock().unwrap();
        View {
            app_id: inner.config.app_id.clone(),
            effective_app_id: inner.config.resolved_app_id(),
            using_default: inner.config.app_id.trim().is_empty(),
            enabled: inner.config.enabled,
            connected: status.connected,
            last_error: status.last_error.clone(),
        }
    }
}

/// Owns the blocking IPC client for the process lifetime.
///
/// Discord may not be running, may be started later, or may quit mid-session,
/// so every failure is recoverable: we drop the client, record the reason, and
/// let the next activity update reconnect.
fn ipc_loop(rx: std::sync::mpsc::Receiver<Cmd>, status: Arc<Mutex<Status>>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut app_id = String::new();

    let set_status = |connected: bool, error: String| {
        if let Ok(mut s) = status.lock() {
            s.connected = connected;
            s.last_error = error;
        }
    };

    while let Ok(cmd) = rx.recv() {
        match cmd {
            Cmd::Connect(id) => {
                if let Some(mut c) = client.take() {
                    let _ = c.close();
                }
                app_id = id;
                if app_id.is_empty() {
                    set_status(false, String::new());
                    continue;
                }
                let mut c = DiscordIpcClient::new(&app_id);
                match c.connect() {
                    Ok(()) => {
                        client = Some(c);
                        set_status(true, String::new());
                    }
                    Err(e) => set_status(false, e.to_string()),
                }
            }

            Cmd::Activity(presence) => {
                if app_id.is_empty() {
                    continue;
                }
                // Lazily (re)connect: Discord is often launched after Aria.
                if client.is_none() {
                    let mut c = DiscordIpcClient::new(&app_id);
                    match c.connect() {
                        Ok(()) => {
                            client = Some(c);
                            set_status(true, String::new());
                        }
                        Err(e) => {
                            set_status(false, e.to_string());
                            continue;
                        }
                    }
                }

                if let Some(c) = client.as_mut() {
                    if let Err(e) = c.set_activity(build_activity(&presence)) {
                        // Broken pipe (Discord quit). Drop it so the next
                        // update reconnects rather than failing forever.
                        set_status(false, e.to_string());
                        let _ = c.close();
                        client = None;
                    } else {
                        set_status(true, String::new());
                    }
                }
            }

            Cmd::Clear => {
                if let Some(c) = client.as_mut() {
                    if c.clear_activity().is_err() {
                        let _ = c.close();
                        client = None;
                        set_status(false, String::new());
                    }
                }
            }

            Cmd::Disconnect => {
                if let Some(mut c) = client.take() {
                    let _ = c.close();
                }
                app_id.clear();
                set_status(false, String::new());
            }
        }
    }
}

fn build_activity(p: &Presence) -> activity::Activity<'_> {
    let mut assets = activity::Assets::new().large_image(&p.large_image);
    if !p.large_text.is_empty() {
        assets = assets.large_text(&p.large_text);
    }

    let mut act = activity::Activity::new()
        // `Listening` is what turns `timestamps` into a progress bar rather
        // than an "elapsed" counter, and gives the "Listening to" prefix.
        .activity_type(activity::ActivityType::Listening)
        .status_display_type(activity::StatusDisplayType::Name)
        .details(&p.details)
        .state(&p.state)
        .assets(assets);

    if let (Some(start), Some(end)) = (p.start, p.end) {
        act = act.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    if !p.button_label.is_empty() && !p.button_url.is_empty() {
        act = act.buttons(vec![activity::Button::new(
            p.button_label.as_str(),
            p.button_url.as_str(),
        )]);
    }

    act
}

/// Clamp a field to Discord's accepted length. Short strings get a trailing
/// space rather than being dropped, since a 1-character song title is legal.
fn field(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    let base = if trimmed.is_empty() { fallback } else { trimmed };
    let mut out: String = base.chars().take(MAX_FIELD).collect();
    while out.chars().count() < MIN_FIELD {
        out.push(' ');
    }
    out
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ── Artwork ─────────────────────────────────────────────────────────────────

/// Find a public cover-art URL for a track. Both sources are keyless.
///
/// Deezer goes first because it carries independent and very recent releases
/// that Apple's catalogue simply doesn't have — the library this was built
/// against returns nothing at all from iTunes, artist included. iTunes stays as
/// a second pass since the two catalogues don't perfectly overlap.
///
/// `None` means neither knew the record, and the caller falls back to the
/// application's own uploaded icon.
async fn lookup_art(artist: &str, album: &str, title: &str) -> Option<String> {
    let client = reqwest::Client::new();

    // Track-level first: it pins down the right release when an artist has
    // several with similar names, and still yields that release's cover.
    if let Some(url) = deezer_track_art(&client, artist, title).await {
        return Some(url);
    }
    if let Some(url) = deezer_album_art(&client, artist, album).await {
        return Some(url);
    }
    itunes_album_art(&client, artist, album).await
}

async fn deezer_track_art(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Option<String> {
    let term = format!("{artist} {title}").trim().to_string();
    if term.is_empty() {
        return None;
    }
    let body: serde_json::Value = client
        .get("https://api.deezer.com/search")
        .query(&[("q", term.as_str()), ("limit", "1")])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    // 500px ("big") is more than the card needs; the 1000px variant is ~240 KB
    // for no visible gain once Discord scales it down.
    body.get("data")?
        .as_array()?
        .first()?
        .get("album")?
        .get("cover_big")?
        .as_str()
        .map(str::to_owned)
}

async fn deezer_album_art(
    client: &reqwest::Client,
    artist: &str,
    album: &str,
) -> Option<String> {
    let term = format!("{artist} {album}").trim().to_string();
    if term.is_empty() {
        return None;
    }
    let body: serde_json::Value = client
        .get("https://api.deezer.com/search/album")
        .query(&[("q", term.as_str()), ("limit", "1")])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    body.get("data")?
        .as_array()?
        .first()?
        .get("cover_big")?
        .as_str()
        .map(str::to_owned)
}

async fn itunes_album_art(
    client: &reqwest::Client,
    artist: &str,
    album: &str,
) -> Option<String> {
    let term = format!("{artist} {album}").trim().to_string();
    if term.is_empty() {
        return None;
    }
    let body: serde_json::Value = client
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", term.as_str()),
            ("entity", "album"),
            ("limit", "1"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let art = body
        .get("results")?
        .as_array()?
        .first()?
        .get("artworkUrl100")?
        .as_str()?;

    // iTunes serves a 100px thumbnail by default; the same path renders larger.
    Some(art.replace("100x100bb", "512x512bb"))
}

/// The activity button. A *search* URL rather than a deep link, because a local
/// library contains plenty that no streaming service has a page for — an
/// unreleased track would otherwise get a button leading to a 404.
fn search_url(artist: &str, title: &str) -> String {
    let query = urlencode(format!("{artist} {title}").trim());
    format!("https://open.spotify.com/search/{query}")
}

/// Minimal percent-encoding. Avoids pulling in a URL crate for one call site.
/// Spaces become `%20`, not `+`, so the result is valid in a path segment as
/// well as a query value.
fn urlencode(input: impl AsRef<str>) -> String {
    let input = input.as_ref();
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

// ── Persistence ─────────────────────────────────────────────────────────────

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("discord.json"))
}

fn load_config(app: &AppHandle) -> Option<Config> {
    let text = std::fs::read_to_string(store_path(app).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(config).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Restore the saved settings at startup and connect if presence was on.
pub fn init(app: &AppHandle) {
    let Some(state) = app.try_state::<Discord>() else {
        return;
    };
    // No stored file is a first run, not a reason to stay silent: the defaults
    // (built-in application, presence on) are what makes this work unconfigured.
    let config = load_config(app).unwrap_or_default();
    let connect = config.enabled;
    let app_id = config.resolved_app_id();
    state.inner.lock().unwrap().config = config;
    if connect {
        state.send(Cmd::Connect(app_id));
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn discord_get_state(state: State<'_, Discord>) -> View {
    state.view()
}

#[tauri::command]
pub fn discord_save_settings(
    app: AppHandle,
    state: State<'_, Discord>,
    app_id: String,
    enabled: bool,
) -> Result<View, String> {
    let resolved = {
        let mut inner = state.inner.lock().unwrap();
        inner.config = Config {
            app_id: app_id.trim().to_string(),
            enabled,
        };
        // Force the next sync through even if the track didn't change, so
        // toggling presence back on repopulates the card immediately.
        inner.last_sent.clear();
        save_config(&app, &inner.config)?;
        inner.config.resolved_app_id()
    };

    if enabled {
        state.send(Cmd::Connect(resolved));
    } else {
        state.send(Cmd::Disconnect);
    }
    Ok(state.view())
}

/// Publish the current track. Called on track change, play/pause, and seeks.
#[tauri::command]
pub async fn discord_set_activity(
    state: State<'_, Discord>,
    track: TrackPayload,
) -> Result<(), String> {
    let key = art_key(&track.artist, &track.album);

    /// Whether we already know this album's art. A cached *miss* still counts
    /// as known, so a track iTunes has never heard of isn't looked up again on
    /// every play/pause.
    enum Art {
        Known(Option<String>),
        Unknown,
    }

    let cached = {
        let inner = state.inner.lock().unwrap();
        if !inner.config.enabled {
            return Ok(());
        }
        match inner.art.get(&key) {
            Some(entry) => Art::Known(entry.clone()),
            None => Art::Unknown,
        }
    };

    let art = match cached {
        Art::Known(entry) => entry,
        Art::Unknown => {
            let looked_up = lookup_art(&track.artist, &track.album, &track.title).await;
            state
                .inner
                .lock()
                .unwrap()
                .art
                .insert(key, looked_up.clone());
            looked_up
        }
    };

    let start = if track.playing {
        Some(now_secs() - track.position.max(0.0) as i64)
    } else {
        None
    };
    let end = match (start, track.duration > 0.0) {
        (Some(s), true) => Some(s + track.duration as i64),
        _ => None,
    };

    let presence = Presence {
        details: field(&track.title, "Unknown track"),
        state: field(&track.artist, "Unknown artist"),
        // Falls back to the asset key "aria" — whatever image the user uploaded
        // to their Discord application under that name.
        large_image: art.unwrap_or_else(|| "aria".to_string()),
        large_text: field(&track.album, "Aria"),
        button_label: "Find this song".to_string(),
        button_url: search_url(&track.artist, &track.title),
        start,
        end,
    };

    // Skip identical resends. Position is deliberately excluded while playing:
    // the progress bar advances on Discord's side from `start`, so a per-second
    // tick would be pure noise on the socket.
    let signature = format!(
        "{}|{}|{}|{}|{}",
        presence.details,
        presence.state,
        presence.large_image,
        track.playing,
        start.unwrap_or(0)
    );
    {
        let mut inner = state.inner.lock().unwrap();
        if inner.last_sent == signature {
            return Ok(());
        }
        inner.last_sent = signature;
    }

    state.send(Cmd::Activity(Box::new(presence)));
    Ok(())
}

#[tauri::command]
pub fn discord_clear_activity(state: State<'_, Discord>) {
    state.inner.lock().unwrap().last_sent.clear();
    state.send(Cmd::Clear);
}

fn art_key(artist: &str, album: &str) -> String {
    format!(
        "{}|{}",
        artist.trim().to_lowercase(),
        album.trim().to_lowercase()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_pads_short_and_truncates_long() {
        assert_eq!(field("A", "x"), "A ");
        assert_eq!(field("   ", "fallback"), "fallback");
        assert_eq!(field(&"z".repeat(200), "x").chars().count(), MAX_FIELD);
    }

    #[test]
    fn urlencode_escapes_unsafe_bytes_and_keeps_paths_valid() {
        assert_eq!(urlencode("feel alive !"), "feel%20alive%20%21");
        assert_eq!(urlencode("a&b=c"), "a%26b%3Dc");
        assert_eq!(urlencode("don't"), "don%27t");
    }

    #[test]
    fn paused_tracks_carry_no_timestamps() {
        // A paused card must lose the progress bar; Discord would otherwise
        // keep advancing it from `start` while the audio sits still.
        let p = Presence {
            details: "t".into(),
            state: "a".into(),
            large_image: "aria".into(),
            large_text: "al".into(),
            button_label: String::new(),
            button_url: String::new(),
            start: None,
            end: None,
        };
        let json = serde_json::to_string(&build_activity(&p)).unwrap();
        assert!(!json.contains("timestamps"), "got {json}");
    }

    #[test]
    fn blank_app_id_resolves_to_the_built_in_application() {
        let mut config = Config::default();
        assert!(config.enabled, "presence ships on, or the default ID is pointless");
        assert_eq!(config.resolved_app_id(), DEFAULT_APP_ID);

        config.app_id = "   ".into();
        assert_eq!(config.resolved_app_id(), DEFAULT_APP_ID);

        config.app_id = " 42 ".into();
        assert_eq!(config.resolved_app_id(), "42", "an override wins and is trimmed");
    }

    #[test]
    fn art_key_is_case_and_space_insensitive() {
        assert_eq!(art_key(" EzCodyLee ", "STUNT 4 LIFE"), art_key("ezcodylee", "stunt 4 life"));
    }
}
