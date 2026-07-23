import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { audioDir, videoDir } from "@tauri-apps/api/path";
import type { TrackMeta } from "./player.svelte";

/** A user-created album (collection with its own cover). No auto-grouping. */
export interface Album {
  id: string;
  name: string;
  artist: string;
  art: string | null;
  trackPaths: string[];
}

export interface Playlist {
  id: string;
  name: string;
  trackPaths: string[];
}

export type PinKind = "album" | "playlist" | "song";

export interface LibraryPin {
  kind: PinKind;
  target: string;
  pinnedAt: number;
}

/** Per-file metadata edits stored locally — never written to the file itself. */
interface Override {
  title?: string;
  artist?: string;
  album?: string;
  art?: string | null;
}

const IMG_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

/**
 * The persistent media library. Only folder paths, playlists, albums, overrides
 * and artist images are written to disk; raw tracks are re-scanned on launch so
 * the store file stays small.
 */
class Library {
  folders = $state<string[]>([]);
  playlists = $state<Playlist[]>([]);
  albums = $state<Album[]>([]);
  pins = $state<LibraryPin[]>([]);
  overrides = $state<Record<string, Override>>({});
  artistImages = $state<Record<string, string>>({});
  scanning = $state(false);
  lastPlaylistId = $state<string | null>(null);

  private rawTracks = $state<TrackMeta[]>([]);
  private rawVideos = $state<TrackMeta[]>([]);
  private loaded = false;

  // --- Effective (override + cover-inheritance) resolution -----------------

  /** path -> albums that contain it, for cover inheritance. */
  private get albumsByPath(): Map<string, Album[]> {
    const m = new Map<string, Album[]>();
    for (const a of this.albums) {
      for (const p of a.trackPaths) {
        const list = m.get(p);
        if (list) list.push(a);
        else m.set(p, [a]);
      }
    }
    return m;
  }

  private effective(raw: TrackMeta): TrackMeta {
    const ov = this.overrides[raw.path] ?? {};
    const artist = ov.artist ?? raw.artist;

    // Cover inheritance: a song in an album wears that album's cover; otherwise
    // it uses its own (override or embedded) art, falling back to artist image.
    let art: string | null;
    const inAlbum = this.albumsByPath.get(raw.path)?.find((a) => a.art);
    if (inAlbum) {
      art = inAlbum.art;
    } else {
      art =
        ov.art !== undefined
          ? ov.art
          : (raw.art ?? this.artistImages[artist] ?? null);
    }

    return {
      ...raw,
      title: ov.title ?? raw.title,
      artist,
      album: ov.album ?? raw.album,
      art,
    };
  }

  get tracks(): TrackMeta[] {
    return this.rawTracks
      .map((t) => this.effective(t))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  get videos(): TrackMeta[] {
    return this.rawVideos.map((t) => this.effective(t));
  }

  /** Newest-added songs (approximated by reverse scan order). */
  get recentSongs(): TrackMeta[] {
    return this.rawTracks
      .slice()
      .reverse()
      .slice(0, 18)
      .map((t) => this.effective(t));
  }

  private effByPath(path: string): TrackMeta | undefined {
    const raw = this.rawTracks.find((t) => t.path === path);
    return raw ? this.effective(raw) : undefined;
  }

  albumTracks(id: string): TrackMeta[] {
    const a = this.albums.find((x) => x.id === id);
    if (!a) return [];
    return a.trackPaths
      .map((p) => this.effByPath(p))
      .filter((t): t is TrackMeta => !!t);
  }

  playlistTracks(id: string): TrackMeta[] {
    const pl = this.playlists.find((p) => p.id === id);
    if (!pl) return [];
    return pl.trackPaths
      .map((p) => this.effByPath(p))
      .filter((t): t is TrackMeta => !!t);
  }

  albumById(id: string): Album | undefined {
    return this.albums.find((a) => a.id === id);
  }

  playlistById(id: string): Playlist | undefined {
    return this.playlists.find((p) => p.id === id);
  }

  trackByPath(path: string): TrackMeta | undefined {
    return this.effByPath(path);
  }

  isPinned(kind: PinKind, target: string): boolean {
    return this.pins.some((pin) => pin.kind === kind && pin.target === target);
  }

  async togglePin(kind: PinKind, target: string) {
    if (this.isPinned(kind, target)) {
      this.pins = this.pins.filter(
        (pin) => !(pin.kind === kind && pin.target === target),
      );
    } else {
      this.pins = [...this.pins, { kind, target, pinnedAt: Date.now() }];
    }
    await this.save("pins", this.pins);
  }

  // --- Persistence + scanning ----------------------------------------------

  async load() {
    if (this.loaded) return;
    this.loaded = true;

    const [folders, playlists, albums, overrides, artistImages, pins] = await Promise.all([
      invoke<string[] | null>("load_data", { key: "folders" }),
      invoke<Playlist[] | null>("load_data", { key: "playlists" }),
      invoke<Album[] | null>("load_data", { key: "albums" }),
      invoke<Record<string, Override> | null>("load_data", { key: "overrides" }),
      invoke<Record<string, string> | null>("load_data", { key: "artistImages" }),
      invoke<LibraryPin[] | null>("load_data", { key: "pins" }),
    ]);
    this.playlists = playlists ?? [];
    this.albums = albums ?? [];
    this.overrides = overrides ?? {};
    this.artistImages = artistImages ?? {};
    this.pins = pins ?? [];

    if (this.playlists.length > 0) {
      this.lastPlaylistId = this.playlists[0].id;
    }

    if (folders && folders.length) {
      this.folders = folders;
    } else {
      const defaults: string[] = [];
      try {
        defaults.push(await audioDir());
      } catch {
        /* ignore */
      }
      try {
        defaults.push(await videoDir());
      } catch {
        /* ignore */
      }
      this.folders = defaults;
      await this.save("folders", this.folders);
    }

    if (this.folders.length) await this.rescan();
  }

  private async save(key: string, value: unknown) {
    await invoke("save_data", { key, value });
  }

  async addFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    if (!this.folders.includes(dir)) {
      this.folders = [...this.folders, dir];
      await this.save("folders", this.folders);
    }
    await this.rescan();
  }

  async removeFolder(path: string) {
    this.folders = this.folders.filter((f) => f !== path);
    await this.save("folders", this.folders);
    await this.rescan({ retainExisting: false });
  }

  async rescan({ retainExisting = true }: { retainExisting?: boolean } = {}) {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const all: TrackMeta[] = [];
      for (const folder of this.folders) {
        const found = await invoke<TrackMeta[]>("scan_folder", { path: folder });
        all.push(...found);
      }
      const seen = new Set<string>();
      const unique = all.filter((t) => {
        if (seen.has(t.path)) return false;
        seen.add(t.path);
        return true;
      });
      const scannedTracks = unique.filter((t) => t.kind === "audio");
      const scannedVideos = unique.filter((t) => t.kind === "video");
      this.rawTracks = retainExisting
        ? mergeByPath(this.rawTracks, scannedTracks)
        : scannedTracks;
      this.rawVideos = retainExisting
        ? mergeByPath(this.rawVideos, scannedVideos)
        : scannedVideos;
    } finally {
      this.scanning = false;
    }
  }

  // --- Images ---------------------------------------------------------------

  /** Prompt for an image file and return it as a data URI. */
  async pickImage(): Promise<string | null> {
    const f = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: IMG_EXTS }],
    });
    if (!f || Array.isArray(f)) return null;
    return await invoke<string>("image_to_data_uri", { path: f });
  }

  // --- Overrides (edit without touching the file) --------------------------

  async setOverride(path: string, patch: Override) {
    this.overrides = { ...this.overrides, [path]: { ...this.overrides[path], ...patch } };
    await this.save("overrides", this.overrides);
  }

  async clearOverride(path: string) {
    const next = { ...this.overrides };
    delete next[path];
    this.overrides = next;
    await this.save("overrides", this.overrides);
  }

  async setArtistImage(name: string, dataUri: string) {
    this.artistImages = { ...this.artistImages, [name]: dataUri };
    await this.save("artistImages", this.artistImages);
  }

  // --- Playlists ------------------------------------------------------------

  async createPlaylist(name: string): Promise<Playlist> {
    const pl: Playlist = { id: crypto.randomUUID(), name: name.trim() || "New Playlist", trackPaths: [] };
    this.playlists = [...this.playlists, pl];
    this.lastPlaylistId = pl.id;
    await this.save("playlists", this.playlists);
    return pl;
  }
  async renamePlaylist(id: string, name: string) {
    this.playlists = this.playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
    await this.save("playlists", this.playlists);
  }
  async deletePlaylist(id: string) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    this.pins = this.pins.filter(
      (pin) => !(pin.kind === "playlist" && pin.target === id),
    );
    await Promise.all([
      this.save("playlists", this.playlists),
      this.save("pins", this.pins),
    ]);
  }
  async addToPlaylist(id: string, paths: string[]) {
    this.lastPlaylistId = id;
    this.playlists = this.playlists.map((p) => {
      if (p.id !== id) return p;
      const merged = [...p.trackPaths];
      for (const path of paths) if (!merged.includes(path)) merged.push(path);
      return { ...p, trackPaths: merged };
    });
    await this.save("playlists", this.playlists);
  }
  async removeFromPlaylist(id: string, path: string) {
    this.playlists = this.playlists.map((p) =>
      p.id === id ? { ...p, trackPaths: p.trackPaths.filter((x) => x !== path) } : p,
    );
    await this.save("playlists", this.playlists);
  }
  async reorderPlaylist(id: string, from: number, to: number) {
    this.playlists = this.playlists.map((p) =>
      p.id === id ? { ...p, trackPaths: moveItem(p.trackPaths, from, to) } : p,
    );
    await this.save("playlists", this.playlists);
  }

  // --- Albums (manual) ------------------------------------------------------

  async createAlbum(name: string): Promise<Album> {
    const a: Album = { id: crypto.randomUUID(), name: name.trim() || "New Album", artist: "", art: null, trackPaths: [] };
    this.albums = [...this.albums, a];
    await this.save("albums", this.albums);
    return a;
  }
  async renameAlbum(id: string, name: string) {
    this.albums = this.albums.map((a) => (a.id === id ? { ...a, name: name.trim() || a.name } : a));
    await this.save("albums", this.albums);
  }
  async setAlbumArtist(id: string, artist: string) {
    this.albums = this.albums.map((a) => (a.id === id ? { ...a, artist } : a));
    await this.save("albums", this.albums);
  }
  async setAlbumCover(id: string, art: string | null) {
    this.albums = this.albums.map((a) => (a.id === id ? { ...a, art } : a));
    await this.save("albums", this.albums);
  }
  async deleteAlbum(id: string) {
    this.albums = this.albums.filter((a) => a.id !== id);
    this.pins = this.pins.filter(
      (pin) => !(pin.kind === "album" && pin.target === id),
    );
    await Promise.all([
      this.save("albums", this.albums),
      this.save("pins", this.pins),
    ]);
  }
  async addToAlbum(id: string, paths: string[]) {
    this.albums = this.albums.map((a) => {
      if (a.id !== id) return a;
      const merged = [...a.trackPaths];
      for (const path of paths) if (!merged.includes(path)) merged.push(path);
      return { ...a, trackPaths: merged };
    });
    await this.save("albums", this.albums);
  }
  async removeFromAlbum(id: string, path: string) {
    this.albums = this.albums.map((a) =>
      a.id === id ? { ...a, trackPaths: a.trackPaths.filter((x) => x !== path) } : a,
    );
    await this.save("albums", this.albums);
  }
  async reorderAlbum(id: string, from: number, to: number) {
    this.albums = this.albums.map((a) =>
      a.id === id ? { ...a, trackPaths: moveItem(a.trackPaths, from, to) } : a,
    );
    await this.save("albums", this.albums);
  }
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function mergeByPath(existing: TrackMeta[], scanned: TrackMeta[]): TrackMeta[] {
  const merged = new Map(existing.map((track) => [track.path.toLowerCase(), track]));
  for (const track of scanned) merged.set(track.path.toLowerCase(), track);
  return [...merged.values()];
}

export const library = new Library();
