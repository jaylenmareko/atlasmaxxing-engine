# Engine frontend — Next.js app that shells out to Python for transcript pulls.
#
# Single-stage on purpose. A multi-stage build would shave a few hundred MB by
# dropping the toolchain, at the cost of hand-maintaining which build outputs
# get copied forward. For a two-person internal tool on Render Starter, a
# build that can't silently miss a file is worth more than a smaller image.

FROM node:22-bookworm-slim

# python3 + ffmpeg are RUNTIME deps of scripts/transcript.py, not build deps:
# yt-dlp is a Python zipapp, and assemblyai.py shells out to ffmpeg to produce
# the 16kHz mono mp3 it uploads. curl/ca-certificates fetch yt-dlp below and
# carry the outbound TLS to the AssemblyAI API.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      ffmpeg \
      curl \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp as a standalone zipapp rather than `pip install yt-dlp` — keeps pip
# and a venv out of the image entirely (the Python side is pure stdlib).
#
# Defaults to the latest release ON PURPOSE: yt-dlp breaks whenever a site
# changes its player, so "whatever is newest at build time" is the behaviour
# you actually want from a rebuild. To pin, pass:
#   --build-arg YT_DLP_RELEASE=download/2025.09.26
ARG YT_DLP_RELEASE=latest/download
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/${YT_DLP_RELEASE}/yt-dlp" \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && yt-dlp --version

WORKDIR /app

# Deps first so a source-only change doesn't re-run npm ci. NODE_ENV is
# deliberately NOT set to production yet — the build needs typescript/tailwind
# from devDependencies.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Docker's python3 is the real one, unlike the Windows App Execution Alias the
# route falls back around in local dev.
ENV PYTHON_BIN=python3
# Render injects its own PORT; `next start` honours it. This is the local
# `docker run` default.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
