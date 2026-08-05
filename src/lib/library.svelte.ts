import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { audioDir, videoDir } from "@tauri-apps/api/path";
import type { TrackMeta } from "./player.svelte";
import { lyrics } from "./lyrics.svelte";
import { credits, artistNames, splitCredits, type Credit } from "./artists";

/** A user-created album, backed by its own folder on disk. */
export interface Album {
  id: string;
  name: string;
  artist: string;
  art: string | null;
  trackPaths: string[];
  /** Folder on disk holding this album's files. Albums made before this
   *  existed have none, and keep working as pure collections. */
  folder?: string;
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

/** Marks an album id as derived from a folder rather than curated by hand. The
 *  rest of the id is the folder path, so these ids survive a rescan. */
const FOLDER_ALBUM_PREFIX = "folder:";

/** Both separators are handled: scan results carry native Windows paths, but
 *  imported/user-entered ones can arrive with forward slashes. */
function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

function baseName(dir: string): string {
  const i = Math.max(dir.lastIndexOf("\\"), dir.lastIndexOf("/"));
  return i >= 0 ? dir.slice(i + 1) : dir;
}

/** For comparing two paths that mean the same folder. Windows is case-blind and
 *  doesn't care which slash you use, and a trailing one carries no meaning. */
function samePath(a: string): string {
  return a.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** Disc order where tags provide it, alphabetical where they don't. */
function byTrackOrder(a: TrackMeta, b: TrackMeta): number {
  const an = a.track_number ?? Number.MAX_SAFE_INTEGER;
  const bn = b.track_number ?? Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return a.title.localeCompare(b.title);
}

/**
 * Sort by a hand-arranged path list where there is one, disc order where there
 * isn't. Files that appeared since the folder was arranged aren't in the list,
 * so they collect at the end in disc order rather than silently jumping into
 * the middle of an order the user set.
 */
function orderFor(paths: string[] | undefined) {
  if (!paths?.length) return byTrackOrder;
  const rank = new Map(paths.map((p, i) => [p, i]));
  return (a: TrackMeta, b: TrackMeta): number => {
    const ar = rank.get(a.path);
    const br = rank.get(b.path);
    if (ar !== undefined && br !== undefined) return ar - br;
    if (ar !== undefined) return -1;
    if (br !== undefined) return 1;
    return byTrackOrder(a, b);
  };
}

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
  /** Hand-arranged track order for folder albums, keyed by folder path. Only
   *  folders the user has actually reordered appear here; the rest fall back to
   *  disc order. Paths only — a rescan can replace the track objects. */
  folderOrders = $state<Record<string, string[]>>({});
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

  /**
   * Albums derived from the folder each track sits in, so a library organised
   * on disk needs no curation to show up here. Their name, artist and cover are
   * read-only — identity is the folder path, so renaming one would mean lying
   * about what is on disk — but the running order is the player's own view of
   * the folder, so `folderOrders` may override it. Hand-made albums stay fully
   * editable alongside them.
   */
  get folderAlbums(): Album[] {
    // A curated album already owns its folder, so listing that folder again
    // would show the same songs twice under the same name.
    const claimed = new Set(
      this.albums.map((a) => a.folder).filter((f): f is string => !!f),
    );
    // A folder you pointed the library at is a library, not a release: loose
    // files sitting directly in Music are songs, and calling that pile "Music"
    // puts a fake album next to the real ones. Only what's filed in a subfolder
    // counts. (Adding a single album folder as a library root therefore hides
    // it from Albums — remove the root and add its parent instead.)
    const roots = new Set(this.folders.map(samePath));
    const byDir = new Map<string, TrackMeta[]>();
    for (const t of this.tracks) {
      const dir = dirOf(t.path);
      if (claimed.has(dir) || roots.has(samePath(dir))) continue;
      const list = byDir.get(dir);
      if (list) list.push(t);
      else byDir.set(dir, [t]);
    }

    const out: Album[] = [];
    for (const [dir, tracks] of byDir) {
      tracks.sort(orderFor(this.folderOrders[dir]));
      // Only claim an artist when the whole folder agrees on one; a mixed
      // folder showing one arbitrary name reads as a mistake.
      const artists = new Set(tracks.map((t) => t.album_artist || t.artist).filter(Boolean));
      out.push({
        id: FOLDER_ALBUM_PREFIX + dir,
        name: baseName(dir) || dir,
        artist: artists.size === 1 ? [...artists][0] : "",
        art: tracks.find((t) => t.art)?.art ?? null,
        trackPaths: tracks.map((t) => t.path),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Everything the album views show: folders first, then curated albums. */
  get allAlbums(): Album[] {
    return [...this.folderAlbums, ...this.albums];
  }

  /** Folder albums mirror the filesystem, so they can't be renamed or deleted. */
  isFolderAlbum(id: string): boolean {
    return id.startsWith(FOLDER_ALBUM_PREFIX);
  }

  /** The folder a folder-album id points at. */
  private folderOf(id: string): string {
    return id.slice(FOLDER_ALBUM_PREFIX.length);
  }

  /** Whether a folder album has been arranged by hand rather than by tags. */
  hasCustomOrder(id: string): boolean {
    return this.isFolderAlbum(id) && !!this.folderOrders[this.folderOf(id)];
  }

  /** Drop a hand-arranged order and go back to what the tags say. */
  async clearFolderOrder(id: string) {
    if (!this.hasCustomOrder(id)) return;
    const next = { ...this.folderOrders };
    delete next[this.folderOf(id)];
    this.folderOrders = next;
    await this.save("folderOrders", this.folderOrders);
  }

  albumTracks(id: string): TrackMeta[] {
    const a = this.albumById(id);
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

  // --- Artists ---------------------------------------------------------------

  /**
   * Credit strings to treat as one name however many separators they contain.
   * Album-artist tags and curated album artists are written per release rather
   * than per track, so they're where "Tyler, The Creator" and "AC/DC" appear
   * as themselves — enough to keep the credit splitter from halving them.
   */
  atomicArtists = $derived.by<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const t of this.rawTracks) {
      const n = t.album_artist.trim().toLowerCase();
      if (n) set.add(n);
    }
    for (const a of this.albums) {
      const n = a.artist.trim().toLowerCase();
      if (n) set.add(n);
    }
    return set;
  });

  /** Split a credit string for display, respecting the known whole names. */
  artistCredits(artist: string): Credit[] {
    return splitCredits(artist, this.atomicArtists);
  }

  /**
   * Every song this artist is credited on — as the track artist or the album
   * artist, alone or alongside others. Grouped by album so a page of them reads
   * like a discography rather than a shuffled pile.
   */
  artistTracks(name: string): TrackMeta[] {
    return this.tracks
      .filter((t) => this.creditsArtist(t, name))
      .sort((a, b) => a.album.localeCompare(b.album) || byTrackOrder(a, b));
  }

  /** Albums (folder and curated alike) holding at least one of their songs. */
  artistAlbums(name: string): Album[] {
    const known = this.atomicArtists;
    return this.allAlbums.filter(
      (al) =>
        credits(al.artist, name, known) ||
        this.albumTracks(al.id).some((t) => this.creditsArtist(t, name)),
    );
  }

  private creditsArtist(t: TrackMeta, name: string): boolean {
    const known = this.atomicArtists;
    return credits(t.artist, name, known) || credits(t.album_artist, name, known);
  }

  /** A set image if there is one, else borrow the artwork they appear under. */
  artistArt(name: string): string | null {
    const set = this.artistImages[name];
    if (set) return set;
    const albumArt = this.artistAlbums(name).find((al) => al.art)?.art;
    return albumArt ?? this.artistTracks(name).find((t) => t.art)?.art ?? null;
  }

  /** Distinct artists in the library, each credit counted on its own. */
  get artists(): string[] {
    const known = this.atomicArtists;
    const seen = new Map<string, string>();
    for (const t of this.rawTracks) {
      for (const n of [
        ...artistNames(t.artist, known),
        ...artistNames(t.album_artist, known),
      ]) {
        const key = n.toLowerCase();
        if (!seen.has(key)) seen.set(key, n);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  albumById(id: string): Album | undefined {
    if (this.isFolderAlbum(id)) return this.folderAlbums.find((a) => a.id === id);
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

    const [folders, playlists, albums, overrides, artistImages, pins, folderOrders] =
      await Promise.all([
        invoke<string[] | null>("load_data", { key: "folders" }),
        invoke<Playlist[] | null>("load_data", { key: "playlists" }),
        invoke<Album[] | null>("load_data", { key: "albums" }),
        invoke<Record<string, Override> | null>("load_data", { key: "overrides" }),
        invoke<Record<string, string> | null>("load_data", { key: "artistImages" }),
        invoke<LibraryPin[] | null>("load_data", { key: "pins" }),
        invoke<Record<string, string[]> | null>("load_data", { key: "folderOrders" }),
      ]);
    this.playlists = playlists ?? [];
    this.albums = albums ?? [];
    this.overrides = overrides ?? {};
    this.artistImages = artistImages ?? {};
    this.pins = pins ?? [];
    this.folderOrders = folderOrders ?? {};

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

  /**
   * Where new album folders are created: the first configured folder that
   * actually holds audio, so a library listing Videos first still files albums
   * under the music folder.
   */
  get albumRoot(): string | null {
    if (!this.folders.length) return null;
    const audioRoots = new Set(this.rawTracks.map((t) => dirOf(t.path)));
    const hit = this.folders.find((f) => [...audioRoots].some((d) => d.startsWith(f)));
    return hit ?? this.folders[0];
  }

  /**
   * Point every path-keyed store at a track's new location. Tags, covers,
   * playlists, pins and imported lyrics are all keyed by path, so a move that
   * skipped this would silently strip a track of everything but its audio.
   */
  private repathTrack(from: string, to: string) {
    if (from === to) return;
    const swap = (p: string) => (p === from ? to : p);
    this.rawTracks = this.rawTracks.map((t) => (t.path === from ? { ...t, path: to } : t));
    this.rawVideos = this.rawVideos.map((t) => (t.path === from ? { ...t, path: to } : t));
    this.albums = this.albums.map((a) => ({ ...a, trackPaths: a.trackPaths.map(swap) }));
    this.playlists = this.playlists.map((p) => ({ ...p, trackPaths: p.trackPaths.map(swap) }));
    this.pins = this.pins.map((pin) =>
      pin.kind === "song" && pin.target === from ? { ...pin, target: to } : pin,
    );
    // A hand-arranged folder keeps its shape when a file inside it is renamed;
    // a file that left the folder is simply no longer matched by that list.
    this.folderOrders = Object.fromEntries(
      Object.entries(this.folderOrders).map(([dir, paths]) => [dir, paths.map(swap)]),
    );
    if (this.overrides[from]) {
      const next = { ...this.overrides };
      next[to] = next[from];
      delete next[from];
      this.overrides = next;
    }
    // Imported lyrics live in their own store; keep them attached too.
    void lyrics.repath(from, to);
  }

  /** Persist everything `repathTrack` can touch. */
  private async saveAfterMove() {
    await Promise.all([
      this.save("albums", this.albums),
      this.save("playlists", this.playlists),
      this.save("pins", this.pins),
      this.save("overrides", this.overrides),
      this.save("folderOrders", this.folderOrders),
    ]);
  }

  /**
   * Move a track into an album's folder, or back out to the album root.
   * Returns the path it ended up at — unchanged if the move failed, so a
   * permission error leaves the library describing what is really on disk.
   */
  private async relocate(path: string, destDir: string): Promise<string> {
    try {
      const moved = await invoke<string>("move_track", { path, destDir });
      this.repathTrack(path, moved);
      return moved;
    } catch (e) {
      console.error(`could not move ${path} into ${destDir}:`, e);
      return path;
    }
  }

  async createAlbum(name: string): Promise<Album> {
    const clean = name.trim() || "New Album";
    // Give the album a real folder so its songs have somewhere to live.
    let folder: string | undefined;
    const root = this.albumRoot;
    if (root) {
      try {
        folder = await invoke<string>("ensure_album_dir", { root, name: clean });
      } catch (e) {
        console.error("could not create album folder:", e);
      }
    }
    const a: Album = {
      id: crypto.randomUUID(),
      name: clean,
      artist: "",
      art: null,
      trackPaths: [],
      folder,
    };
    this.albums = [...this.albums, a];
    await this.save("albums", this.albums);
    return a;
  }

  async renameAlbum(id: string, name: string) {
    const album = this.albums.find((a) => a.id === id);
    const clean = name.trim();
    if (!album || !clean || clean === album.name) return;

    // Rename the folder first: if it fails (name taken, file locked) the album
    // keeps its old name rather than pointing at a folder that isn't there.
    let folder = album.folder;
    if (folder) {
      try {
        const moved = await invoke<string>("rename_album_dir", { dir: folder, name: clean });
        if (moved !== folder) {
          for (const p of album.trackPaths) {
            this.repathTrack(p, moved + p.slice(folder.length));
          }
          folder = moved;
        }
      } catch (e) {
        console.error("could not rename album folder:", e);
        return;
      }
    }
    this.albums = this.albums.map((a) => (a.id === id ? { ...a, name: clean, folder } : a));
    await this.saveAfterMove();
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
    const album = this.albums.find((a) => a.id === id);
    if (!album) return;

    // File the songs into the album's folder so the library root stays tidy.
    // `relocate` rewrites every path-keyed store, so read the final paths from
    // it rather than assuming the move succeeded.
    const finalPaths: string[] = [];
    for (const path of paths) {
      finalPaths.push(album.folder ? await this.relocate(path, album.folder) : path);
    }

    this.albums = this.albums.map((a) => {
      if (a.id !== id) return a;
      const merged = [...a.trackPaths];
      for (const path of finalPaths) if (!merged.includes(path)) merged.push(path);
      return { ...a, trackPaths: merged };
    });
    await this.saveAfterMove();
  }

  async removeFromAlbum(id: string, path: string) {
    const album = this.albums.find((a) => a.id === id);
    if (!album) return;

    // Send the file back to the library root, so leaving an album undoes the
    // filing rather than stranding the track inside a folder it left.
    let current = path;
    const root = this.albumRoot;
    if (album.folder && root && dirOf(path) === album.folder) {
      current = await this.relocate(path, root);
    }

    this.albums = this.albums.map((a) =>
      a.id === id ? { ...a, trackPaths: a.trackPaths.filter((x) => x !== current) } : a,
    );
    await this.saveAfterMove();
  }
  async reorderAlbum(id: string, from: number, to: number) {
    // A folder album has no stored track list to shuffle, so the whole order
    // is written out — every path, not just the moved one — and from then on
    // that list is what the folder is sorted by.
    if (this.isFolderAlbum(id)) {
      const current = this.albumById(id)?.trackPaths ?? [];
      const next = moveItem(current, from, to);
      if (next === current) return;
      this.folderOrders = { ...this.folderOrders, [this.folderOf(id)]: next };
      await this.save("folderOrders", this.folderOrders);
      return;
    }
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
