#!/usr/bin/env python3
"""Transcript-only entry point for the /api/transcript route.

The /watch skill's watch.py chains download -> frames -> transcript; this is
that chain with the frame-extraction half removed, since the canvas only wants
words. Every pull: yt-dlp bestaudio -> ffmpeg -> AssemblyAI, with
`speaker_labels: true`.

There used to be a captions-first fast path (skip audio entirely when a video
already had captions, no API key needed). Removed — captions never carry
speaker info, and most YouTube videos have auto-captions, so that path always
won and diarization never actually ran. See download.py's module docstring
for the full reasoning. Every pull now costs an AssemblyAI call; there's no
free/fast case anymore.

Prints ONE json object on stdout, always:
    {"transcript": "...", "segments": [{"time": "0:01", "speaker": "Speaker A", "text": "..."}], "source": "assemblyai"}
    {"error": "human-readable reason"}

`transcript` is flat prose (what the editable promptValues.transcript box
holds); `segments` is the same content broken into timestamped, speaker-
labeled rows for the sidebar's popup.

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

from assemblyai import load_api_key, transcribe_video  # noqa: E402
from download import download_audio, is_url  # noqa: E402
from transcribe import censor_segments, format_plain, to_display_segments  # noqa: E402


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def run(url: str, work: Path) -> dict:
    if not is_url(url):
        return {"error": "That doesn't look like a video URL — paste a full https:// link."}

    api_key = load_api_key()
    if not api_key:
        from assemblyai import NO_KEY_MESSAGE
        return {"error": NO_KEY_MESSAGE}

    print("[transcript] downloading audio for AssemblyAI…", file=sys.stderr)
    dl = download_audio(url, work / "audio")
    raw_segments, used_backend = transcribe_video(dl["media_path"], work / "audio.mp3", api_key=api_key)
    # AssemblyAI's utterances are already correctly segmented per speaker
    # turn — just profanity substitution needed, no dedupe/regroup.
    segments = censor_segments(raw_segments)
    text = format_plain(segments)
    if not text:
        return {"error": "Transcription came back empty — the video may have no speech."}
    return {"transcript": text, "segments": to_display_segments(segments), "source": used_backend}


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
        # download.py / assemblyai.py signal expected, explainable failures
        # this way (missing binary, private video, no API key, ffmpeg blew up).
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
