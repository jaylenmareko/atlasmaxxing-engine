// POST { url } -> { transcript } | { error }
//
// Thin Node wrapper around scripts/transcript.py (captions first, Whisper
// fallback). Deliberately synchronous: this runs on a real always-on Node
// server (Render Starter), not a serverless function, so a request that takes
// 30s-2min to download and transcribe is fine and needs no job queue.

import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

// Shelling out to yt-dlp/ffmpeg means this can never be edge or static.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "transcript.py");

// Generous: a long video with no captions is download + ffmpeg + a Whisper
// upload that itself retries on 429. Anything past this is stuck, not slow.
const TIMEOUT_MS = 5 * 60_000;

function pythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  // Windows ships a `python3` App Execution Alias that doesn't run Python at
  // all — it errors out and advertises the Microsoft Store — so `python` is
  // the only reliable name for local dev. The Docker image pins
  // PYTHON_BIN=python3 explicitly.
  return process.platform === "win32" ? "python" : "python3";
}

type ScriptResult = { transcript?: string; error?: string; source?: string };

function runScript(url: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    // argv array, not a shell string — the URL is passed as its own argument
    // and is never interpreted by a shell, so a hostile URL can't inject.
    //
    // turbopackIgnore: the binary name is resolved at runtime, so Turbopack's
    // static analysis can't tell what's being executed and conservatively
    // traces the entire project into the server bundle (its own warning says
    // so, and recommends this comment). We're spawning a system binary that
    // lives outside node_modules, so there is nothing for it to trace.
    const child = spawn(/* turbopackIgnore: true */ pythonBin(), [SCRIPT_PATH, url], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ error: "Transcript pull timed out. Try a shorter video." });
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      // Almost always "python not found" — worth saying so plainly rather
      // than surfacing a bare ENOENT to someone pasting a link.
      finish({
        error: `Could not start the transcript script (${err.message}). Is Python 3 installed on the server?`,
      });
    });

    child.on("close", () => {
      // The script prints diagnostics on stderr and exactly one JSON object
      // on stdout — but yt-dlp can still leak the odd line onto stdout, so
      // take the last non-empty line rather than the whole buffer.
      const lines = stdout.trim().split("\n").filter((l) => l.trim());
      const last = lines[lines.length - 1];
      if (!last) {
        const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        finish({ error: tail || "Transcript script produced no output." });
        return;
      }
      try {
        finish(JSON.parse(last) as ScriptResult);
      } catch {
        finish({ error: `Unexpected output from transcript script: ${last.slice(0, 200)}` });
      }
    });
  });
}

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Paste a video URL first." }, { status: 400 });
  }

  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Only http:// and https:// links are supported." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  const result = await runScript(trimmed);

  if (result.error || !result.transcript) {
    return NextResponse.json(
      { error: result.error || "No transcript could be extracted from that link." },
      { status: 502 },
    );
  }

  return NextResponse.json({ transcript: result.transcript, source: result.source });
}
