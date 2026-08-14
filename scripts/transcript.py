#!/usr/bin/env python3
"""Transcript-only entry point for the /api/transcript route.

The /watch skill's watch.py chains download -> frames -> transcript; this is
that chain with the frame-extraction half removed, since the canvas only wants
words. Order of operations:

    1. yt-dlp --skip-download  -> captions (fast, no media bytes, no API key)
    2. if no captions: yt-dlp bestaudio -> ffmpeg -> Whisper (needs a key)

Prints ONE json object on stdout, always:
    {"transcript": "...", "source": "captions" | "whisper (groq)"}
    {"error": "human-readable reason"}

Every diagnostic goes to stderr so stdout stays machine-parseable — the Node
route reads only the last stdout line, and yt-dlp/ffmpeg are chatty.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

# Windows consoles default stdout/stderr to the system codepage (e.g. cp1252),
# which raises UnicodeEncodeError on characters like "…" instead of printing
# them. Force UTF-8 so a transcript containing any non-ASCII text can't crash
# the process on a dev machine.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

from download import download_audio, fetch_subtitles, is_url  # noqa: E402
from transcribe import format_plain, parse_vtt  # noqa: E402
from whisper import load_api_key, transcribe_video  # noqa: E402


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def run(url: str, work: Path) -> dict:
    if not is_url(url):
        return {"error": "That doesn't look like a video URL — paste a full https:// link."}

    # --- pass 1: captions (no media download, no API key) ---
    print("[transcript] checking for captions…", file=sys.stderr)
    subs = fetch_subtitles(url, work / "subs")
    if subs.get("subtitle_path"):
        try:
            segments = parse_vtt(subs["subtitle_path"])
            text = format_plain(segments)
            if text:
                print(f"[transcript] captions: {len(segments)} segments", file=sys.stderr)
                return {"transcript": text, "source": "captions"}
            print("[transcript] caption file was empty — falling back", file=sys.stderr)
        except Exception as exc:
            print(f"[transcript] caption parse failed: {exc} — falling back", file=sys.stderr)

    # --- pass 2: whisper ---
    backend, api_key = load_api_key()
    if not backend or not api_key:
        from whisper import NO_KEY_MESSAGE
        return {"error": NO_KEY_MESSAGE}

    print("[transcript] no captions — downloading audio for Whisper…", file=sys.stderr)
    dl = download_audio(url, work / "audio")
    segments, used_backend = transcribe_video(
        dl["media_path"], work / "audio.mp3", backend=backend, api_key=api_key
    )
    text = format_plain(segments)
    if not text:
        return {"error": "Transcription came back empty — the video may have no speech."}
    return {"transcript": text, "source": f"whisper ({used_backend})"}


def main() -> int:
    ap = argparse.ArgumentParser(prog="transcript")
    ap.add_argument("url", help="Video URL (Instagram / TikTok / YouTube / anything yt-dlp handles)")
    ap.add_argument("--out-dir", default=None, help="Working dir (default: a temp dir, deleted after)")
    args = ap.parse_args()

    keep = args.out_dir is not None
    work = Path(args.out_dir).expanduser().resolve() if keep else Path(tempfile.mkdtemp(prefix="engine-transcript-"))
    work.mkdir(parents=True, exist_ok=True)

    try:
        payload = run(args.url, work)
    except SystemExit as exc:
        # download.py / whisper.py signal expected, explainable failures this
        # way (missing binary, private video, no API key, ffmpeg blew up).
        # Turn them into a normal JSON error rather than a stack trace.
        payload = {"error": str(exc) or "Transcript pull failed"}
    except Exception as exc:  # genuinely unexpected — still don't crash the route
        print(f"[transcript] unexpected error: {type(exc).__name__}: {exc}", file=sys.stderr)
        payload = {"error": f"Transcript pull failed: {exc}"}
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)

    _emit(payload)
    return 1 if "error" in payload else 0


if __name__ == "__main__":
    raise SystemExit(main())
