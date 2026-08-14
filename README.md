# Engine — frontend

Content-production canvas prototype for AtlasMaxxing/SwipeMaxx: character →
prompt → frame → new image → clip → video, laid out to match the team's
"V1 — Recreation Map" reference asset.

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000
```

The transcript pull (below) also needs `python3`, `ffmpeg` and `yt-dlp` on
PATH, plus a Whisper API key, or it will only work on videos that already
have captions.

> On Windows, `python3` is an App Execution Alias that doesn't actually run
> Python — the API route falls back to `python` there automatically. Set
> `PYTHON_BIN` to override.

## Transcript pull

The sidebar's source-video card takes a pasted Instagram/TikTok/YouTube URL
and fills the Transcript box:

```
POST /api/transcript  { "url": "..." }  ->  { "transcript": "...", "source": "captions" }
```

`scripts/transcript.py` does the work, in this order:

1. `yt-dlp --skip-download` → subtitles. Fast, no media bytes, **no API key
   needed**. Most YouTube links stop here.
2. No captions → `yt-dlp -f ba/b` (audio only) → `ffmpeg` (16 kHz mono mp3) →
   Groq/OpenAI Whisper. **Needs `GROQ_API_KEY` or `OPENAI_API_KEY`.**

Instagram and TikTok essentially never have captions, so in practice they
always take path 2 — a key is not optional for real use.

These scripts are trimmed copies of the repo-root `/watch` skill
(`.claude/skills/watch/scripts/`), with frame extraction removed. The Python
side is pure stdlib — no `pip install` step.

## Deploying (Render, Docker)

Everything repo-side is done — `Dockerfile`, `.dockerignore`, `render.yaml`,
the API route, `src/proxy.ts` (Basic Auth) and `/healthz`. What's left is
dashboard work:

1. In Render: **New → Blueprint**, pick this repo. It reads `render.yaml` and
   pre-fills the service (Docker runtime, Starter plan, health check path).
   No root-directory setting needed — this repo's root *is* the app.
2. It will prompt for the three secrets, because `render.yaml` declares them
   with `sync: false` (declared in git, values never in git):

   | Key | Why |
   |---|---|
   | `GROQ_API_KEY` | Whisper fallback. Preferred over OpenAI (faster, cheaper). |
   | `BASIC_AUTH_USER` | Site-wide login. |
   | `BASIC_AUTH_PASS` | Site-wide login. |

   `OPENAI_API_KEY` works instead of `GROQ_API_KEY` if you'd rather — the
   Python side checks Groq first, then OpenAI.

   > **If `BASIC_AUTH_USER`/`BASIC_AUTH_PASS` are unset, the site is public.**
   > The gate is skipped when they're missing so local dev doesn't prompt —
   > which means omitting them on Render leaves the deploy wide open.

3. Render's default `*.onrender.com` subdomain is fine; no custom domain
   needed. Share that URL + the shared password with whoever needs access;
   they install nothing.

> **Health check:** `/healthz` is deliberately exempt from Basic Auth. Render's
> health check sends no credentials, so a gated check would 401 and fail every
> deploy.

### There is no shared state

Deploying shares the *app*, not the *data*. There's no database: canvas layout
is `localStorage` (per browser), and the transcript, slot overrides, character
override and prompt edits are all in-memory per tab. Two people using the
deployed URL each get their own independent canvas and don't see each other's
work. Real collaboration would need actual persistence — that's a separate
build, not a config change.

### Known operational risk

yt-dlp is frequently blocked when it runs from datacenter IPs — YouTube in
particular serves "Sign in to confirm you're not a bot" to cloud hosts far
more often than to residential connections. It works reliably from a laptop
and may need cookies or a proxy from Render. If pulls start failing in
production but work locally, that's the first thing to check, not the code.

Rebuilding the image also re-fetches the latest yt-dlp (see `Dockerfile`),
which is usually the fix when a specific site breaks.
