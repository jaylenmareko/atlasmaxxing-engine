#!/usr/bin/env python3
"""WebVTT -> clean transcript text.

Copied from `.claude/skills/watch/scripts/transcribe.py` at the repo root,
minus `filter_range` (this flow never takes a time range) and plus
`format_plain`, since the Transcript box on the canvas wants prose, not the
`[MM:SS] line` format the /watch report used.

The dedupe logic is the load-bearing part and is unchanged: YouTube auto-subs
emit rolling-duplicate cues (each line reappears 2-3 times as it scrolls up),
so a naive join produces a transcript that stutters every line.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


TS_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
)
TAG_RE = re.compile(r"<[^>]+>")


def _to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_vtt(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8", errors="ignore")
    lines = text.splitlines()

    segments: list[dict] = []
    i = 0
    while i < len(lines):
        match = TS_RE.match(lines[i])
        if not match:
            i += 1
            continue

        start = _to_seconds(*match.groups()[:4])
        end = _to_seconds(*match.groups()[4:])
        i += 1

        cue_lines: list[str] = []
        while i < len(lines) and lines[i].strip():
            cleaned = TAG_RE.sub("", lines[i]).strip()
            if cleaned:
                cue_lines.append(cleaned)
            i += 1

        cue_text = " ".join(cue_lines).strip()
        if cue_text:
            segments.append({"start": round(start, 2), "end": round(end, 2), "text": cue_text})
        i += 1

    return _dedupe(segments)


def _dedupe(segments: list[dict]) -> list[dict]:
    """Collapse rolling duplicates common in YouTube auto-subs."""
    out: list[dict] = []
    for seg in segments:
        if out and seg["text"] == out[-1]["text"]:
            out[-1]["end"] = seg["end"]
            continue
        if out and seg["text"].startswith(out[-1]["text"] + " "):
            out[-1]["text"] = seg["text"]
            out[-1]["end"] = seg["end"]
            continue
        out.append(seg)
    return out


def format_plain(segments: list[dict]) -> str:
    """Flat prose — what the canvas's Transcript box actually renders.

    Timestamps are dropped on purpose: this text becomes the input to the
    script-writing prompt downstream, where `[00:04]` markers are noise.
    """
    parts = [seg["text"].strip() for seg in segments if seg.get("text", "").strip()]
    return " ".join(parts).strip()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: transcribe.py <vtt-path>", file=sys.stderr)
        raise SystemExit(2)
    print(format_plain(parse_vtt(sys.argv[1])))
