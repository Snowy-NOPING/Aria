#!/usr/bin/env python3
"""One-off: give every existing Aria album a folder and file its songs into it.

Aria gained folder-backed albums after these albums were made, so they have no
`folder` and their songs sit loose in the library root. This does what the app
now does on `addToAlbum`, but retroactively.

Paths are keys in several stores, so moving a file means rewriting all of them
together — albums, playlists, pins, tag/cover overrides and imported lyrics.
Missing any one silently strips a track of everything but its audio.

Lyric sidecars (.lyricsfile.yaml/.lrc/.vtt/.srt/.txt) travel with their audio;
they are moved as opaque files and never opened.

Run with no arguments to preview. Pass --apply to actually move anything.
Close Aria first: it rewrites these JSON files on exit.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

DATA = Path(r"C:\Users\santi\AppData\Roaming\com.santi.media-player")
ROOT = Path(r"C:\Users\santi\Music")

# Kept in sync with SIDECAR_EXTS in src-tauri/src/lib.rs.
SIDECAR_EXTS = ["lyricsfile.yaml", "lrc", "vtt", "srt", "txt"]

# Folders to reuse rather than duplicate at the root: the library already has
# these, some already holding the album's songs.
EXISTING_PARENTS = [ROOT, ROOT / "slayr"]

BAD_CHARS = '<>:"/\\|?*'

# Track order for the Gaia album, given explicitly. Titles only — matched
# against file stems, which are all "slayr - <Title>".
GAIA_ORDER = [
    "Closed In",
    "Talk Nice",
    "Slayer World Tour 2077",
    "I Knew It",
    "If U Need Space",
    "Make It Obvious",
    "Push Me Away",
    "Soon Be Old",
    "Supposed to Be",
    "Mother Earth",
]


def sanitize(name: str) -> str:
    out = "".join("_" if c in BAD_CHARS or ord(c) < 32 else c for c in name)
    return out.strip().rstrip(".").strip() or "Album"


def target_folder(name: str) -> Path:
    """Reuse a folder that already matches the album, else one at the root."""
    safe = sanitize(name)
    for parent in EXISTING_PARENTS:
        candidate = parent / safe
        if candidate.is_dir():
            return candidate
    return ROOT / safe


def free_stem(dest: Path, stem: str, ext: str) -> str:
    """A stem colliding with nothing in `dest`, sidecars included."""
    final = stem
    n = 2
    while True:
        clash = (dest / f"{final}{ext}").exists() or any(
            (dest / f"{final}.{e}").exists() for e in SIDECAR_EXTS
        )
        if not clash:
            return final
        final = f"{stem} ({n})"
        n += 1


def plan_move(src: Path, dest: Path) -> tuple[Path, list[tuple[Path, Path]]]:
    """Return the audio's destination plus every sidecar move it implies."""
    if src.parent == dest:
        return src, []
    stem, ext = src.stem, src.suffix
    final = free_stem(dest, stem, ext)
    audio_to = dest / f"{final}{ext}"

    sidecars: list[tuple[Path, Path]] = []
    for e in SIDECAR_EXTS:
        for cand in (src.with_suffix("." + e), src.parent / f"{stem} (lyrics).{e}"):
            if cand.is_file():
                sidecars.append((cand, dest / f"{final}.{e}"))
                break  # both variants would collide on one target
    return audio_to, sidecars


def move(src: Path, dst: Path) -> None:
    """shutil.move handles cross-volume; fall back explicitly for clarity."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def load(name: str):
    p = DATA / name
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def save(name: str, value) -> None:
    (DATA / name).write_text(json.dumps(value), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually move files")
    args = ap.parse_args()
    dry = not args.apply

    albums = load("albums.json") or []
    if not albums:
        print("no albums found", file=sys.stderr)
        return 1

    # Resolve the Gaia album to the full folder contents, in the given order.
    gaia_dir = ROOT / "slayr" / "Gaia"
    gaia_paths: list[str] = []
    if gaia_dir.is_dir():
        by_title = {p.stem.split(" - ", 1)[-1]: p for p in gaia_dir.iterdir() if p.is_file()}
        for title in GAIA_ORDER:
            hit = by_title.get(title)
            if hit:
                gaia_paths.append(str(hit))
            else:
                print(f"  ! Gaia: no file for {title!r}")

    remap: dict[str, str] = {}
    moves: list[tuple[Path, Path]] = []
    total_sidecars = 0

    for album in albums:
        name = album["name"]
        dest = target_folder(name)

        if name == "Gaia" and gaia_paths:
            album["trackPaths"] = gaia_paths
            dest = gaia_dir

        paths = album.get("trackPaths", [])
        album["folder"] = str(dest)
        reused = dest.is_dir()
        print(f"\n{name}  ->  {dest}{'  (existing folder)' if reused else '  (new folder)'}")
        if not paths:
            print("   (no songs)")
            continue

        for raw in paths:
            src = Path(raw)
            if not src.is_file():
                print(f"   MISSING {src.name}")
                continue
            audio_to, sidecars = plan_move(src, dest)
            if audio_to == src:
                print(f"   stays   {src.name}")
                continue
            moves.append((src, audio_to))
            moves.extend(sidecars)
            total_sidecars += len(sidecars)
            remap[str(src)] = str(audio_to)
            extra = f"  (+{len(sidecars)} sidecar)" if sidecars else ""
            print(f"   move    {src.name}{extra}")

    print(f"\n{len(remap)} audio file(s), {total_sidecars} sidecar(s) to move")

    if dry:
        print("\nDRY RUN — nothing moved. Re-run with --apply.")
        return 0

    for src, dst in moves:
        try:
            move(src, dst)
        except OSError as e:
            print(f"FAILED {src} -> {dst}: {e}", file=sys.stderr)
            remap.pop(str(src), None)

    # Rewrite album track lists to the new locations.
    for album in albums:
        album["trackPaths"] = [remap.get(p, p) for p in album.get("trackPaths", [])]
    save("albums.json", albums)

    # Every other store keyed by path.
    overrides = load("overrides.json")
    if isinstance(overrides, dict):
        save("overrides.json", {remap.get(k, k): v for k, v in overrides.items()})

    lyr = load("lyricsOverrides.json")
    if isinstance(lyr, dict):
        save("lyricsOverrides.json", {remap.get(k, k): v for k, v in lyr.items()})

    playlists = load("playlists.json")
    if isinstance(playlists, list):
        for pl in playlists:
            pl["trackPaths"] = [remap.get(p, p) for p in pl.get("trackPaths", [])]
        save("playlists.json", playlists)

    pins = load("pins.json")
    if isinstance(pins, list):
        for pin in pins:
            if pin.get("kind") == "song":
                pin["target"] = remap.get(pin.get("target", ""), pin.get("target"))
        save("pins.json", pins)

    # Stamp Gaia's running order into the files themselves, so it survives a
    # rescan and reads correctly in other players.
    if gaia_paths:
        from mutagen.flac import FLAC

        total = len(gaia_paths)
        for i, raw in enumerate(gaia_paths, 1):
            p = Path(remap.get(raw, raw))
            if p.suffix.lower() != ".flac" or not p.is_file():
                continue
            f = FLAC(p)
            f["TRACKNUMBER"] = str(i)
            f["TRACKTOTAL"] = str(total)
            f["ALBUM"] = "Gaia"
            f.save()
        print(f"\nstamped track numbers 1-{total} on Gaia")

    print(f"\napplied: {len(remap)} audio file(s) moved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
