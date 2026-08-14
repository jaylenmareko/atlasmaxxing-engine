#!/usr/bin/env python3
"""AssemblyAI transcription — pure stdlib, no SDK installs.

Replaces the Groq/OpenAI Whisper call this project used previously (that
module, whisper.py, is gone from this repo — the shared `/watch` skill at
`.claude/skills/watch/scripts/whisper.py` is untouched, it doesn't need
diarization). The reason for the swap: Whisper's response has no notion of
"who is speaking" — every segment is just a time-sliced chunk of the whole
mixed audio. AssemblyAI's `speaker_labels: true` option returns an
`utterances` array where each entry is already one speaker's turn — a
{speaker, start, end, text} tuple, already punctuated — which is exactly the
shape the transcript popup needs to render "Speaker A" / "Speaker B" rows
instead of one blended stream.

`extract_audio()` is unchanged from the old whisper.py (ffmpeg, mono 16kHz
mp3) — only the upload-and-transcribe half is new. Three HTTP calls, all via
urllib (no `assemblyai`/`requests` package):

  1. POST /v2/upload           — raw audio bytes -> {"upload_url": "..."}
  2. POST /v2/transcript       — {"audio_url", "speaker_labels": true} -> job id
  3. GET  /v2/transcript/{id}  — poll until status is "completed" or "error"
"""
from __future__ import annotations

import json
import os
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
from pathlib import Path
from urllib.request import Request, urlopen


UPLOAD_ENDPOINT = "https://api.assemblyai.com/v2/upload"
TRANSCRIPT_ENDPOINT = "https://api.assemblyai.com/v2/transcript"

USER_AGENT = "engine-transcript/1.0 (+atlasmaxxing; python-urllib)"

NO_KEY_MESSAGE = (
    "This video has no captions and no AssemblyAI API key is configured on "
    "the server, so there's nothing to transcribe from. Set "
    "ASSEMBLYAI_API_KEY in the service environment."
)

MAX_ATTEMPTS = 4       # initial + 3 retries, for the upload/submit/poll requests
RETRY_BASE_DELAY = 2.0
POLL_INTERVAL = 3.0
POLL_TIMEOUT = 10 * 60.0  # a job stuck longer than this is stuck, not slow


def load_api_key() -> str | None:
    """Plain env var first (how Render injects secrets), then falls back to
    `~/.config/engine-frontend/.env` for local dev — same idea as whisper.py's
    old `~/.config/watch/.env` lookup, just this project's own key file since
    AssemblyAI isn't something the `/watch` skill uses."""
    value = os.environ.get("ASSEMBLYAI_API_KEY")
    if value and value.strip():
        return value.strip()

    dotenv_path = Path.home() / ".config" / "engine-frontend" / ".env"
    if not dotenv_path.exists():
        return None
    try:
        for line in dotenv_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key.strip() != "ASSEMBLYAI_API_KEY":
                continue
            val = val.strip()
            if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                val = val[1:-1]
            return val or None
    except OSError:
        return None
    return None


def extract_audio(media_path: str, out_path: Path) -> Path:
    """Extract mono 16kHz 64kbps mp3 — unchanged from the old Whisper path."""
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is not installed on the server")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", media_path,
        "-vn",
        "-acodec", "libmp3lame",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"ffmpeg audio extraction failed: {result.stderr.strip()}")
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise SystemExit("ffmpeg produced no audio — the video may have no audio track")
    return out_path


def _read_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read()
    except Exception:
        return ""
    if not body:
        return ""
    try:
        return f" — {body.decode('utf-8', errors='replace')[:400]}"
    except Exception:
        return ""


def _retry_after(exc: urllib.error.HTTPError) -> float | None:
    header = exc.headers.get("Retry-After") if getattr(exc, "headers", None) else None
    if not header:
        return None
    try:
        return float(header)
    except ValueError:
        return None


def _request_with_retries(request: Request, context: ssl.SSLContext, label: str) -> bytes:
    """Shared retry/backoff for the upload, submit, and each poll request.

    Same shape as the old whisper.py's _post_whisper retry loop: retry
    network errors and 429s with backoff, fail fast on other 4xx.
    """
    rate_limit_hits = 0
    last_exc: Exception | None = None
    last_detail = ""

    for attempt in range(MAX_ATTEMPTS):
        try:
            with urlopen(request, timeout=120, context=context) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            detail = _read_error_body(exc)
            last_exc, last_detail = exc, detail

            if 400 <= exc.code < 500 and exc.code != 429:
                raise SystemExit(f"AssemblyAI {label} failed: {exc}{detail}")

            if exc.code == 429:
                rate_limit_hits += 1
                delay = _retry_after(exc) or RETRY_BASE_DELAY * (2 ** attempt) + 1
            else:
                delay = RETRY_BASE_DELAY * (2 ** attempt)

            if attempt < MAX_ATTEMPTS - 1:
                print(
                    f"[transcript] AssemblyAI {label} HTTP {exc.code} — retrying in {delay:.1f}s "
                    f"(attempt {attempt + 2}/{MAX_ATTEMPTS})",
                    file=sys.stderr,
                )
                time.sleep(delay)
            continue
        except (urllib.error.URLError, TimeoutError, ConnectionResetError, OSError) as exc:
            last_exc, last_detail = exc, ""
            if attempt < MAX_ATTEMPTS - 1:
                delay = RETRY_BASE_DELAY * (attempt + 1)
                print(
                    f"[transcript] AssemblyAI {label} network error ({type(exc).__name__}: {exc}) — "
                    f"retrying in {delay:.1f}s (attempt {attempt + 2}/{MAX_ATTEMPTS})",
                    file=sys.stderr,
                )
                time.sleep(delay)
            continue

    raise SystemExit(f"AssemblyAI {label} failed after {MAX_ATTEMPTS} attempts: {last_exc}{last_detail}")


def _upload_audio(api_key: str, audio_path: Path, context: ssl.SSLContext) -> str:
    headers = {
        "authorization": api_key,
        "content-type": "application/octet-stream",
        "User-Agent": USER_AGENT,
    }
    request = Request(UPLOAD_ENDPOINT, data=audio_path.read_bytes(), headers=headers, method="POST")
    body = _request_with_retries(request, context, "upload")
    data = json.loads(body)
    upload_url = data.get("upload_url")
    if not upload_url:
        raise SystemExit(f"AssemblyAI upload returned no upload_url: {body[:200]!r}")
    return upload_url


def _submit_job(api_key: str, upload_url: str, context: ssl.SSLContext) -> str:
    payload = json.dumps({"audio_url": upload_url, "speaker_labels": True}).encode()
    headers = {
        "authorization": api_key,
        "content-type": "application/json",
        "User-Agent": USER_AGENT,
    }
    request = Request(TRANSCRIPT_ENDPOINT, data=payload, headers=headers, method="POST")
    body = _request_with_retries(request, context, "submit")
    data = json.loads(body)
    job_id = data.get("id")
    if not job_id:
        raise SystemExit(f"AssemblyAI submit returned no job id: {body[:200]!r}")
    return job_id


def _poll_job(api_key: str, job_id: str, context: ssl.SSLContext) -> dict:
    headers = {"authorization": api_key, "User-Agent": USER_AGENT}
    url = f"{TRANSCRIPT_ENDPOINT}/{job_id}"
    deadline = time.monotonic() + POLL_TIMEOUT

    while True:
        request = Request(url, headers=headers, method="GET")
        body = _request_with_retries(request, context, "poll")
        data = json.loads(body)
        status = data.get("status")

        if status == "completed":
            return data
        if status == "error":
            raise SystemExit(f"AssemblyAI transcription failed: {data.get('error') or 'unknown error'}")
        if time.monotonic() > deadline:
            raise SystemExit("AssemblyAI transcription timed out")

        time.sleep(POLL_INTERVAL)


def _segments_from_utterances(data: dict) -> list[dict]:
    """One entry per speaker turn — {start, end, text, speaker}.

    `speaker` comes back as a bare letter ("A", "B") — spelled out to
    "Speaker A" here rather than in the frontend, so every consumer of this
    module's output (route.ts, any future script) sees the same label
    without duplicating the formatting.
    """
    out: list[dict] = []
    for u in data.get("utterances") or []:
        text = (u.get("text") or "").strip()
        if not text:
            continue
        speaker = u.get("speaker")
        out.append({
            "start": round((u.get("start") or 0) / 1000.0, 2),
            "end": round((u.get("end") or 0) / 1000.0, 2),
            "text": text,
            "speaker": f"Speaker {speaker}" if speaker else None,
        })

    if not out:
        full = (data.get("text") or "").strip()
        if full:
            out.append({"start": 0.0, "end": 0.0, "text": full, "speaker": None})

    return out


def transcribe_video(
    media_path: str,
    audio_out: Path,
    api_key: str | None = None,
) -> tuple[list[dict], str]:
    """Full flow: extract audio -> upload -> submit -> poll -> parse utterances.

    Returns (segments, "assemblyai"). Raises SystemExit on any failure. The
    second return value mirrors the old whisper.py's (segments, backend)
    shape so transcript.py's call site didn't need to change shape, just
    source module.
    """
    if api_key is None:
        api_key = load_api_key()
    if not api_key:
        raise SystemExit(NO_KEY_MESSAGE)

    print("[transcript] extracting audio for AssemblyAI…", file=sys.stderr)
    audio_path = extract_audio(media_path, audio_out)
    size_kb = audio_path.stat().st_size / 1024
    print(f"[transcript] audio: {size_kb:.0f} kB — uploading to AssemblyAI…", file=sys.stderr)

    context = ssl.create_default_context()
    upload_url = _upload_audio(api_key, audio_path, context)
    job_id = _submit_job(api_key, upload_url, context)
    print(f"[transcript] AssemblyAI job {job_id} submitted — polling for completion…", file=sys.stderr)
    data = _poll_job(api_key, job_id, context)

    segments = _segments_from_utterances(data)
    if not segments:
        raise SystemExit("AssemblyAI returned no transcript segments")

    print(f"[transcript] transcribed {len(segments)} speaker turns via AssemblyAI", file=sys.stderr)
    return segments, "assemblyai"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: assemblyai.py <media-path> [<audio-out.mp3>]", file=sys.stderr)
        raise SystemExit(2)

    media = sys.argv[1]
    audio_out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("audio.mp3")
    segments, backend = transcribe_video(media, audio_out)
    print(json.dumps({"backend": backend, "segments": segments}, indent=2))
