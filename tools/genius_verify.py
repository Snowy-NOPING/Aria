#!/usr/bin/env python3
"""Cross-check a local album's track listing against the Genius API.

Scope note: the Genius API has no lyrics endpoint by design — a token returns
song *metadata* only. So this verifies that each local file corresponds to a
real Genius song by the right artist on the right album, and surfaces album
tracks with no local file. It cannot diff lyric text, and this tool does not
scrape the lyric pages to fake that.

Token is read from the GENIUS_TOKEN environment variable (preferred) or --token.

Usage:
  python genius_verify.py --album "STUNT 4 LIFE" --artist "ezcodylee"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from wordsync import read_tags

API = "https://api.genius.com"
UA = "Aria/0.1 (local media player metadata check)"


def norm(s: str) -> str:
    """Loose key for comparing titles: case, punctuation and spacing removed.

    Local files carry stylised titles ("BAD APPLE !") that Genius may store
    differently ("BAD APPLE!"), so punctuation cannot be significant here.
    """
    s = s.lower()
    s = re.sub(r"\(feat[^)]*\)|\[feat[^\]]*\]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", "", s)


class Genius:
    def __init__(self, token: str) -> None:
        self.token = token

    def _get(self, path: str, **params) -> dict:
        url = f"{API}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {self.token}", "User-Agent": UA},
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    raise SystemExit("Genius rejected the token (401). Check GENIUS_TOKEN.")
                if e.code == 429 and attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                if e.code == 404:
                    return {}
                raise
            except urllib.error.URLError:
                if attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise
        return {}

    def search(self, query: str) -> list[dict]:
        data = self._get("/search", q=query)
        return [h.get("result", {}) for h in data.get("response", {}).get("hits", [])]

    def song(self, song_id: int) -> dict:
        data = self._get(f"/songs/{song_id}", text_format="plain")
        return data.get("response", {}).get("song", {})

    def album_tracks(self, album_id: int) -> list[dict]:
        out: list[dict] = []
        page = 1
        while page <= 10:
            data = self._get(f"/albums/{album_id}/tracks", per_page=50, page=page)
            tracks = data.get("response", {}).get("tracks", [])
            if not tracks:
                break
            out.extend(tracks)
            page += 1
        return out


def match_song(g: Genius, title: str, artist: str) -> dict | None:
    """Best Genius hit for a local title, or None when nothing plausibly matches."""
    want_t, want_a = norm(title), norm(artist)
    seen: dict[int, dict] = {}
    for query in (f"{artist} {title}", title):
        for hit in g.search(query):
            if hit.get("id"):
                seen.setdefault(hit["id"], hit)

    # Exact title match, preferring one whose primary artist also matches.
    exact = [h for h in seen.values() if norm(h.get("title", "")) == want_t]
    if exact:
        same_artist = [
            h for h in exact
            if want_a in norm(h.get("primary_artist", {}).get("name", ""))
            or norm(h.get("primary_artist", {}).get("name", "")) in want_a
        ]
        return (same_artist or exact)[0]

    # Otherwise accept a containment match only if the artist agrees.
    for h in seen.values():
        ht, ha = norm(h.get("title", "")), norm(h.get("primary_artist", {}).get("name", ""))
        if (want_t in ht or ht in want_t) and (want_a in ha or ha in want_a):
            return h
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--music-dir", default=r"C:/Users/santi/Music")
    ap.add_argument("--album", required=True)
    ap.add_argument("--artist", default=None, help="defaults to the album's most common ARTIST tag")
    ap.add_argument("--token", default=None)
    ap.add_argument("--report", default=None)
    args = ap.parse_args()

    token = args.token or os.environ.get("GENIUS_TOKEN")
    if not token:
        print("no token: set GENIUS_TOKEN or pass --token", file=sys.stderr)
        return 2

    # Collect local tracks for the album.
    local: list[tuple[int, str, str, Path]] = []
    for p in sorted(Path(args.music_dir).glob("*.flac")):
        tags = read_tags(p)
        if tags.get("ALBUM", "").strip().lower() != args.album.strip().lower():
            continue
        raw = tags.get("TRACKNUMBER", "0").split("/")[0]
        num = int(raw) if raw.isdigit() else 0
        local.append((num, tags.get("TITLE", p.stem), tags.get("ARTIST", ""), p))
    local.sort()

    if not local:
        print(f'no local tracks tagged album "{args.album}"', file=sys.stderr)
        return 1

    artist = args.artist or max(
        {a for _, _, a, _ in local},
        key=lambda a: sum(1 for _, _, x, _ in local if x == a),
    )
    # Tags often list features; the album artist is the first credited name.
    artist = re.split(r"\s*(?:,|&|feat\.|ft\.)\s*", artist)[0].strip()

    print(f'checking {len(local)} local tracks against Genius (artist "{artist}")\n')
    g = Genius(token)

    rows = []
    album_ids: dict[int, int] = {}
    for num, title, _, path in local:
        hit = match_song(g, title, artist)
        if not hit:
            print(f"[{num:>2}] {title[:44]:<44} NOT FOUND on Genius")
            rows.append({"track": num, "title": title, "status": "not-found"})
            continue

        song = g.song(hit["id"])
        alb = (song.get("album") or {})
        alb_name = alb.get("name", "")
        if alb.get("id"):
            album_ids[alb["id"]] = album_ids.get(alb["id"], 0) + 1

        ok_album = norm(alb_name) == norm(args.album)
        status = "ok" if ok_album else ("album-mismatch" if alb_name else "no-album-on-genius")
        note = "" if ok_album else f"  <- Genius album: {alb_name or 'none listed'}"
        print(f"[{num:>2}] {title[:44]:<44} {status}{note}")
        rows.append({
            "track": num, "title": title, "status": status,
            "genius_id": hit["id"], "genius_title": hit.get("title"),
            "genius_artist": hit.get("primary_artist", {}).get("name"),
            "genius_album": alb_name, "url": hit.get("url"),
        })
        time.sleep(0.25)  # be polite to the API

    # Use the album Genius agrees on to find tracks with no local file.
    missing = []
    if album_ids:
        album_id = max(album_ids, key=lambda k: album_ids[k])
        have = {norm(t) for _, t, _, _ in local}
        for t in g.album_tracks(album_id):
            song = t.get("song", {}) or {}
            gt = song.get("title", "")
            if gt and norm(gt) not in have:
                missing.append({"number": t.get("number"), "title": gt, "url": song.get("url")})
        if missing:
            print(f"\non Genius but not in your library ({len(missing)}):")
            for m in missing:
                print(f"  [{m['number']}] {m['title']}")
        else:
            print("\nevery Genius album track has a local file")

    if args.report:
        Path(args.report).write_text(
            json.dumps({"tracks": rows, "missing_locally": missing}, indent=2),
            encoding="utf-8",
        )
        print(f"\nreport -> {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
