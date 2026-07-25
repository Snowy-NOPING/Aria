mod audio;
mod lastfm;
mod lyrics;
mod media;
mod metadata;

use std::path::PathBuf;

use audio::{Cmd, Engine, Status};
use base64::Engine as _;
use metadata::TrackMeta;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

/// Read tag metadata for a single file.
#[tauri::command]
fn read_metadata(path: String) -> Result<TrackMeta, String> {
    metadata::read(&path)
}

/// Read metadata for many files at once (used when opening a folder / building
/// a queue). Files that fail to parse are skipped rather than failing the batch.
#[tauri::command]
fn read_metadata_batch(paths: Vec<String>) -> Vec<TrackMeta> {
    paths
        .iter()
        .filter_map(|p| metadata::read(p).ok())
        .collect()
}

/// Edit the title/artist/album tags of a file and return the refreshed metadata.
#[tauri::command]
fn write_metadata(
    path: String,
    title: String,
    artist: String,
    album: String,
) -> Result<TrackMeta, String> {
    metadata::write(&path, &title, &artist, &album)
}

/// Recursively scan a folder for audio + video files and read their metadata.
/// Runs on Tauri's async command threadpool so it never blocks the UI/audio.
#[tauri::command]
async fn scan_folder(path: String) -> Vec<TrackMeta> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            if metadata::AUDIO_EXTS.contains(&ext.as_str())
                || metadata::VIDEO_EXTS.contains(&ext.as_str())
            {
                if let Ok(m) = metadata::read(&p.to_string_lossy()) {
                    out.push(m);
                }
            }
        }
        out
    })
    .await
    .unwrap_or_default()
}

/// Read a UTF-8 text file (used for importing .lrc/.vtt/.srt lyrics).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct SidecarLyrics {
    text: String,
    extension: String,
}

/// Find a lyrics file beside an audio file. Exact-basename sidecars are
/// preferred, with "<name> (lyrics)" supported for common download names.
#[tauri::command]
fn read_sidecar_lyrics(path: String) -> Option<SidecarLyrics> {
    let media_path = std::path::Path::new(&path);
    let parent = media_path.parent()?;
    let stem = media_path.file_stem()?.to_str()?;

    for extension in ["lrc", "vtt", "srt", "txt"] {
        let candidates = [
            media_path.with_extension(extension),
            parent.join(format!("{stem} (lyrics).{extension}")),
        ];
        for candidate in candidates {
            if let Ok(text) = std::fs::read_to_string(&candidate) {
                return Some(SidecarLyrics {
                    text,
                    extension: extension.to_string(),
                });
            }
        }
    }
    None
}

/// Read an image file and return it as a `data:` URI, for custom album / song /
/// artist covers. Kept small by the fact that covers are few.
#[tauri::command]
fn image_to_data_uri(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "image/jpeg",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Apply (or clear) a native Windows DWM backdrop on the main window.
///
/// `mica` / `mica-alt` (tabbed) / `acrylic` / `blur` ask DWM to composite the
/// desktop behind our transparent webview. `none` paints our own opaque base,
/// and `external` clears every native effect so a third-party compositor —
/// Mica For Everyone — owns the backdrop instead of us fighting it.
#[tauri::command]
fn set_backdrop(window: tauri::WebviewWindow, kind: String) -> Result<(), String> {
    use tauri::window::{Effect, EffectsBuilder};

    let effect = match kind.as_str() {
        "mica" => Some(Effect::Mica),
        "mica-light" => Some(Effect::MicaLight),
        "mica-dark" => Some(Effect::MicaDark),
        "mica-alt" | "tabbed" => Some(Effect::Tabbed),
        "acrylic" => Some(Effect::Acrylic),
        "blur" => Some(Effect::Blur),
        "none" | "external" => None,
        other => return Err(format!("unknown backdrop: {other}")),
    };

    let config = effect.map(|e| EffectsBuilder::new().effect(e).build());
    window.set_effects(config).map_err(|e| e.to_string())
}

/// Update the OS "now playing" metadata (SMTC).
#[tauri::command]
fn smtc_metadata(app: AppHandle, title: String, artist: String, album: String, duration: f64) {
    media::set_metadata(&app, title, artist, album, duration);
}

/// Update the OS playback state + position (SMTC).
#[tauri::command]
fn smtc_playback(app: AppHandle, playing: bool, position: f64) {
    media::set_playback(&app, playing, position);
}

/// Fetch lyrics for a track from LRCLIB (off-thread). Caching is done frontend.
#[tauri::command]
async fn fetch_lyrics(
    title: String,
    artist: String,
    album: String,
    duration: f64,
) -> lyrics::LyricsResult {
    lyrics::fetch(title, artist, album, duration).await
}

fn store_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{key}.json")))
}

/// Load a persisted JSON blob (folders list, playlists) by key; None if absent.
#[tauri::command]
fn load_data(app: AppHandle, key: String) -> Option<serde_json::Value> {
    let path = store_path(&app, &key).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Persist a JSON blob by key to the app data directory.
#[tauri::command]
fn save_data(app: AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{key}.json")), text).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_track(path: String, duration: f64, engine: State<Engine>) {
    engine.send(Cmd::Load {
        path: PathBuf::from(path),
        duration,
    });
}

#[tauri::command]
fn play(engine: State<Engine>) {
    engine.send(Cmd::Play);
}

#[tauri::command]
fn pause(engine: State<Engine>) {
    engine.send(Cmd::Pause);
}

#[tauri::command]
fn seek(position: f64, engine: State<Engine>) {
    engine.send(Cmd::Seek(position));
}

#[tauri::command]
fn set_volume(volume: f32, engine: State<Engine>) {
    engine.send(Cmd::SetVolume(volume));
}

#[tauri::command]
fn stop(engine: State<Engine>) {
    engine.send(Cmd::Stop);
}

/// Pull the current status synchronously (the frontend mostly relies on the
/// pushed `player://status` event, but this is handy on startup).
#[tauri::command]
fn get_status(engine: State<Engine>) -> Status {
    engine.status.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Swallow rodio's known "Seek errors should not occur during initialization"
    // panic message (we catch the panic and fall back), keeping the console clean.
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("");
        if msg.contains("Seek errors should not occur") {
            return;
        }
        prev_hook(info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let engine = Engine::new(app.handle().clone());
            app.manage(engine);
            app.manage(media::Smtc::new());
            app.manage(lastfm::LastFm::new(app.handle()));
            media::init(app.handle());

            // The window stays `transparent` (see tauri.conf.json). We don't
            // force a backdrop at startup — the frontend restores the user's
            // saved choice (`set_backdrop`) once it boots, and the "external"
            // choice deliberately applies nothing so a third-party compositor
            // (Mica For Everyone) owns the backdrop instead of us fighting it.
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_metadata,
            read_metadata_batch,
            write_metadata,
            read_text_file,
            read_sidecar_lyrics,
            image_to_data_uri,
            scan_folder,
            fetch_lyrics,
            set_backdrop,
            smtc_metadata,
            smtc_playback,
            load_data,
            save_data,
            load_track,
            play,
            pause,
            seek,
            set_volume,
            stop,
            get_status,
            lastfm::lastfm_get_state,
            lastfm::lastfm_save_settings,
            lastfm::lastfm_begin_auth,
            lastfm::lastfm_finish_auth,
            lastfm::lastfm_disconnect,
            lastfm::lastfm_now_playing,
            lastfm::lastfm_queue_scrobble,
            lastfm::lastfm_flush_queue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
