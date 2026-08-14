#!/usr/bin/env python3
"""yt-dlp wrapper, trimmed for the transcript-only flow.

Adapted from `.claude/skills/watch/scripts/download.py` at the repo root.
`download_audio()` grabs bestaudio rather than <=720p video — AssemblyAI only
ever sees the audio track, so pulling the video stream would be wasted
bandwidth.

There used to also be a `fetch_subtitles()` captions-first path (skip the
audio download entirely when a video already has captions). Removed: it
always won over the audio/AssemblyAI path whenever a video had ANY captions
— which is most YouTube videos — so diarization (the whole point of the
AssemblyAI fallback, see assemblyai.py) never actually ran for the common
case. Captions were also often no more reliably punctuated than raw ASR
output anyway (YouTube auto-captions on ordinary videos, not just the
"-orig" variant). Every pull now goes through audio + AssemblyAI, always.

The original's local-file branch (`resolve_local`) is gone too: this is
driven by an API route that only accepts URLs.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


# Anything yt-dlp might hand back that is NOT the media itself.
SIDECAR_SUFFIXES = {".json", ".vtt", ".srt", ".ass", ".lrc", ".part", ".ytdl"}


def is_url(source: str) -> bool:
    parsed = urlparse(source)
    return parsed.scheme in ("http", "https")


def _require_yt_dlp() -> None:
    if shutil.which("yt-dlp") is None:
        raise SystemExit("yt-dlp is not installed on the server")


def _pick_media(out_dir: Path) -> Path | None:
    for candidate in sorted(out_dir.glob("video.*")):
        if candidate.suffix.lower() in SIDECAR_SUFFIXES:
            continue
        # "video.info.json" already filtered above; guard the .en.vtt shape too
        if candidate.name.endswith(".info.json"):
            continue
        return candidate
    return None


def _read_info(out_dir: Path, url: str) -> dict:
    info_path = out_dir / "video.info.json"
    if not info_path.exists():
        return {"url": url}
    try:
        raw = json.loads(info_path.read_text(encoding="utf-8", errors="ignore"))
        return {
            "title": raw.get("title"),
            "uploader": raw.get("uploader") or raw.get("channel"),
            "duration": raw.get("duration"),
            "url": raw.get("webpage_url") or url,
        }
    except Exception:
        return {"url": url}


def download_audio(url: str, out_dir: Path) -> dict:
    """Audio-only download for the AssemblyAI fallback.

    `ba/b` = bestaudio, else best combined stream. ffmpeg re-encodes whatever
    container comes back downstream in assemblyai.extract_audio, so the exact
    format here doesn't matter.
    """
    _require_yt_dlp()
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "yt-dlp",
        "-N", "8",
        "-f", "ba/b",
        "--no-playlist",
        "--ignore-errors",
        "-o", str(out_dir / "video.%(ext)s"),
        url,
    ]
    # Same "trust the artifact, not the exit code" rule the original used:
    # yt-dlp exits non-zero on partial sidecar failures even when the media
    # landed fine, so presence of the file is what decides success.
    result = subprocess.run(cmd, stdout=sys.stderr, stderr=sys.stderr)

    media = _pick_media(out_dir)
    if media is None:
        raise SystemExit(
            f"yt-dlp could not download this video (exit {result.returncode}) — "
            "it may be private, region-locked, or an unsupported link"
        )

    return {"media_path": str(media), "info": _read_info(out_dir, url)}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: download.py <url> <out-dir>", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(download_audio(sys.argv[1], Path(sys.argv[2])), indent=2))
