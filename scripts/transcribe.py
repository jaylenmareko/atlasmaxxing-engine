#!/usr/bin/env python3
"""Shared post-processing for AssemblyAI transcript segments.

Used to also parse+dedupe WebVTT captions (a captions-first fast path that
was removed — see download.py's module docstring for why). What's left is
just what the AssemblyAI-only pipeline still needs: profanity substitution
and display formatting. AssemblyAI's diarized utterances already arrive
correctly segmented, punctuated, and cased per speaker turn, so there's no
dedupe/regroup step here — see censor_segments below.
"""
from __future__ import annotations

import re


# Deliberately a plain word list + regex, not a judgment call — per the ask,
# this doesn't need AI, just a substitution. Matches word-boundary-delimited
# and swallows a trailing "s"/"ing"/"er" etc. via the \w* so "fucking",
# "shitty", "asshole" all collapse to one bracketed tag rather than needing
# every inflected form listed.
_PROFANITY_WORDS = [
    "fuck", "shit", "bitch", "asshole", "cunt", "dick", "piss", "bastard",
    "whore", "slut", "damn", "goddamn",
]
_PROFANITY_RE = re.compile(r"\b(" + "|".join(re.escape(w) for w in _PROFANITY_WORDS) + r")\w*\b", re.IGNORECASE)


def censor_profanity(text: str) -> str:
    return _PROFANITY_RE.sub("[expletive]", text)


def censor_segments(segments: list[dict]) -> list[dict]:
    """Profanity substitution only — no dedupe, no regroup, no re-casing.

    AssemblyAI's diarized utterances already arrive as correctly segmented,
    punctuated turns, so there's nothing else to clean up here.
    """
    return [
        {**seg, "text": censor_profanity(seg["text"])}
        for seg in segments
        if seg.get("text", "").strip()
    ]


def format_plain(segments: list[dict]) -> str:
    """Flat prose — what promptValues.transcript (the editable text box) holds."""
    parts = [seg["text"].strip() for seg in segments if seg.get("text", "").strip()]
    return " ".join(parts).strip()


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    m, s = divmod(total, 60)
    return f"{m}:{s:02d}"


def to_display_segments(segments: list[dict]) -> list[dict]:
    """[{time, speaker, text}] — what the frontend's timestamped popup renders."""
    out = []
    for seg in segments:
        if not seg.get("text", "").strip():
            continue
        row = {"time": format_timestamp(seg["start"]), "text": seg["text"]}
        if seg.get("speaker"):
            row["speaker"] = seg["speaker"]
        out.append(row)
    return out
