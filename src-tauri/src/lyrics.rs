//! LRCLIB lyrics fetching. All network work happens here on Tauri's async
//! runtime, off the UI/audio threads. Parsing + caching live in the frontend.

use serde::Serialize;

#[derive(Serialize, Default)]
pub struct LyricsResult {
    pub found: bool,
    pub instrumental: bool,
    /// Raw LRC (`[mm:ss.xx]` lines) if LRCLIB has synced lyrics.
    pub synced: Option<String>,
    /// Plain unsynced lyrics, if that's all that's available.
    pub plain: Option<String>,
}

fn from_value(v: &serde_json::Value) -> LyricsResult {
    let synced = v
        .get("syncedLyrics")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    let plain = v
        .get("plainLyrics")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    let instrumental = v.get("instrumental").and_then(|x| x.as_bool()).unwrap_or(false);
    LyricsResult {
        found: synced.is_some() || plain.is_some() || instrumental,
        instrumental,
        synced,
        plain,
    }
}

pub async fn fetch(title: String, artist: String, album: String, duration: f64) -> LyricsResult {
    let client = match reqwest::Client::builder()
        .user_agent("Aria/0.1 (local media player; https://github.com/aria)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return LyricsResult::default(),
    };

    // Primary: exact match by track/artist/album/duration (LRCLIB uses duration
    // to disambiguate versions/remixes).
    let dur = duration.round().max(0.0) as i64;
    let get = client
        .get("https://lrclib.net/api/get")
        .query(&[
            ("track_name", title.as_str()),
            ("artist_name", artist.as_str()),
            ("album_name", album.as_str()),
            ("duration", &dur.to_string()),
        ])
        .send()
        .await;
    if let Ok(r) = get {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                let res = from_value(&v);
                if res.found {
                    return res;
                }
            }
        }
    }

    // Fallback: fuzzy search, take the closest-duration candidate.
    let search = client
        .get("https://lrclib.net/api/search")
        .query(&[("track_name", title.as_str()), ("artist_name", artist.as_str())])
        .send()
        .await;
    if let Ok(r) = search {
        if r.status().is_success() {
            if let Ok(arr) = r.json::<Vec<serde_json::Value>>().await {
                let best = arr.iter().min_by_key(|v| {
                    let d = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    (d - duration).abs() as i64
                });
                if let Some(v) = best {
                    return from_value(v);
                }
            }
        }
    }

    LyricsResult::default()
}
