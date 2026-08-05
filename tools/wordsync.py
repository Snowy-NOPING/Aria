#!/usr/bin/env python3
"""Upgrade line-synced .vtt cues to word-synced .lyricsfile.yaml via forced alignment.

The lyric text is never re-transcribed or altered: the words come from the .vtt
the user already has, and the aligner (torchaudio MMS_FA) only decides *when*
each of those words is sung. Punctuation, capitalisation and spacing are carried
through verbatim by slicing the original cue text.

Each cue is aligned inside its own padded time window rather than aligning the
whole track in one pass. A long instrumental break can otherwise let the aligner
drift; anchoring on the cue times keeps any error local to one line and yields a
per-line confidence score for free.

Usage:
  python wordsync.py --album "STUNT 4 LIFE" --music-dir "C:/Users/santi/Music"
  python wordsync.py --file "C:/Users/santi/Music/BAD APPLE ! - ezcodylee.flac"
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import torch
from torchaudio.pipelines import MMS_FA

SAMPLE_RATE = 16000

# How far outside a cue's stated window we let its words land. Cue boundaries are
# usually a hair early/late, and a word clipped at the edge scores terribly.
PAD_SECONDS = 0.35

# Raw MMS_FA scores are acoustic likelihoods from a *speech* model. Sung vocals
# over a dense mix score an order of magnitude lower than clean speech (observed
# median ~0.13 on this material), so an absolute threshold flags either
# everything or nothing. Confidence is therefore judged two ways:
#   - relative: a line scoring far below its own track's median is an outlier
#   - structural: timings that are physically implausible regardless of score
# Structural checks are what actually catch a misaligned line.

# Flag a line scoring below this fraction of the track's median line score.
REL_SCORE_FLOOR = 0.35

# MMS_FA emits one frame per 20 ms, so that is the hard floor on any word's
# duration. A word pinned to a single frame is one the aligner could not place;
# anything above that is just fast delivery, which this material has plenty of.
MIN_WORD_SECONDS = 0.025

# One squeezed word in a fast line is normal. A line is only suspect when a real
# share of it collapsed, which is what a genuine misalignment looks like.
MIN_SQUEEZED_SHARE = 0.25

# A single word held longer than this usually means it was parked across a gap.
MAX_WORD_SECONDS = 3.5

# How far a line's aligned span may drift from its source cue before it is suspect.
MAX_DRIFT_SECONDS = 1.5

# Some source cues are corrupt: they pack a dozen words into 200 ms, which cannot
# be sung. Those cues are not trusted as anchors — the run they belong to is
# realigned in one widened window and its timings are rebuilt from the audio.
# Fastest credible sung delivery, used to decide a cue is impossible.
MIN_SECONDS_PER_WORD = 0.10

# Slack added when widening a repaired run, so its words are not pinned to edges.
REPAIR_SLACK = 1.25


# --------------------------------------------------------------------------
# audio
# --------------------------------------------------------------------------

def decode_audio(path: Path) -> torch.Tensor:
    """Decode any ffmpeg-readable file to 16 kHz mono float32.

    ffmpeg is used rather than torchaudio.load because torchaudio 2.11 has moved
    decoding out to torchcodec and its own loader is unreliable for FLAC.
    """
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error",
        "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {path.name}: {proc.stderr.decode(errors='replace')[:400]}")
    if not proc.stdout:
        raise RuntimeError(f"ffmpeg produced no audio for {path.name}")
    audio = torch.frombuffer(bytearray(proc.stdout), dtype=torch.float32)
    return audio.unsqueeze(0)


# --------------------------------------------------------------------------
# FLAC tags (album/title/artist/track, for the output metadata block)
# --------------------------------------------------------------------------

def read_tags(path: Path) -> dict[str, str]:
    """Minimal Vorbis-comment reader for FLAC. Returns {} for anything else."""
    tags: dict[str, str] = {}
    try:
        with open(path, "rb") as f:
            if f.read(4) != b"fLaC":
                return {}
            while True:
                head = f.read(4)
                if len(head) < 4:
                    break
                last = head[0] & 0x80
                btype = head[0] & 0x7F
                length = int.from_bytes(head[1:4], "big")
                body = f.read(length)
                if btype == 4:  # VORBIS_COMMENT
                    pos = 0
                    (vlen,) = struct.unpack("<I", body[pos:pos + 4])
                    pos += 4 + vlen
                    (count,) = struct.unpack("<I", body[pos:pos + 4])
                    pos += 4
                    for _ in range(count):
                        (ln,) = struct.unpack("<I", body[pos:pos + 4])
                        pos += 4
                        key, _, val = body[pos:pos + ln].decode("utf-8", "replace").partition("=")
                        pos += ln
                        tags[key.upper()] = val
                if last:
                    break
    except Exception:
        return {}
    return tags


# --------------------------------------------------------------------------
# VTT parsing
# --------------------------------------------------------------------------

TS = r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"
CUE_RE = re.compile(rf"^{TS}\s*-->\s*{TS}")


def _ts(h, m, s, ms) -> float:
    return (int(h) if h else 0) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


@dataclass
class Cue:
    start: float
    end: float
    text: str


def parse_vtt(path: Path) -> list[Cue]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\r?\n", raw):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        idx = next((i for i, ln in enumerate(lines) if CUE_RE.match(ln)), None)
        if idx is None:
            continue  # WEBVTT header, NOTE blocks, styling
        m = CUE_RE.match(lines[idx])
        start = _ts(*m.group(1, 2, 3, 4))
        end = _ts(*m.group(5, 6, 7, 8))
        text = " ".join(lines[idx + 1:]).strip()
        # Strip VTT inline markup, keep the words themselves.
        text = re.sub(r"</?[cvbiu][^>]*>", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text and text not in {"♪", "♩", "-"}:
            cues.append(Cue(start, end, text))
    cues.sort(key=lambda c: c.start)
    return cues


# --------------------------------------------------------------------------
# tokenisation
# --------------------------------------------------------------------------

# A token is any run containing at least one letter or digit, plus the
# apostrophes/hyphens inside it. Everything else rides along as trailing text.
TOKEN_RE = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)

DIGITS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
}


def normalise(token: str, vocab: set[str]) -> list[str]:
    """Map a display token to aligner tokens, dropping anything out-of-vocab.

    MMS_FA's dictionary is lowercase latin + apostrophe. A hyphenated chant is
    kept as one display word but split for the aligner so each part gets scored.
    """
    t = token.lower().replace("’", "'")
    # Spell out digits so numerals do not silently vanish from the alignment.
    if any(ch.isdigit() for ch in t):
        t = "".join(DIGITS.get(ch, ch) for ch in t)
    t = t.replace("-", " ")
    out: list[str] = []
    for part in t.split():
        cleaned = "".join(ch for ch in part if ch in vocab)
        cleaned = cleaned.strip("'")
        if cleaned:
            out.append(cleaned)
    return out


@dataclass
class Word:
    """One display word: the text exactly as it appears, plus its timing."""
    text: str                      # verbatim slice of the cue, incl. trailing space
    tokens: list[str]              # aligner tokens (may be empty -> untimed)
    start: float = 0.0
    end: float = 0.0
    score: float = 0.0


@dataclass
class Line:
    cue: Cue
    words: list[Word] = field(default_factory=list)
    start: float = 0.0
    end: float = 0.0
    score: float = 0.0
    aligned: bool = False
    # True when the source cue was impossible and its timing came from the audio
    # rather than from the .vtt. Such a line is expected to drift.
    repaired: bool = False


def split_line(cue: Cue, vocab: set[str]) -> list[Word]:
    """Split cue text into display words that rebuild the line exactly."""
    spans = [(m.start(), m.end()) for m in TOKEN_RE.finditer(cue.text)]
    if not spans:
        return []
    words: list[Word] = []
    for i, (s, e) in enumerate(spans):
        # Carry everything up to the next token: trailing punctuation + spaces.
        chunk_end = spans[i + 1][0] if i + 1 < len(spans) else len(cue.text)
        # Leading text before the very first token belongs to that first word.
        chunk_start = s if i > 0 else 0
        words.append(Word(text=cue.text[chunk_start:chunk_end], tokens=normalise(cue.text[s:e], vocab)))
    return words


# --------------------------------------------------------------------------
# alignment
# --------------------------------------------------------------------------

class Aligner:
    def __init__(self) -> None:
        self.bundle = MMS_FA
        self.model = self.bundle.get_model()
        self.model.eval()
        self.tokenizer = self.bundle.get_tokenizer()
        self.aligner = self.bundle.get_aligner()
        self.vocab = {c for c in self.bundle.get_dict() if len(c) == 1 and c.isalpha() or c == "'"}

    def align_window(self, audio: torch.Tensor, words: list[Word], t0: float, t1: float) -> bool:
        """Align `words` inside audio[t0:t1]. Returns False if it could not run."""
        timed = [w for w in words if w.tokens]
        if not timed:
            return False

        a = max(0, int(t0 * SAMPLE_RATE))
        b = min(audio.size(1), int(t1 * SAMPLE_RATE))
        if b - a < SAMPLE_RATE // 10:  # under 100 ms of audio, nothing to align
            return False
        chunk = audio[:, a:b]

        flat: list[str] = []
        owner: list[int] = []   # index into `timed` for each flat token
        for i, w in enumerate(timed):
            for tok in w.tokens:
                flat.append(tok)
                owner.append(i)
        if not flat:
            return False

        with torch.inference_mode():
            emission, _ = self.model(chunk)
            try:
                spans = self.aligner(emission[0], self.tokenizer(flat))
            except Exception:
                return False

        ratio = chunk.size(1) / emission.size(1) / SAMPLE_RATE
        # spans is one list per flat token; fold them back onto display words.
        per_word: dict[int, list] = {}
        for tok_i, span in enumerate(spans):
            per_word.setdefault(owner[tok_i], []).extend(span)

        for i, sub in per_word.items():
            if not sub:
                continue
            w = timed[i]
            w.start = t0 + sub[0].start * ratio
            w.end = t0 + sub[-1].end * ratio
            total = sum(s.end - s.start for s in sub)
            w.score = sum(s.score * (s.end - s.start) for s in sub) / total if total else 0.0
        return True


def interpolate_untimed(words: list[Word], line_start: float, line_end: float) -> None:
    """Give words with no aligner tokens a slot between their timed neighbours."""
    n = len(words)
    for i, w in enumerate(words):
        if w.tokens and w.end > w.start:
            continue
        prev_end = next((words[j].end for j in range(i - 1, -1, -1) if words[j].end > words[j].start), line_start)
        nxt_start = next((words[j].start for j in range(i + 1, n) if words[j].end > words[j].start), line_end)
        if nxt_start < prev_end:
            nxt_start = prev_end
        w.start, w.end = prev_end, nxt_start


def enforce_monotonic(words: list[Word]) -> None:
    """Clamp overlaps so the highlight never runs backwards."""
    for i in range(1, len(words)):
        if words[i].start < words[i - 1].end:
            words[i].start = words[i - 1].end
        if words[i].end < words[i].start:
            words[i].end = words[i].start


def needed_seconds(line: Line) -> float:
    """Shortest span in which this line's words could plausibly be sung."""
    return sum(1 for w in line.words if w.tokens) * MIN_SECONDS_PER_WORD


def group_runs(lines: list[Line]) -> list[list[int]]:
    """Group line indices into alignment units.

    A cue too short to physically hold its own words is untrustworthy, and such
    cues arrive in clusters, so consecutive bad cues are merged into one run and
    aligned together. Everything else stays a run of one.
    """
    impossible = [(l.cue.end - l.cue.start) < needed_seconds(l) for l in lines]
    runs: list[list[int]] = []
    i = 0
    while i < len(lines):
        if not impossible[i]:
            runs.append([i])
            i += 1
            continue
        j = i
        # Only absorb cues that are themselves impossible. Adjacency is not a
        # signal here: .vtt cues normally butt up exactly against each other, so
        # chaining on that swallows the good anchors and widens the window until
        # the alignment drifts badly.
        while j + 1 < len(lines) and impossible[j + 1]:
            j += 1
        runs.append(list(range(i, j + 1)))
        i = j + 1
    return runs


def window_for(lines: list[Line], run: list[int], duration: float) -> tuple[float, float, bool]:
    """Audio window for a run, widened when the cues cannot hold their words."""
    first, last = lines[run[0]], lines[run[-1]]
    start, end = first.cue.start, last.cue.end
    need = sum(needed_seconds(lines[i]) for i in run)

    if (end - start) >= need:
        return max(0.0, start - PAD_SECONDS), min(duration, end + PAD_SECONDS), False

    # Widen symmetrically around the run's midpoint until the words could fit,
    # then clamp to the track. The cue times are wrong, so they only seed a
    # search region; the aligner decides where the words actually land.
    half = (need + REPAIR_SLACK) / 2
    mid = (start + end) / 2
    return max(0.0, mid - half), min(duration, mid + half), True


def process_track(audio: torch.Tensor, cues: list[Cue], aligner: Aligner) -> list[Line]:
    duration = audio.size(1) / SAMPLE_RATE

    lines: list[Line] = []
    for cue in cues:
        line = Line(cue=cue)
        line.words = split_line(cue, aligner.vocab)
        if line.words:
            lines.append(line)

    for run in group_runs(lines):
        t0, t1, repaired = window_for(lines, run, duration)
        words = [w for i in run for w in lines[i].words]
        ok = aligner.align_window(audio, words, t0, t1)

        for i in run:
            line = lines[i]
            line.repaired = repaired
            line.aligned = ok
            timed = [w for w in line.words if w.end > w.start]
            if ok and timed:
                line.start = min(w.start for w in timed)
                line.end = max(w.end for w in timed)
                span = sum(w.end - w.start for w in timed)
                line.score = sum(w.score * (w.end - w.start) for w in timed) / span if span else 0.0
            else:
                # Fall back to the cue's own timing and spread words evenly, so
                # the line still renders even when alignment could not run.
                line.start, line.end, line.score = line.cue.start, line.cue.end, 0.0
                n = len(line.words)
                step = (line.cue.end - line.cue.start) / n if n else 0
                for k, w in enumerate(line.words):
                    w.start = line.cue.start + k * step
                    w.end = line.cue.start + (k + 1) * step

            interpolate_untimed(line.words, line.start, line.end)
            enforce_monotonic(line.words)
            line.start = min(line.start, line.words[0].start)
            line.end = max(line.end, line.words[-1].end)

    lines.sort(key=lambda l: l.start)
    return lines


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------

def diagnose(lines: list[Line]) -> list[dict]:
    """Return one review entry per line that looks misaligned.

    Reported by timestamp and word index rather than by text, so the report can
    be read alongside the audio without duplicating the lyrics.
    """
    scored = sorted(l.score for l in lines if l.aligned and l.score > 0)
    median = scored[len(scored) // 2] if scored else 0.0
    floor = median * REL_SCORE_FLOOR

    review: list[dict] = []
    for i, line in enumerate(lines):
        reasons: list[str] = []

        if not line.aligned:
            reasons.append("alignment-failed")
        elif median > 0 and line.score < floor:
            reasons.append(f"score {line.score:.3f} vs track median {median:.3f}")

        timed = [w for w in line.words if w.tokens]
        squeezed = sum(1 for w in timed if w.end - w.start < MIN_WORD_SECONDS)
        if timed and squeezed / len(timed) >= MIN_SQUEEZED_SHARE:
            reasons.append(f"{squeezed}/{len(timed)} words collapsed to one frame")

        stretched = sum(1 for w in timed if w.end - w.start > MAX_WORD_SECONDS)
        if stretched:
            reasons.append(f"{stretched} word(s) held over {MAX_WORD_SECONDS:.1f}s")

        if line.repaired:
            # The source cue was impossible, so drift from it is the fix, not a
            # fault. Surface it anyway: rebuilt timing is worth a listen.
            reasons.append(
                f"source cue held {len(timed)} words in "
                f"{line.cue.end - line.cue.start:.2f}s; timing rebuilt from audio"
            )
        else:
            drift = max(abs(line.start - line.cue.start), abs(line.end - line.cue.end))
            if drift > MAX_DRIFT_SECONDS:
                reasons.append(f"drifted {drift:.1f}s from source cue")

        if reasons:
            review.append({
                "line": i + 1,
                "at": f"{int(line.start // 60):d}:{line.start % 60:06.3f}",
                "start_ms": to_ms(line.start),
                "words": len(line.words),
                "score": round(line.score, 3),
                "reasons": reasons,
            })
    return review


def yaml_str(s: str) -> str:
    """Double-quoted YAML scalar. json.dumps escaping is a valid subset."""
    return json.dumps(s, ensure_ascii=False)


def to_ms(seconds: float) -> int:
    return max(0, int(round(seconds * 1000)))


def write_lyricsfile(path: Path, lines: list[Line], tags: dict[str, str], duration: float) -> None:
    out: list[str] = ['version: "1.0"', "metadata:"]
    meta = {
        "title": tags.get("TITLE", ""),
        "artist": tags.get("ARTIST", ""),
        "album": tags.get("ALBUM", ""),
        "language": tags.get("LANGUAGE", "en"),
    }
    for k, v in meta.items():
        out.append(f"  {k}: {yaml_str(v)}")
    out.append(f"  duration_ms: {to_ms(duration)}")
    out.append("  instrumental: false")

    out.append("lines:")
    for line in lines:
        out.append(f"  - start_ms: {to_ms(line.start)}")
        out.append(f"    end_ms: {to_ms(line.end)}")
        out.append(f"    text: {yaml_str(line.cue.text)}")
        out.append("    words:")
        for w in line.words:
            out.append(f"      - text: {yaml_str(w.text)}")
            out.append(f"        start_ms: {to_ms(w.start)}")
            out.append(f"        end_ms: {to_ms(w.end)}")

    plain = "\n".join(l.cue.text for l in lines)
    out.append(f"plain: {yaml_str(plain)}")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def find_tracks(music_dir: Path, album: str | None) -> list[Path]:
    hits = []
    for p in sorted(music_dir.glob("*.flac")):
        tags = read_tags(p)
        if album is None or tags.get("ALBUM", "").strip().lower() == album.strip().lower():
            hits.append(p)

    def key(p: Path):
        t = read_tags(p).get("TRACKNUMBER", "0").split("/")[0]
        try:
            return int(t)
        except ValueError:
            return 0

    return sorted(hits, key=key)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--music-dir", default=r"C:/Users/santi/Music")
    ap.add_argument("--album", default=None)
    ap.add_argument("--file", default=None, help="align a single audio file")
    ap.add_argument("--out-dir", default=None, help="defaults to alongside the audio")
    ap.add_argument("--report", default=None, help="write a JSON confidence report here")
    args = ap.parse_args()

    music_dir = Path(args.music_dir)
    if args.file:
        tracks = [Path(args.file)]
    else:
        tracks = find_tracks(music_dir, args.album)

    if not tracks:
        print("no matching tracks found", file=sys.stderr)
        return 1

    print(f"loading MMS_FA aligner ...", flush=True)
    aligner = Aligner()

    report = []
    for path in tracks:
        vtt = path.with_suffix(".vtt")
        tags = read_tags(path)
        num = tags.get("TRACKNUMBER", "?").split("/")[0]
        label = f"[{num:>2}] {path.stem}"

        if not vtt.exists():
            print(f"{label}: SKIP (no .vtt alongside)", flush=True)
            report.append({"track": path.stem, "status": "no-vtt"})
            continue

        cues = parse_vtt(vtt)
        if not cues:
            print(f"{label}: SKIP (.vtt has no usable cues)", flush=True)
            report.append({"track": path.stem, "status": "empty-vtt"})
            continue

        try:
            audio = decode_audio(path)
        except RuntimeError as e:
            print(f"{label}: FAIL ({e})", flush=True)
            report.append({"track": path.stem, "status": "decode-failed"})
            continue

        duration = audio.size(1) / SAMPLE_RATE
        lines = process_track(audio, cues, aligner)
        if not lines:
            print(f"{label}: SKIP (nothing alignable)", flush=True)
            report.append({"track": path.stem, "status": "no-lines"})
            continue

        out_dir = Path(args.out_dir) if args.out_dir else path.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{path.stem}.lyricsfile.yaml"
        write_lyricsfile(out, lines, tags, duration)

        words = sum(len(l.words) for l in lines)
        scored = [l for l in lines if l.aligned]
        mean = sum(l.score for l in scored) / len(scored) if scored else 0.0
        failed = len(lines) - len(scored)
        weak = diagnose(lines)
        print(
            f"{label}: {len(lines)} lines, {words} words, "
            f"{len(scored)}/{len(lines)} aligned, {len(weak)} to review"
            + (f", {failed} FAILED" if failed else ""),
            flush=True,
        )
        report.append({
            "track": path.stem,
            "status": "ok",
            "track_number": num,
            "lines": len(lines),
            "words": words,
            "mean_confidence": round(mean, 3),
            "review": weak,
            "output": str(out),
        })

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nreport -> {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
