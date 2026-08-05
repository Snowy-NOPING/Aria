#!/usr/bin/env python3
"""Transcribe local audio to word-synced lyrics with Whisper.

This is the *transcription* path: unlike wordsync.py, the words come from the
model rather than from an existing .vtt, so the text itself is regenerated.
Output goes to a separate directory and existing .vtt / .lyricsfile.yaml files
are never overwritten — Whisper mishears dense mixes, and the point of keeping
both is being able to compare them.

Also reports, per track, how far the transcript diverges from the existing .vtt
(word error rate). High divergence means one of the two is wrong; the report
says which lines to listen to, not which source to believe.

Usage:
  python whisper_lyrics.py --album "STUNT 4 LIFE" --model small --out-dir ./whisper
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from wordsync import (
    Cue,
    Line,
    Word,
    enforce_monotonic,
    parse_vtt,
    read_tags,
    to_ms,
    write_lyricsfile,
    yaml_str,
)

# Whisper drifts into loops on long instrumental passages; these rein it in.
DECODE_OPTS = dict(
    language="en",
    word_timestamps=True,
    condition_on_previous_text=False,  # stops one bad line poisoning the rest
    temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # fallback ladder on low confidence
    compression_ratio_threshold=2.4,  # reject looped/repeated output
    no_speech_threshold=0.6,
)


def words_to_lines(segments: list[dict]) -> list[Line]:
    """Turn Whisper segments into Lines carrying per-word timing."""
    lines: list[Line] = []
    for seg in segments:
        raw = [w for w in (seg.get("words") or []) if str(w.get("word", "")).strip()]
        if not raw:
            continue

        text = "".join(str(w["word"]) for w in raw).strip()
        if not text:
            continue

        words: list[Word] = []
        for i, w in enumerate(raw):
            # Whisper puts the leading space on each word; move it to the end of
            # the previous one so a word's text carries its own trailing space,
            # which is what the Lyricsfile reader expects.
            t = str(w["word"])
            start = float(w.get("start", seg.get("start", 0.0)))
            end = float(w.get("end", start))
            if words and t.startswith(" "):
                words[-1].text += " "
                t = t[1:]
            words.append(Word(text=t, tokens=[t], start=start, end=max(end, start)))

        if not words:
            continue
        enforce_monotonic(words)
        line = Line(cue=Cue(words[0].start, words[-1].end, text))
        line.words = words
        line.start = words[0].start
        line.end = words[-1].end
        line.aligned = True
        line.score = float(1.0 - min(1.0, max(0.0, seg.get("no_speech_prob", 0.0))))
        lines.append(line)

    lines.sort(key=lambda l: l.start)
    return lines


TOKEN = re.compile(r"[^\W_]+", re.UNICODE)


def tokens_of(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def word_error_rate(ref: list[str], hyp: list[str]) -> float:
    """Levenshtein distance over words, normalised by reference length."""
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[-1] / len(ref)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--music-dir", default=r"C:/Users/santi/Music")
    ap.add_argument("--album", default=None)
    ap.add_argument("--file", default=None)
    ap.add_argument("--model", default="small",
                    help="tiny/base/small/medium/large-v3 — bigger is slower and more accurate")
    ap.add_argument("--out-dir", default=None,
                    help="defaults to <music-dir>/whisper so nothing is overwritten")
    ap.add_argument("--report", default=None)
    args = ap.parse_args()

    import whisper  # imported late: loading torch costs seconds

    music_dir = Path(args.music_dir)
    if args.file:
        tracks = [Path(args.file)]
    else:
        tracks = []
        for p in sorted(music_dir.glob("*.flac")):
            tags = read_tags(p)
            if args.album is None or tags.get("ALBUM", "").strip().lower() == args.album.strip().lower():
                tracks.append(p)
        tracks.sort(key=lambda p: int((read_tags(p).get("TRACKNUMBER", "0").split("/")[0] or "0") or 0))

    if not tracks:
        print("no matching tracks found", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir) if args.out_dir else music_dir / "whisper"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"loading Whisper '{args.model}' (CPU) ...", flush=True)
    model = whisper.load_model(args.model)

    report = []
    for path in tracks:
        tags = read_tags(path)
        num = tags.get("TRACKNUMBER", "?").split("/")[0]
        label = f"[{num:>2}] {path.stem[:40]}"

        t0 = time.monotonic()
        try:
            result = model.transcribe(str(path), verbose=False, **DECODE_OPTS)
        except Exception as e:
            print(f"{label}: FAIL ({type(e).__name__}: {e})", flush=True)
            report.append({"track": path.stem, "status": "transcribe-failed"})
            continue
        elapsed = time.monotonic() - t0

        lines = words_to_lines(result.get("segments") or [])
        if not lines:
            print(f"{label}: no speech detected", flush=True)
            report.append({"track": path.stem, "status": "empty"})
            continue

        duration = lines[-1].end
        out = out_dir / f"{path.stem}.lyricsfile.yaml"
        write_lyricsfile(out, lines, tags, duration)

        # Compare against the .vtt already on disk, when there is one.
        vtt = path.with_suffix(".vtt")
        wer = None
        if vtt.exists():
            ref = tokens_of(" ".join(c.text for c in parse_vtt(vtt)))
            hyp = tokens_of(" ".join(l.cue.text for l in lines))
            if ref:
                wer = word_error_rate(ref, hyp)

        words = sum(len(l.words) for l in lines)
        wer_txt = f", {wer*100:.0f}% divergence from .vtt" if wer is not None else ""
        print(f"{label}: {len(lines)} lines, {words} words, {elapsed/60:.1f} min{wer_txt}", flush=True)
        report.append({
            "track": path.stem, "status": "ok", "track_number": num,
            "lines": len(lines), "words": words,
            "seconds": round(elapsed, 1),
            "vtt_divergence": round(wer, 4) if wer is not None else None,
            "output": str(out),
        })

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nreport -> {args.report}")
    print(f"\noutput written to {out_dir} (existing files untouched)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
