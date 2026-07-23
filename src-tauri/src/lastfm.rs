//! Last.fm desktop authentication, now-playing updates, scrobbling, and the
//! durable offline queue. API signing and the application secret stay in Rust;
//! the frontend only receives connection state and submits track metadata.

use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const API_URL: &str = "https://ws.audioscrobbler.com/2.0/";

#[derive(Clone, Deserialize)]
pub struct TrackPayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_number: Option<u32>,
    pub duration: f64,
}

#[derive(Clone, Serialize, Deserialize)]
struct QueuedScrobble {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    track_number: Option<u32>,
    duration: f64,
    timestamp: i64,
}

impl QueuedScrobble {
    fn new(track: TrackPayload, timestamp: i64) -> Self {
        Self {
            title: track.title,
            artist: track.artist,
            album: track.album,
            album_artist: track.album_artist,
            track_number: track.track_number,
            duration: track.duration,
            timestamp,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    api_key: String,
    api_secret: String,
    session_key: String,
    username: String,
    pending_token: String,
    scrobbling_enabled: bool,
    now_playing_enabled: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            api_secret: String::new(),
            session_key: String::new(),
            username: String::new(),
            pending_token: String::new(),
            scrobbling_enabled: true,
            now_playing_enabled: true,
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Store {
    config: Config,
    queue: Vec<QueuedScrobble>,
    last_error: Option<String>,
}

#[derive(Serialize)]
pub struct LastFmView {
    api_key: String,
    has_secret: bool,
    connected: bool,
    username: String,
    awaiting_approval: bool,
    scrobbling_enabled: bool,
    now_playing_enabled: bool,
    pending_scrobbles: usize,
    last_error: Option<String>,
}

impl Store {
    fn view(&self) -> LastFmView {
        LastFmView {
            api_key: self.config.api_key.clone(),
            has_secret: !self.config.api_secret.is_empty(),
            connected: !self.config.session_key.is_empty(),
            username: self.config.username.clone(),
            awaiting_approval: !self.config.pending_token.is_empty(),
            scrobbling_enabled: self.config.scrobbling_enabled,
            now_playing_enabled: self.config.now_playing_enabled,
            pending_scrobbles: self.queue.len(),
            last_error: self.last_error.clone(),
        }
    }
}

pub struct LastFm {
    client: reqwest::Client,
    store: Mutex<Store>,
    flush_lock: tokio::sync::Mutex<()>,
}

impl LastFm {
    pub fn new(app: &AppHandle) -> Self {
        let store = load_store(app).unwrap_or_default();
        let client = reqwest::Client::builder()
            .user_agent("Aria/0.1 (Windows desktop media player)")
            .build()
            .unwrap_or_default();
        Self {
            client,
            store: Mutex::new(store),
            flush_lock: tokio::sync::Mutex::new(()),
        }
    }

    fn view(&self) -> LastFmView {
        self.store.lock().unwrap().view()
    }

    fn set_api_error(&self, app: &AppHandle, error: &ApiError) {
        let mut store = self.store.lock().unwrap();
        store.last_error = Some(error.to_string());
        if error.code == Some(9) {
            store.config.session_key.clear();
            store.config.username.clear();
        }
        let _ = save_store(app, &store);
    }

    async fn post(
        &self,
        mut params: BTreeMap<String, String>,
        secret: &str,
    ) -> Result<serde_json::Value, ApiError> {
        let signature = sign(&params, secret);
        params.insert("api_sig".into(), signature);
        // Last.fm explicitly excludes `format` from the signature.
        params.insert("format".into(), "json".into());

        let response = self
            .client
            .post(API_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| ApiError::network(e.to_string()))?;
        let status = response.status();
        let value = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| ApiError::network(format!("invalid Last.fm response: {e}")))?;

        if let Some(code) = value.get("error").and_then(|v| v.as_i64()) {
            let message = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Last.fm rejected the request");
            return Err(ApiError {
                code: Some(code),
                message: message.to_string(),
            });
        }
        if !status.is_success() {
            return Err(ApiError::network(format!(
                "Last.fm returned HTTP {}",
                status.as_u16()
            )));
        }
        Ok(value)
    }

    async fn flush(&self, app: &AppHandle) -> Result<usize, ApiError> {
        let _flush_guard = self.flush_lock.lock().await;
        let mut flushed = 0;

        loop {
            let (config, batch) = {
                let store = self.store.lock().unwrap();
                if !store.config.scrobbling_enabled || store.config.session_key.is_empty() {
                    return Ok(flushed);
                }
                (
                    store.config.clone(),
                    store.queue.iter().take(50).cloned().collect::<Vec<_>>(),
                )
            };
            if batch.is_empty() {
                return Ok(flushed);
            }

            let mut params = authenticated_params("track.scrobble", &config);
            for (index, item) in batch.iter().enumerate() {
                params.insert(format!("artist[{index}]"), item.artist.clone());
                params.insert(format!("track[{index}]"), item.title.clone());
                params.insert(format!("timestamp[{index}]"), item.timestamp.to_string());
                params.insert(format!("chosenByUser[{index}]"), "1".into());
                if !item.album.is_empty() {
                    params.insert(format!("album[{index}]"), item.album.clone());
                }
                if !item.album_artist.is_empty() {
                    params.insert(format!("albumArtist[{index}]"), item.album_artist.clone());
                }
                if let Some(number) = item.track_number {
                    params.insert(format!("trackNumber[{index}]"), number.to_string());
                }
                if item.duration > 0.0 {
                    params.insert(
                        format!("duration[{index}]"),
                        item.duration.round().to_string(),
                    );
                }
            }

            match self.post(params, &config.api_secret).await {
                Ok(_) => {
                    let mut store = self.store.lock().unwrap();
                    let count = batch.len().min(store.queue.len());
                    store.queue.drain(0..count);
                    store.last_error = None;
                    flushed += count;
                    save_store(app, &store).map_err(ApiError::network)?;
                }
                Err(error) => {
                    self.set_api_error(app, &error);
                    return Err(error);
                }
            }
        }
    }
}

#[derive(Debug)]
struct ApiError {
    code: Option<i64>,
    message: String,
}

impl ApiError {
    fn network(message: String) -> Self {
        Self {
            code: None,
            message,
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code {
            Some(code) => write!(f, "Last.fm error {code}: {}", self.message),
            None => write!(f, "{}", self.message),
        }
    }
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("lastfm.json"))
}

fn load_store(app: &AppHandle) -> Option<Store> {
    let text = std::fs::read_to_string(store_path(app).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_store(app: &AppHandle, store: &Store) -> Result<(), String> {
    let path = store_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(store).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn sign(params: &BTreeMap<String, String>, secret: &str) -> String {
    let mut source = String::new();
    for (name, value) in params {
        source.push_str(name);
        source.push_str(value);
    }
    source.push_str(secret);
    format!("{:x}", md5::compute(source.as_bytes()))
}

fn authenticated_params(method: &str, config: &Config) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("api_key".into(), config.api_key.clone()),
        ("method".into(), method.into()),
        ("sk".into(), config.session_key.clone()),
    ])
}

fn add_track_params(params: &mut BTreeMap<String, String>, track: &TrackPayload) {
    params.insert("artist".into(), track.artist.clone());
    params.insert("track".into(), track.title.clone());
    if !track.album.is_empty() {
        params.insert("album".into(), track.album.clone());
    }
    if !track.album_artist.is_empty() {
        params.insert("albumArtist".into(), track.album_artist.clone());
    }
    if let Some(number) = track.track_number {
        params.insert("trackNumber".into(), number.to_string());
    }
    if track.duration > 0.0 {
        params.insert("duration".into(), track.duration.round().to_string());
    }
}

#[tauri::command]
pub fn lastfm_get_state(state: State<LastFm>) -> LastFmView {
    state.view()
}

#[tauri::command]
pub fn lastfm_save_settings(
    app: AppHandle,
    state: State<LastFm>,
    api_key: String,
    api_secret: String,
    scrobbling_enabled: bool,
    now_playing_enabled: bool,
) -> Result<LastFmView, String> {
    let mut store = state.store.lock().unwrap();
    let key = api_key.trim().to_string();
    let secret = api_secret.trim().to_string();
    let key_changed = key != store.config.api_key;
    if key_changed {
        store.config.session_key.clear();
        store.config.username.clear();
        store.config.pending_token.clear();
    }
    store.config.api_key = key;
    if !secret.is_empty() {
        store.config.api_secret = secret;
    } else if key_changed {
        store.config.api_secret.clear();
    }
    store.config.scrobbling_enabled = scrobbling_enabled;
    store.config.now_playing_enabled = now_playing_enabled;
    store.last_error = None;
    save_store(&app, &store)?;
    Ok(store.view())
}

#[tauri::command]
pub async fn lastfm_begin_auth(app: AppHandle, state: State<'_, LastFm>) -> Result<String, String> {
    let config = state.store.lock().unwrap().config.clone();
    if config.api_key.is_empty() || config.api_secret.is_empty() {
        return Err("Enter and save a Last.fm API key and shared secret first.".into());
    }

    let params = BTreeMap::from([
        ("api_key".into(), config.api_key.clone()),
        ("method".into(), "auth.getToken".into()),
    ]);
    let value = state
        .post(params, &config.api_secret)
        .await
        .map_err(|e| e.to_string())?;
    let token = value
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Last.fm did not return an authorization token.".to_string())?
        .to_string();

    {
        let mut store = state.store.lock().unwrap();
        store.config.pending_token = token.clone();
        store.last_error = None;
        save_store(&app, &store)?;
    }

    let mut url =
        reqwest::Url::parse("https://www.last.fm/api/auth/").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("api_key", &config.api_key)
        .append_pair("token", &token);
    Ok(url.to_string())
}

#[tauri::command]
pub async fn lastfm_finish_auth(
    app: AppHandle,
    state: State<'_, LastFm>,
) -> Result<LastFmView, String> {
    let config = state.store.lock().unwrap().config.clone();
    if config.pending_token.is_empty() {
        return Err("Start Last.fm authorization first.".into());
    }

    let params = BTreeMap::from([
        ("api_key".into(), config.api_key.clone()),
        ("method".into(), "auth.getSession".into()),
        ("token".into(), config.pending_token.clone()),
    ]);
    let value = state
        .post(params, &config.api_secret)
        .await
        .map_err(|e| e.to_string())?;
    let session = value
        .get("session")
        .ok_or_else(|| "Last.fm did not return a session.".to_string())?;
    let key = session
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Last.fm did not return a session key.".to_string())?;
    let username = session.get("name").and_then(|v| v.as_str()).unwrap_or("");

    let mut store = state.store.lock().unwrap();
    store.config.session_key = key.to_string();
    store.config.username = username.to_string();
    store.config.pending_token.clear();
    store.last_error = None;
    save_store(&app, &store)?;
    Ok(store.view())
}

#[tauri::command]
pub fn lastfm_disconnect(app: AppHandle, state: State<LastFm>) -> Result<LastFmView, String> {
    let mut store = state.store.lock().unwrap();
    store.config.session_key.clear();
    store.config.username.clear();
    store.config.pending_token.clear();
    store.last_error = None;
    save_store(&app, &store)?;
    Ok(store.view())
}

#[tauri::command]
pub async fn lastfm_now_playing(
    app: AppHandle,
    state: State<'_, LastFm>,
    track: TrackPayload,
) -> Result<LastFmView, String> {
    let config = state.store.lock().unwrap().config.clone();
    if !config.now_playing_enabled || config.session_key.is_empty() {
        return Ok(state.view());
    }

    let mut params = authenticated_params("track.updateNowPlaying", &config);
    add_track_params(&mut params, &track);
    match state.post(params, &config.api_secret).await {
        Ok(_) => {
            let mut store = state.store.lock().unwrap();
            store.last_error = None;
            let _ = save_store(&app, &store);
        }
        Err(error) => state.set_api_error(&app, &error),
    }
    Ok(state.view())
}

#[tauri::command]
pub async fn lastfm_queue_scrobble(
    app: AppHandle,
    state: State<'_, LastFm>,
    track: TrackPayload,
    timestamp: i64,
) -> Result<LastFmView, String> {
    {
        let mut store = state.store.lock().unwrap();
        if !store.config.scrobbling_enabled || store.config.session_key.is_empty() {
            return Ok(store.view());
        }
        store
            .queue
            .push(QueuedScrobble::new(track, timestamp.max(0)));
        store.last_error = None;
        let _ = save_store(&app, &store);
    }
    let _ = state.flush(&app).await;
    Ok(state.view())
}

#[tauri::command]
pub async fn lastfm_flush_queue(
    app: AppHandle,
    state: State<'_, LastFm>,
) -> Result<LastFmView, String> {
    let _ = state.flush(&app).await;
    Ok(state.view())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_uses_sorted_name_value_pairs() {
        let params = BTreeMap::from([
            ("token".into(), "token-value".into()),
            ("api_key".into(), "key-value".into()),
            ("method".into(), "auth.getSession".into()),
        ]);
        let direct = format!(
            "{:x}",
            md5::compute(b"api_keykey-valuemethodauth.getSessiontokentoken-valuesecret")
        );
        assert_eq!(sign(&params, "secret"), direct);
    }
}
