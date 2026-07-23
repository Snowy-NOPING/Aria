//! Tag/metadata reading via lofty. Used to build the LRCLIB + Last.fm queries
//! (title/artist/album/duration are the disambiguating fields) and to populate
//! the player UI. Album art is returned as a data URI so the frontend can show
//! it without a second round-trip.

use base64::Engine as _;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;
use serde::Serialize;

pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "oga", "m4a", "aac", "opus", "aiff", "aif",
];
pub const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mkv", "webm", "mov", "avi"];

#[derive(Clone, Serialize, Default)]
pub struct TrackMeta {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_number: Option<u32>,
    /// Duration in seconds.
    pub duration: f64,
    /// Album art as a `data:` URI, if present.
    pub art: Option<String>,
    /// "audio" or "video".
    pub kind: String,
}

fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

fn kind_of(path: &str) -> String {
    if VIDEO_EXTS.contains(&ext_of(path).as_str()) {
        "video".to_string()
    } else {
        "audio".to_string()
    }
}

pub fn read(path: &str) -> Result<TrackMeta, String> {
    let kind = kind_of(path);

    // Many container formats (mkv/webm/avi and some mp4s) can't be probed by
    // lofty; rather than failing the whole scan, fall back to a filename-only
    // entry. The <video>/<audio> element will supply the real duration on load.
    let tagged = match Probe::open(path).and_then(|p| p.read()) {
        Ok(t) => t,
        Err(_) => {
            return Ok(TrackMeta {
                path: path.to_string(),
                title: file_stem(path),
                kind,
                ..Default::default()
            });
        }
    };

    let duration = tagged.properties().duration().as_secs_f64();

    let mut meta = TrackMeta {
        path: path.to_string(),
        duration,
        kind,
        // Fall back to the file stem for the title if there are no tags at all.
        title: file_stem(path),
        ..Default::default()
    };

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        if let Some(t) = tag.title() {
            meta.title = t.to_string();
        }
        if let Some(a) = tag.artist() {
            meta.artist = a.to_string();
        }
        if let Some(a) = tag.album() {
            meta.album = a.to_string();
        }
        meta.track_number = tag.track();
        meta.album_artist = tag
            .get_string(ItemKey::AlbumArtist)
            .unwrap_or_default()
            .to_string();

        if let Some(pic) = tag.pictures().first() {
            let mime = pic
                .mime_type()
                .map(|m| m.as_str())
                .unwrap_or("image/jpeg");
            let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
            meta.art = Some(format!("data:{mime};base64,{b64}"));
        }
    }

    Ok(meta)
}

/// Write title/artist/album back to the file's primary tag, creating a tag of
/// the format-appropriate type if the file has none. Returns the re-read
/// metadata so the UI can refresh from the source of truth.
pub fn write(path: &str, title: &str, artist: &str, album: &str) -> Result<TrackMeta, String> {
    let mut tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    // Pick (or create) the tag type native to this file format.
    if tagged.primary_tag_mut().is_none() {
        let tag_type = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "no writable tag available for this format".to_string())?;

    tag.set_title(title.to_string());
    tag.set_artist(artist.to_string());
    tag.set_album(album.to_string());

    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| e.to_string())?;

    read(path)
}

fn file_stem(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string()
}
