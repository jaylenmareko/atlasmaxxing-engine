// Production canvas — laid out to match the team's "V1 — Recreation Map" reference
// asset exactly: character + prompt templates on top, source video / script stack on
// the left, five FRAME -> NEW IMAGE -> CLIP rows, all converging into one VIDEO card
// on the right. Coordinates below are absolute pixel positions in a fixed 2000x1600
// design canvas (matches the reference asset's own proportions), not percentages —
// same approach the reference file itself uses (asset-rules.md: "Absolute nodes get
// positions computed in a fixed design space").
//
// The whole canvas is then scaled as ONE unit to fit whatever viewport is available
// (fit-to-screen, no scrolling) — same technique the reference asset itself uses:
// a fixed-px stage plus a JS transform:scale() fitter, per asset-rules.md.
//
// Everything that should be reviewable is a real button: thumbnails open a lightbox
// with approve/reject, prompt chips open an editable prompt panel.
//
// LAYOUT EDIT MODE: toggle it on, drag any block to where you want it, hit "Copy
// layout" — that dumps the current x/y of every block as JSON to your clipboard.
// Paste it back in chat and I bake those exact numbers into the constants below as
// the new source of truth. Dragging is disabled outside edit mode so it never
// fights with the click-to-review interactions.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  characters,
  getCharacter,
  type GenGroup,
  type ProjectData,
  type RowData,
} from "@/lib/data";

const CANVAS_W = 2000;
const CANVAS_H = 1850;

// Row thumbnails measured directly off the "V1 — Recreation Map" reference
// asset (pixel-measured against PROMPT_W, which stays fixed per that same
// reference) — THUMB_W/ROW_H bumped up from the old 105/185 so the DEFAULT
// layout reads as large as the reference, not just resizable-to-match via
// the rowsScale drag handle. 135x240 keeps the 9:16 phone-screenshot aspect
// ratio exactly. Every column X below is shifted right by the same amount
// the thumbnails grew, so the FRAME->PROMPT->NEWIMG->PROMPT->CLIP gaps stay
// identical to the old layout — only the thumbnails themselves got bigger.
const ROW_TOP = [500, 765, 1030, 1295, 1560];
const ROW_H = 240;
const FRAME_X = 425;
const THUMB_W = 135;
const PROMPT1_X = 622;
const PROMPT_W = 322;
const PROMPT_H = 40;
const NEWIMG_X = 1008;
const PROMPT2_X = 1205;
const CLIP_X = 1591;
const VIDEO_X = 1795;
const VIDEO_W = 175;
const VIDEO_H = 290;
const VIDEO_TOP = 1005; // re-centered vertically on the taller 5-row block

const rowCenter = (i: number) => ROW_TOP[i] + ROW_H / 2;

type Column = "frame" | "newimage" | "clip";

// RowData/GenGroup and the actual row content live in src/lib/data.ts now —
// this canvas renders whichever project's rows were passed in as a prop,
// not a single hardcoded set.

const genGroupStyle: Record<GenGroup, { label: string; color: string }> = {
  NEW: { label: "New", color: "var(--coral-deep)" },
  CONT: { label: "Continuation", color: "var(--violet)" },
  SAME: { label: "Same image", color: "var(--green)" },
};

function imagePromptFor(row: RowData) {
  return `Using the character from the reference image, he ${row.action} in ${row.environment}, squared to camera, filling the central two-thirds of a vertical frame. No extra fingers, no changes to wardrobe or face.`;
}
function animationPromptFor(row: RowData) {
  return `As he speaks, he says: "${row.line}" Natural movement. No camera movement. Natural background audio, no music, no sound effects.`;
}

// Prompt 4 is project-level, not per-row like the image/animation prompts
// above, so it takes the project rather than a row.
//
// There used to be a "Prompt 1" chip here too, holding placeholder text that
// described pulling a transcript out of the source video. That job is now
// real and automatic: the source card takes a pasted URL and calls
// /api/transcript (yt-dlp audio -> AssemblyAI, with speaker diarization),
// writing the result straight into the Transcript box. A prompt chip
// describing the work is
// redundant once the work actually happens, so the chip and its
// scriptPromptFor() placeholder are gone.
//
// SPEC NOTE — still not implemented: Prompt 4's own job. It takes the
// Transcript box's content as INPUT, combined with whatever the user typed
// into Prompt 4's modal (promptValues under the "prompt4" key), and produces
// a new SCRIPT as output — not a new transcript. The Transcript box is
// upstream of Prompt 4. No generation logic exists for that yet.
function newScriptPromptFor(project: ProjectData) {
  return `Using the same character, tone, and recreation format as "${project.title}", write the next script in the series — same structure, a different angle or example than what's already been covered.`;
}

// One timestamped line of a transcript, as returned by /api/transcript's
// `segments` field. Kept separate from the flat `transcript` string (which
// still drives promptValues.transcript / the free-text editor) so the
// popup below can render real per-line timestamps instead of one blob.
// `speaker` is only present when the source diarized — the AssemblyAI
// fallback path labels each turn "Speaker A"/"Speaker B"/etc; captions (no
// diarization info at all) omit it, and the popup below just skips the label
// for those rows rather than showing a fake/blank one.
type TranscriptSegment = { time: string; speaker?: string; text: string };

// "source" is no longer a lightbox kind — the source-video card handles its
// own URL input / Go / Remove inline, so it never opens a lightbox at all.
type LightboxKind = "row" | "character" | "video";
type LightboxState = { key: string; src: string; label: string; row: number; column: Column; kind: LightboxKind } | null;

// ---- row/video slot overrides (session state, same lifetime as
// characterOverrideId below — no backend, no persistence) ----
// Every FRAME/NEW IMAGE/CLIP slot in every row, plus the video output card,
// can be replaced or cleared. Keyed by `${column}-${row}` for row slots
// ("frame-0", "clip-3", ...) or the literal string "video" for the video
// card — see slotKeyFor. Absent key = use the project's own default image;
// {removed:true} = cleared to an empty "+" slot; {src} = replaced.
type SlotOverride = { src: string } | { removed: true };
// row is -1 for the project-level kinds ("prompt4"/"transcript"), same -1
// convention openLightbox already uses for non-row lightboxes.
// "transcript" isn't really a prompt — it's the Transcript box's own text,
// made editable through this same modal chrome rather than a bespoke one.
type PromptModalState = { key: string; row: number; kind: "image" | "animation" | "prompt4" | "transcript"; value: string } | null;

// ---- wire endpoint overrides (edit-mode only, session state) ----
// A wire's "attached to" end can be dragged onto a different prompt chip.
// Scoped to whichever prompt element it lands on — row + which of the two
// prompt columns (image vs animation) — since that's the only kind of
// target any reattachable wire on this canvas makes sense pointing at
// (script-loop and char-prompt both use this same mechanism, generically).
type PromptRef = { row: number; kind: "image" | "animation" };
type WireOverride = { end: PromptRef };

// ---- draggable block positions (edit-mode only) ----
type Pt = { x: number; y: number };
type BlockId = "character" | "sidebar" | "video" | "rows";

const defaultBlocks: Record<BlockId, Pt> = {
  character: { x: 930, y: 15 },
  sidebar: { x: 25, y: 415 },
  video: { x: VIDEO_X, y: VIDEO_TOP },
  rows: { x: 0, y: 0 }, // all 5 FRAME/NEW IMAGE/CLIP rows move as one group —
                        // this is a shared delta, not an absolute position like
                        // the other blocks, added on top of each row's own base
                        // coordinates (ROW_TOP[i], FRAME_X, etc.)
};

// ---- draggable block SIZES (edit-mode only) ----
type Size = { w: number; h: number };
type SizableId = "character" | "video" | "sidebar" | "sidebarPrompt4";

const defaultSizes: Record<SizableId, Size> = {
  character: { w: 150, h: 210 },
  video: { w: VIDEO_W, h: VIDEO_H },
  sidebar: { w: 255, h: 0 }, // height is content-driven (image aspect ratio +
                             // text stack below it), not a manual dimension —
                             // only width is actually wired up to the resize
                             // handle for this one, see resizeBlock below.
  sidebarPrompt4: { w: 255, h: 40 },
};
const MIN_SIZE = { w: 80, h: 60 };
const MAX_SIZE = { w: 700, h: 700 };

// The sidebar's two wire-origin points (fan-out into the rows, and the
// script-loop back into row 5) sit inside its own text/image stack, not at a
// fixed offset — so they're derived from the live width instead of a
// hardcoded pixel number, using the same math the JSX layout below produces:
// header row + footer row (fixed chrome) + the aspect-[4/5] image (scales
// with width) gets you to the bottom of the source-video card; everything
// below that (arrows, prompt chips, transcript box) has width-independent
// height, so it's just a constant added on top.
const SB_CARD_CHROME = 75.25; // calibrated so fanY lands on 394 at the original 255px default
// SB_CARD_CHROME + the aspect-[4/5] image is what makes sbCardH, and sbCardH
// is where the fan-out wires originate. The source card no longer renders an
// image at all (it's a URL input now), so it is pinned to exactly sbCardH
// instead — keeping the wire origin, and everything stacked below it, on the
// same calibration rather than re-deriving the whole sidebar around a
// smaller card.
//
// Below the card, Prompt 4 is independently resizable
// (sizes.sidebarPrompt4), so its height can't be baked into one lump
// constant the way the old fixed-size pills were — only the stack parts that
// DON'T resize (the arrow gaps, the transcript box, the "New Script" pill)
// get a constant each; the prompt chip's live height gets added on top of
// these where the component actually derives its sidebar Y offsets.
const SB_ARROW_H = 18; // one ArrowGap's own rendered height — measured via getBoundingClientRect, exact
// Transcript box's height, used both as its own minHeight (below, in the
// JSX) and here for the Y-offset math — same value on both ends so they
// can't drift apart. A previous version of this constant was a guess at
// the box's *content-driven* height (no explicit minHeight existed yet),
// and that guess being wrong by ~33 units left the Prompt 4 resize handle
// ~24px below its actual chip — dragging it looked like it did nothing,
// when the real bug was just a stale measurement. Giving the box an actual
// minHeight instead of leaving it fully content-driven removes most of
// that drift risk; a transcript long enough to exceed this still grows the
// box taller than SB_TRANSCRIPT_H says, so the same class of drift can
// still happen on an unusually long transcript — just far less likely now.
// Bumped 140 -> 200 alongside the box's own size increase (bigger padding +
// font); keep these two in lockstep if the box changes size again.
const SB_TRANSCRIPT_H = 200;
const SB_NEWSCRIPT_H = 40; // "New Script" outline pill's rendered height

// ---- rows group SCALE (edit-mode only) ----
// The 5 FRAME/NEW IMAGE/CLIP rows move as one group already (blocks.rows);
// rowsScale grows/shrinks that whole group as one unit, anchored at its own
// top-left corner (first row, Frame column) so it scales outward instead of
// sliding toward the canvas origin.
const ROWS_ORIGIN_X = FRAME_X;
const ROWS_ORIGIN_Y = ROW_TOP[0];
const ROWS_BASE_W = CLIP_X + THUMB_W - FRAME_X;
const ROWS_BASE_H = ROW_TOP[4] + ROW_H - ROW_TOP[0];
const MIN_ROWS_SCALE = 0.5;
const MAX_ROWS_SCALE = 2;

// bumped so any already-saved layout with blocks dragged/resized far off
// canvas (the "things going blank at the top" report) gets dropped instead
// of loading back in broken — everyone just starts from defaults again.
// v6: saved shape gained wireOverrides (reattached wire endpoints).
// v7: sizes gained sidebarPrompt1/sidebarPrompt4 — an old save's `sizes`
// object loading in without them would crash the first render that reads
// sizes.sidebarPrompt1.h, so this has to bump too, not just be additive.
// v8: Prompt 1 removed, so sizes.sidebarPrompt1 is gone. A stale v7 entry
// wouldn't crash (the extra key is simply never read), but it would restore
// a sidebar laid out around a chip that no longer exists — cleaner to start
// those sessions from defaults than to half-restore a dead layout.
const LAYOUT_STORAGE_KEY = "engine.production.layout.v8";

const DEFAULT_SCALE = 0.72;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.4;

export default function ProductionCanvas({ project }: { project: ProjectData }) {
  const rows = project.rows;

  // Character "Replace" override — project data is static/imported, not
  // writable, so this lives as in-memory session state here rather than
  // touching project.* — reload the page and it's gone, same lifetime as
  // everything else on this canvas that isn't in localStorage.
  const [characterOverrideId, setCharacterOverrideId] = useState<string | null>(null);
  const character = getCharacter(characterOverrideId ?? project.characterId);
  const [slotOverrides, setSlotOverrides] = useState<Record<string, SlotOverride>>({});

  // Source video: a pasted URL, not a picked library item. sourceUrl is the
  // committed one (drives the filled-vs-empty card); urlDraft is what's in
  // the text input before Go. Same session-only lifetime as the above.
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [transcriptStatus, setTranscriptStatus] = useState<"idle" | "loading" | "error">("idle");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  // Segments from the most recent real pull — null until one succeeds (or
  // after a hand-edit invalidates it, see saveModalPrompt), in which case the
  // popup falls back to showing promptValues.transcript as one untimed block.
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[] | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [promptModal, setPromptModal] = useState<PromptModalState>(null);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});

  const [editMode, setEditMode] = useState(false);
  const [blocks, setBlocks] = useState<Record<BlockId, Pt>>(defaultBlocks);
  const [sizes, setSizes] = useState<Record<SizableId, Size>>(defaultSizes);
  const [rowsScale, setRowsScale] = useState(1);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // wires are draggable too — each one stores a bend offset FROM its own
  // natural midpoint (not an absolute point), so it stays sane as the blocks
  // it connects move around.
  const [wireBends, setWireBends] = useState<Record<string, Pt>>({});
  const moveWire = (key: string, dx: number, dy: number) =>
    setWireBends((prev) => {
      const cur = prev[key] ?? { x: 0, y: 0 };
      return { ...prev, [key]: { x: cur.x + dx / scale, y: cur.y + dy / scale } };
    });

  // wire ENDPOINTS are separately re-attachable — dragging one off its
  // default/overridden target and dropping it on a different prompt chip
  // rewires what the wire actually connects to (not just its visual bend).
  // wireOverrides is the committed state (persisted); wireDragEnd is the
  // live, uncommitted position while a drag is in flight (not persisted —
  // it either resolves into a wireOverrides commit or is discarded on drop).
  const [wireOverrides, setWireOverrides] = useState<Record<string, WireOverride>>({});
  const [wireDragEnd, setWireDragEnd] = useState<{ id: string; x: number; y: number } | null>(null);
  const moveWireEnd = (id: string, dx: number, dy: number) =>
    setWireDragEnd((prev) => (prev && prev.id === id ? { id, x: prev.x + dx / scale, y: prev.y + dy / scale } : prev));

  // background pan: click-drag anywhere that isn't a block scrolls the canvas,
  // same gesture as Figma/Miro's grab-to-pan. Native scrollbars + wheel/trackpad
  // still work too, since the container is a real overflow:auto element.
  const panState = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [panning, setPanning] = useState(false);
  // manual double-click timing — PointerEvent.detail is NOT a reliable click-count
  // across browsers (unlike MouseEvent.detail), so e.detail===2 silently never
  // fired. Track the last down ourselves instead.
  const lastDown = useRef<{ time: number; x: number; y: number } | null>(null);

  const onBgPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editMode) return;
    const target = e.target as HTMLElement;
    if (!target.dataset.panBg) return; // only pan when the click lands on empty canvas
    // stop this becoming a native text/element selection drag
    e.preventDefault();

    const now = performance.now();
    const prev = lastDown.current;
    const isDoubleClick = !!prev && now - prev.time < 400 && Math.abs(e.clientX - prev.x) < 12 && Math.abs(e.clientY - prev.y) < 12;
    lastDown.current = { time: now, x: e.clientX, y: e.clientY };
    if (!isDoubleClick) return; // this was just the first click — record it and wait

    lastDown.current = null; // consume it, so a 3rd click starts a fresh pair, not a 2nd pan
    const el = wrapRef.current;
    if (!el) return;
    panState.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    setPanning(true);
    try { el.setPointerCapture(e.pointerId); } catch { /* no active pointer session — safe to ignore */ }
  };
  const onBgPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el || !panState.current) return;
    el.scrollLeft = panState.current.scrollLeft - (e.clientX - panState.current.startX);
    el.scrollTop = panState.current.scrollTop - (e.clientY - panState.current.startY);
  };
  const onBgPointerUp = () => {
    panState.current = null;
    setPanning(false);
  };

  const zoomBy = (factor: number) => setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));

  // scroll-wheel / trackpad-pinch zoom, centered on the cursor. Attached as a
  // native (non-passive) listener because React's synthetic onWheel is passive
  // by default, which silently drops preventDefault() and lets the page scroll
  // instead of zooming.
  const CANVAS_PAD = 200;
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scroll/trackpad pan stays native
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setScale((s) => {
        const pointX = (el.scrollLeft + cx - CANVAS_PAD) / s;
        const pointY = (el.scrollTop + cy - CANVAS_PAD) / s;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (e.deltaY < 0 ? 1.09 : 1 / 1.09)));
        pendingScroll.current = { left: pointX * next + CANVAS_PAD - cx, top: pointY * next + CANVAS_PAD - cy };
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // apply the cursor-anchored scroll position after a wheel-zoom re-renders
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !pendingScroll.current) return;
    el.scrollLeft = pendingScroll.current.left;
    el.scrollTop = pendingScroll.current.top;
    pendingScroll.current = null;
  }, [scale]);

  // load any layout saved from a previous session, once, on mount
  useEffect(() => {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        blocks: Record<BlockId, Pt>;
        sizes?: Record<SizableId, Size>;
        rowsScale?: number;
        wireBends?: Record<string, Pt>;
        wireOverrides?: Record<string, WireOverride>;
      };
      if (saved.blocks) setBlocks(saved.blocks);
      if (saved.sizes) setSizes(saved.sizes);
      if (saved.rowsScale) setRowsScale(saved.rowsScale);
      if (saved.wireBends) setWireBends(saved.wireBends);
      if (saved.wireOverrides) setWireOverrides(saved.wireOverrides);
    } catch {
      // corrupted/old-shape localStorage entry — ignore, keep defaults
    }
  }, []);

  // Autosave — every drag/resize/rewire lands in localStorage on its own,
  // debounced so a drag doesn't write on every pixel of movement; the
  // manual "Save" button below becomes a redundant no-op rather than the
  // only way to persist. Writes the exact same shape saveLayout() does.
  // Runs after the load-effect above (declared later = runs later within
  // the same mount), so on first mount it can momentarily capture the
  // pre-load default state and schedule a write of *that* — but debounce +
  // clearing the previous timeout on every dependency change means only
  // the last write in a burst ever lands, and the load effect's setState
  // calls re-run this effect (new blocks/sizes/etc. reference) well within
  // the debounce window, canceling that stale write before it can fire.
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ blocks, sizes, rowsScale, wireBends, wireOverrides }));
    }, 400);
    return () => window.clearTimeout(id);
  }, [blocks, sizes, rowsScale, wireBends, wireOverrides]);

  const openLightbox = (row: number, column: Column, src: string, label: string, kind: LightboxKind = "row") => {
    setReplaceOpen(false);
    setLightbox({ key: `${column}-${row}-${kind}`, src, label, row, column, kind });
  };

  const openPrompt = (row: number, kind: "image" | "animation") => {
    const key = `${kind}-${row}`;
    const fallback = kind === "image" ? imagePromptFor(rows[row]) : animationPromptFor(rows[row]);
    setPromptModal({ key, row, kind, value: promptValues[key] ?? fallback });
  };

  // Prompt 4 is project-level, not per-row — key is just the kind itself (no
  // "-{row}" suffix), which can't collide with the row-keyed image/animation
  // entries above.
  const openNewScriptPrompt = () =>
    setPromptModal({
      key: "prompt4",
      row: -1,
      kind: "prompt4",
      value: promptValues.prompt4 ?? newScriptPromptFor(project),
    });

  // Transcript box is directly editable — its "prompt" IS the transcript
  // text itself, not a template describing how to generate one, so this
  // opens the same modal pre-filled with the transcript.
  const openTranscript = () =>
    setPromptModal({ key: "transcript", row: -1, kind: "transcript", value: promptValues.transcript ?? project.transcript });

  // The real Prompt-1-replacement: paste a URL, hit Go, get a transcript.
  // Writes into promptValues.transcript — the exact key the Transcript box
  // renders from and its edit modal reads/writes — so the result lands in
  // the box immediately with no extra confirm step.
  const runTranscriptPull = async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) {
      setTranscriptError("Paste a video URL first.");
      setTranscriptStatus("error");
      return;
    }
    setSourceUrl(url);
    setTranscriptStatus("loading");
    setTranscriptError(null);
    try {
      const res = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => null)) as
        | { transcript?: string; segments?: TranscriptSegment[]; error?: string }
        | null;
      if (!res.ok || !data?.transcript) {
        throw new Error(data?.error || `Transcript pull failed (${res.status})`);
      }
      setPromptValues((prev) => ({ ...prev, transcript: data.transcript as string }));
      setTranscriptSegments(data.segments && data.segments.length ? data.segments : null);
      setTranscriptStatus("idle");
    } catch (err) {
      // Keep sourceUrl set on failure — the card stays in its filled state so
      // Go is still there to retry with, which is the whole reason Go is
      // persistent rather than empty-state-only.
      setTranscriptError(err instanceof Error ? err.message : "Transcript pull failed.");
      setTranscriptStatus("error");
    }
  };

  const clearSourceVideo = () => {
    setSourceUrl(null);
    setUrlDraft("");
    setTranscriptStatus("idle");
    setTranscriptError(null);
    // Deliberately does NOT wipe promptValues.transcript: the text may have
    // been hand-edited since the pull, and silently deleting someone's edits
    // is a worse failure than leaving a stale transcript they can overwrite.
  };

  const toggleApproved = (key: string) =>
    setApproved((prev) => ({ ...prev, [key]: !prev[key] }));

  const saveModalPrompt = () => {
    if (!promptModal) return;
    setPromptValues((prev) => ({ ...prev, [promptModal.key]: promptModal.value }));
    // A hand-edit can no longer be trusted to line up with the last real
    // pull's per-line timestamps — fall back to showing the edited text as
    // one untimed block rather than pairing stale times with new words.
    if (promptModal.kind === "transcript") setTranscriptSegments(null);
    setPromptModal(null);
  };

  // No bound on how far a block can drag — the canvas pans/zooms freely, so
  // "off canvas" isn't actually off anything the user can't reach. (A clamp
  // lived here briefly to fix wires vanishing at the edge, but that turned
  // out to be the wrong fix — it just made drags stop dead well within
  // visibly open canvas space. The actual fix is overflow:visible on the
  // wire SVG below, which doesn't need a clamp at all.)
  const moveBlock = (id: BlockId, dx: number, dy: number) =>
    setBlocks((prev) => ({ ...prev, [id]: { x: prev[id].x + dx / scale, y: prev[id].y + dy / scale } }));

  const resizeBlock = (id: SizableId, dw: number, dh: number) =>
    setSizes((prev) => {
      const cur = prev[id];
      return {
        ...prev,
        [id]: {
          w: Math.min(MAX_SIZE.w, Math.max(MIN_SIZE.w, cur.w + dw / scale)),
          // sidebar's height is content-driven, not a manual dimension — track
          // the drag anyway (harmless, just unused) so the handle still feels
          // responsive to both axes, but every other block clamps normally.
          h: Math.min(MAX_SIZE.h, Math.max(MIN_SIZE.h, cur.h + dh / scale)),
        },
      };
    });

  // rows resize as one uniform group scale, not independent w/h, since every
  // column position and gap in the group is derived from the same multiplier
  // (see ROWS_BASE_W/H above) — averaging the two drag axes keeps a diagonal
  // drag feeling proportional either way.
  const resizeRows = (dw: number, dh: number) => {
    const fracW = dw / scale / ROWS_BASE_W;
    const fracH = dh / scale / ROWS_BASE_H;
    setRowsScale((s) => Math.min(MAX_ROWS_SCALE, Math.max(MIN_ROWS_SCALE, s + (fracW + fracH) / 2)));
  };

  const resetLayout = () => {
    setBlocks(defaultBlocks);
    setSizes(defaultSizes);
    setRowsScale(1);
    setWireBends({});
    setWireOverrides({});
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  };

  const saveLayout = () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ blocks, sizes, rowsScale, wireBends, wireOverrides }));
    setSaveStatus("saved");
    window.setTimeout(() => setSaveStatus("idle"), 2000);
  };

  const copyLayout = async () => {
    const payload = {
      blocks: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, { x: Math.round(v.x), y: Math.round(v.y) }])),
      sizes: Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, { w: Math.round(v.w), h: Math.round(v.h) }])),
      rowsScale: Math.round(rowsScale * 100) / 100,
      wireBends: Object.fromEntries(Object.entries(wireBends).map(([k, v]) => [k, { x: Math.round(v.x), y: Math.round(v.y) }])),
      wireOverrides,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard permission can fail silently in some contexts — the panel below
      // still shows the text to copy by hand
    }
    setCopyStatus("copied");
    window.setTimeout(() => setCopyStatus("idle"), 2000);
  };

  const sb = blocks.sidebar, ch = blocks.character, vid = blocks.video, ro = blocks.rows;
  const chSize = sizes.character, vidSize = sizes.video, sbSize = sizes.sidebar;

  // sidebar's two wire-origin points, derived from its live width AND (below
  // the card) the resizable Prompt 4 chip's live height — see the
  // SB_CARD_CHROME/SB_ARROW_H/etc constants above for the fixed-chrome parts.
  //
  // sbCardH / sbFanY are untouched by the Prompt 1 removal: the fan-out wires
  // originate at the bottom of the source card, which is above where Prompt 1
  // used to sit. Only the stack BELOW the card shifts up — the Transcript box
  // now follows the card after a single arrow gap, where Prompt 1 + a second
  // gap used to intervene.
  const sbCardH = SB_CARD_CHROME + sbSize.w * (5 / 4);
  const sbFanY = sb.y + sbCardH;
  const sidebarPrompt4Size = sizes.sidebarPrompt4;
  const transcriptTop = sbFanY + SB_ARROW_H;
  const sidebarPrompt4Top = transcriptTop + SB_TRANSCRIPT_H + SB_ARROW_H;
  const sbScriptY = sidebarPrompt4Top + sidebarPrompt4Size.h + SB_ARROW_H; // top of the "New Script" pill

  // rows group scales as one unit from its own top-left corner (see
  // ROWS_ORIGIN_X/Y above) — every column position, row spacing, and
  // thumb/prompt-chip size reads off these instead of the raw constants.
  const rowScaledX = (baseX: number) => ROWS_ORIGIN_X + (baseX - ROWS_ORIGIN_X) * rowsScale + ro.x;
  const rowScaledTop = (i: number) => ROWS_ORIGIN_Y + (ROW_TOP[i] - ROWS_ORIGIN_Y) * rowsScale + ro.y;
  const thumbW_s = THUMB_W * rowsScale;
  const rowH_s = ROW_H * rowsScale;
  const promptW_s = PROMPT_W * rowsScale;
  const promptH_s = PROMPT_H * rowsScale;
  const rowScaledCenter = (i: number) => rowScaledTop(i) + rowH_s / 2;

  // Where a prompt chip actually sits, for wires that attach to one —
  // reused for both the default/overridden endpoint position AND the
  // reattach hit-test below, so "what a wire points at" and "what you can
  // drop it on" can never drift apart.
  const promptChipRect = (row: number, kind: "image" | "animation") => {
    const left = rowScaledX(kind === "image" ? PROMPT1_X : PROMPT2_X);
    const top = rowScaledTop(row) + (rowH_s - promptH_s) / 2;
    return { left, top, width: promptW_s, height: promptH_s };
  };
  const promptChipAttachPoint = (row: number, kind: "image" | "animation") => {
    const r = promptChipRect(row, kind);
    // matches the reference asset's own script-loop wire, which lands
    // slightly left-of-center on the target prompt's bottom edge, not dead
    // center — see asset-measured coords in the commit that added this.
    return { x: r.left + r.width * 0.45, y: r.top + r.height };
  };

  // Hit-test a drop point (canvas coords) against every prompt chip, with a
  // little slack so you don't have to land pixel-perfect inside the box.
  const HIT_PAD = 18;
  const promptChipAt = (x: number, y: number): PromptRef | null => {
    for (let row = 0; row < rows.length; row++) {
      for (const kind of ["image", "animation"] as const) {
        const r = promptChipRect(row, kind);
        if (x >= r.left - HIT_PAD && x <= r.left + r.width + HIT_PAD && y >= r.top - HIT_PAD && y <= r.top + r.height + HIT_PAD) {
          return { row, kind };
        }
      }
    }
    return null;
  };

  // Every reattachable wire follows the same shape: a committed target (row
  // + prompt kind) read from wireOverrides, falling back to a hardcoded
  // default when nothing's been dragged yet, with the live drag position
  // taking over mid-gesture. char-prompt and script-loop are two instances
  // of this one pattern, not two bespoke implementations.
  const charPromptTarget = wireOverrides["char-prompt"]?.end ?? { row: 0, kind: "image" as const };
  const charPromptEnd =
    wireDragEnd?.id === "char-prompt"
      ? { x: wireDragEnd.x, y: wireDragEnd.y }
      : promptChipAttachPoint(charPromptTarget.row, charPromptTarget.kind);

  const scriptLoopTarget = wireOverrides["script-loop"]?.end ?? { row: 4, kind: "animation" as const };
  const scriptLoopEnd =
    wireDragEnd?.id === "script-loop"
      ? { x: wireDragEnd.x, y: wireDragEnd.y }
      : promptChipAttachPoint(scriptLoopTarget.row, scriptLoopTarget.kind);

  const wireDefs: { id: string; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: string; reattachable?: boolean }[] = [
    {
      // was hardcoded to the floating "Prompt 2 · Image" callout card (now
      // removed — it was just a static copy of what every row's image
      // prompt chip already shows). Defaults to row 1's image prompt;
      // re-attachable via the same wireOverrides/promptChipAttachPoint
      // pattern script-loop uses below, not a one-off.
      id: "char-prompt", x1: ch.x + 20, y1: ch.y + chSize.h + 33, x2: charPromptEnd.x, y2: charPromptEnd.y,
      color: "var(--coral)", width: 5, reattachable: true,
    },
    ...rows.map((_, i) => ({
      id: `fan-${i}`, x1: sb.x + sbSize.w, y1: sbFanY, x2: rowScaledX(FRAME_X), y2: rowScaledCenter(i),
      color: "var(--faint)", width: 3.2,
    })),
    ...rows.map((_, i) => ({
      id: `conv-${i}`, x1: rowScaledX(CLIP_X) + thumbW_s, y1: rowScaledCenter(i), x2: vid.x, y2: vid.y + vidSize.h / 2,
      color: "var(--coral)", width: 4.5,
    })),
    {
      // was hardcoded to row 5's New Image thumbnail corner — wrong target,
      // confirmed against the reference asset: this loop is "new script
      // feeds the animation prompt" (Prompt 3 literally says the {line}),
      // so it belongs on row 5's ANIMATION prompt chip, not the image edge.
      // Endpoint now also reads from wireOverrides so it's re-attachable —
      // see WireEndpointHandle below.
      id: "script-loop", x1: sb.x + sbSize.w, y1: sbScriptY, x2: scriptLoopEnd.x, y2: scriptLoopEnd.y,
      color: "var(--blue)", width: 4.5, dash: "2 8", reattachable: true,
    },
  ];

  const dropWireEnd = (id: string) => {
    const drag = wireDragEnd;
    setWireDragEnd(null);
    if (!drag || drag.id !== id) return;
    const hit = promptChipAt(drag.x, drag.y);
    if (hit) setWireOverrides((prev) => ({ ...prev, [id]: { end: hit } }));
    // no hit — snap back to whatever was already committed (override or default)
  };

  // Generalized Replace/Remove for every row slot + the video card — one
  // picker implementation shared by all three remaining kinds (character,
  // row, video) instead of a copy of the same grid per kind.
  const slotKeyFor = (lb: { kind: LightboxKind; column: Column; row: number }) =>
    lb.kind === "video" ? "video" : `${lb.column}-${lb.row}`;

  const slotSrc = (key: string, defaultSrc: string): string | null => {
    const o = slotOverrides[key];
    if (!o) return defaultSrc;
    return "removed" in o ? null : o.src;
  };

  const replaceLabelFor = (kind: LightboxKind) => {
    if (kind === "character") return "character";
    if (kind === "video") return "video";
    return "image";
  };

  type PickerOption = { key: string; src: string; label: string; active: boolean };

  const pickerOptionsFor = (lb: NonNullable<LightboxState>): PickerOption[] => {
    if (lb.kind === "character") {
      return characters.map((c) => ({
        key: c.id, src: c.photo, label: c.name, active: (characterOverrideId ?? project.characterId) === c.id,
      }));
    }
    // Rows + video share one reuse pool — there's no dedicated media library
    // per slot type yet, so this is placeholder reuse (other rows' own
    // frame / new-image renders), not a real asset picker.
    const key = slotKeyFor(lb);
    const ov = slotOverrides[key];
    const currentSrc = ov && !("removed" in ov) ? ov.src : undefined;
    const pool = lb.column === "frame"
      ? rows.map((r, i) => ({ key: `frame-${i}`, src: r.frame, label: `Row ${i + 1} frame` }))
      : rows.map((r, i) => ({ key: `newimage-${i}`, src: r.newImage, label: `Row ${i + 1} image` }));
    return pool.map((p) => ({ ...p, active: currentSrc === p.src }));
  };

  const applyReplace = (lb: NonNullable<LightboxState>, opt: PickerOption) => {
    if (lb.kind === "character") { setCharacterOverrideId(opt.key); return; }
    setSlotOverrides((prev) => ({ ...prev, [slotKeyFor(lb)]: { src: opt.src } }));
  };

  const removeSlot = (lb: NonNullable<LightboxState>) =>
    setSlotOverrides((prev) => ({ ...prev, [slotKeyFor(lb)]: { removed: true } }));

  const videoSrc = slotSrc("video", "/thumbs/video-output.jpg");
  // Editing via the modal below updates this directly, same as project.transcript
  // would — the Transcript box's own displayed text and the modal's initial
  // value are the same source of truth (promptValues.transcript falling back
  // to the project's default), so an edit actually sticks visually.
  const transcriptText = promptValues.transcript ?? project.transcript;
  // The popup always has SOMETHING to render as rows: real per-line
  // timestamps from the last pull when they exist, or the flat text as one
  // untimed block (the placeholder project.transcript, or a hand-edit that
  // invalidated the last pull's segments — see saveModalPrompt).
  const transcriptDisplaySegments: TranscriptSegment[] =
    transcriptSegments ?? (transcriptText ? [{ time: "", text: transcriptText }] : []);

  // Shared picker grid — reused both for the toggle-based Replace flow
  // (character/source/video) and the always-open picker an empty row slot
  // shows immediately (see the lightbox render below), so there's one
  // implementation of "pick from the options" instead of two.
  const pickerGrid = lightbox && (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {pickerOptionsFor(lightbox).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => {
            applyReplace(lightbox, opt);
            setReplaceOpen(false);
            setLightbox(null);
          }}
          className="overflow-hidden rounded-lg border-2 text-left transition-transform hover:scale-[1.03]"
          style={{ borderColor: opt.active ? "var(--coral)" : "var(--node-line)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={opt.src} alt={opt.label} className="h-20 w-full object-cover" />
          <div className="truncate px-1.5 py-1 text-[10px] font-bold" style={{ color: opt.active ? "var(--coral)" : "var(--ink)" }}>
            {opt.label}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* project breadcrumb — confirms which project is actually loaded, and
          gets you back to the list of every other one */}
      <div className="absolute left-4 top-4 z-40 flex items-center gap-2 rounded-lg border bg-node px-3 py-2 shadow" style={{ borderColor: "var(--node-line)" }}>
        <Link href="/library" className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
          ← Library
        </Link>
        <span style={{ color: "var(--node-line)" }}>/</span>
        <span className="max-w-[220px] truncate text-[12px] font-semibold" style={{ color: "var(--ink)" }}>{project.title}</span>
      </div>

      {/* edit-mode / view controls — fixed to the viewport, outside the scrollable canvas */}
      <div className="absolute right-4 top-4 z-40 flex items-center gap-2">
        {editMode && (
          <>
            <button type="button" onClick={resetLayout} className="rounded-lg border bg-node px-3 py-2 text-[12px] font-semibold shadow" style={{ borderColor: "var(--node-line)" }}>
              Reset layout
            </button>
            <button type="button" onClick={copyLayout} className="rounded-lg border bg-node px-3 py-2 text-[12px] font-semibold shadow" style={{ borderColor: "var(--node-line)" }}>
              {copyStatus === "copied" ? "Copied ✓" : "Copy layout"}
            </button>
            <button type="button" onClick={saveLayout} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white shadow" style={{ background: "var(--green)" }}>
              {saveStatus === "saved" ? "Saved ✓" : "Save"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className="rounded-lg px-3 py-2 text-[12px] font-semibold shadow"
          style={{ background: editMode ? "var(--coral)" : "var(--node)", color: editMode ? "#fff" : "var(--ink)", border: editMode ? "none" : "1px solid var(--node-line)" }}
        >
          {editMode ? "Editing layout — drag blocks" : "Edit layout"}
        </button>
      </div>

      {/* zoom controls */}
      <div className="absolute left-4 top-16 z-40 flex items-center gap-1 rounded-lg border bg-node p-1 shadow" style={{ borderColor: "var(--node-line)" }}>
        <button type="button" onClick={() => zoomBy(1 / 1.15)} className="grid h-7 w-7 place-items-center rounded-md text-[15px] font-bold" style={{ color: "var(--ink)" }}>−</button>
        <span className="w-11 text-center font-mono text-[11px]" style={{ color: "var(--muted)" }}>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.15)} className="grid h-7 w-7 place-items-center rounded-md text-[15px] font-bold" style={{ color: "var(--ink)" }}>+</button>
        <button type="button" onClick={() => setScale(DEFAULT_SCALE)} className="ml-1 rounded-md border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--node-line)", color: "var(--muted)" }}>Reset view</button>
        <span className="ml-1 pr-1 text-[10.5px]" style={{ color: "var(--faint)" }}>or Ctrl+scroll / pinch</span>
      </div>

      {/* scrollable + pannable viewport onto the canvas */}
      <div
        ref={wrapRef}
        className="dot-grid h-full w-full overflow-auto select-none"
        data-pan-bg="true"
        style={{
          cursor: panning ? "grabbing" : "default",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          touchAction: "none",
        }}
        title={editMode ? undefined : "Double-click and drag empty space to pan"}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* sizing spacer — matches the canvas's SCALED footprint so the scrollbar
            range is correct; padding gives room to pan past the edges */}
        <div data-pan-bg="true" style={{ width: CANVAS_W * scale + CANVAS_PAD * 2, height: CANVAS_H * scale + CANVAS_PAD * 2, padding: CANVAS_PAD }}>
          <div
            data-pan-bg="true"
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
        {/* character card */}
        <DragBlock editMode={editMode} x={ch.x} y={ch.y} onMove={(dx, dy) => moveBlock("character", dx, dy)}>
          <button
            type="button"
            className="text-center"
            style={{ width: chSize.w, cursor: editMode ? "grab" : "pointer" }}
            onClick={() => !editMode && openLightbox(-1, "frame", character?.photo ?? "/thumbs/character.jpg", `${character?.name ?? "My Character"} — master reference`, "character")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character?.photo ?? "/thumbs/character.jpg"} alt={character?.name ?? "My character"} className="w-full rounded-xl border-[3px] object-cover shadow transition-transform hover:scale-[1.03]" style={{ height: chSize.h, borderColor: "var(--coral)" }} />
            <div className="cap mt-2" style={{ color: "var(--muted)" }}>{character?.name ?? "My Character"}</div>
          </button>
        </DragBlock>
        {editMode && <ResizeHandle x={ch.x + chSize.w} y={ch.y + chSize.h} onMove={(dw, dh) => resizeBlock("character", dw, dh)} />}

        {/* The old "Prompt 2 · Image" / "Prompt 3 · Animation" static callout
            cards that used to float here are gone — they were just a fixed
            copy of what every row's PROMPT chip already shows, and the
            char-prompt wire below no longer points at a fixed card, it
            points at an actual (re-attachable) prompt chip in the grid. */}

        {/* left sidebar stack */}
        <DragBlock editMode={editMode} x={sb.x} y={sb.y} onMove={(dx, dy) => moveBlock("sidebar", dx, dy)}>
          <div style={{ width: sbSize.w }}>
            {/* Source video — pinned to exactly sbCardH so the fan-out wire
                origin stays calibrated even though there's no longer an
                aspect-ratio image driving the height. See SB_CARD_CHROME. */}
            <SourceVideoCard
              width={sbSize.w}
              height={sbCardH}
              url={sourceUrl}
              draft={urlDraft}
              onDraftChange={setUrlDraft}
              status={transcriptStatus}
              error={transcriptError}
              disabled={editMode}
              onGo={() => runTranscriptPull(sourceUrl ?? urlDraft)}
              onRemove={clearSourceVideo}
            />

            <ArrowGap />
            <button
              type="button"
              className="flex w-full flex-col justify-center rounded-xl border bg-node text-left shadow transition-transform hover:scale-[1.01]"
              style={{ borderColor: "var(--node-line)", padding: 24, minHeight: SB_TRANSCRIPT_H, cursor: editMode ? "grab" : "pointer" }}
              onClick={() => !editMode && setTranscriptOpen(true)}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="cap" style={{ color: "var(--coral-deep)", fontSize: 20 }}>Transcript</span>
                <span className="font-mono text-[13px]" style={{ color: "var(--faint)" }}>
                  {transcriptSegments ? `${transcriptSegments.length} lines` : "view"}
                </span>
              </div>
              <p className="line-clamp-2 leading-relaxed" style={{ color: "var(--muted)", fontSize: 18 }}>
                {transcriptText}
              </p>
            </button>
            <ArrowGap />
            <SidebarPromptChip
              label="Prompt 4"
              width={sidebarPrompt4Size.w}
              height={sidebarPrompt4Size.h}
              disabled={editMode}
              onClick={openNewScriptPrompt}
            />
            <ArrowGap />
            <Pill label="New Script" outline />
          </div>
        </DragBlock>
        {editMode && <ResizeHandle x={sb.x + sbSize.w} y={sbScriptY + SB_NEWSCRIPT_H + 20} onMove={(dw, dh) => resizeBlock("sidebar", dw, dh)} />}
        {editMode && (
          <ResizeHandle
            x={sb.x + sidebarPrompt4Size.w}
            y={sidebarPrompt4Top + sidebarPrompt4Size.h}
            onMove={(dw, dh) => resizeBlock("sidebarPrompt4", dw, dh)}
          />
        )}

        {/* column headers — sit directly above row 1, so they track the rows
            group's own drag offset AND scale */}
        <Header left={rowScaledX(FRAME_X)} width={thumbW_s} label="Frame" />
        <Header left={rowScaledX(NEWIMG_X)} width={thumbW_s} label="New Image" />
        <Header left={rowScaledX(CLIP_X)} width={thumbW_s} label="Clip" />

        {/* all 5 rows move together as one group, and scale as one group too
            (rowsScale, anchored at the Frame column of row 1) */}
        <DragBlock editMode={editMode} x={0} y={0} onMove={(dx, dy) => moveBlock("rows", dx, dy)} raw>
          {rows.map((row, i) => {
            const top = rowScaledTop(i);
            const gg = genGroupStyle[row.genGroup];
            const newimgKey = `newimage-${i}`;
            const clipKey = `clip-${i}`;
            const frameSrc = slotSrc(`frame-${i}`, row.frame);
            const newimgSrc = slotSrc(newimgKey, row.newImage);
            const clipSrc = slotSrc(clipKey, row.newImage);
            return (
              <div key={i}>
                <div className="absolute" style={{ left: rowScaledX(FRAME_X), top, width: thumbW_s }}>
                  {frameSrc ? (
                    <Thumb src={frameSrc} width={thumbW_s} height={rowH_s} borderColor="var(--yellow)" badgeBg="var(--yellow)" badgeColor="var(--ink)" num={i + 1} disabled={editMode} onClick={() => openLightbox(i, "frame", frameSrc, `Row ${i + 1} · source frame`)} />
                  ) : (
                    <EmptySlot width={thumbW_s} height={rowH_s} disabled={editMode} onClick={() => openLightbox(i, "frame", "", `Row ${i + 1} · source frame`)} />
                  )}
                </div>
                <PromptChip left={rowScaledX(PROMPT1_X)} top={top + (rowH_s - promptH_s) / 2} width={promptW_s} height={promptH_s} tone="ink" disabled={editMode} onClick={() => openPrompt(i, "image")} />
                <div className="absolute" style={{ left: rowScaledX(NEWIMG_X), top, width: thumbW_s }}>
                  {newimgSrc ? (
                    <>
                      <Thumb src={newimgSrc} width={thumbW_s} height={rowH_s} borderColor="var(--green)" badgeBg="var(--green)" badgeColor="#fff" num={i + 1} approved={approved[newimgKey]} disabled={editMode} onClick={() => openLightbox(i, "newimage", newimgSrc, `Row ${i + 1} · new image`)} />
                      <div className="mt-1 text-center font-mono text-[10px] font-bold" style={{ color: gg.color }}>{gg.label}</div>
                    </>
                  ) : (
                    <EmptySlot width={thumbW_s} height={rowH_s} disabled={editMode} onClick={() => openLightbox(i, "newimage", "", `Row ${i + 1} · new image`)} />
                  )}
                </div>
                <PromptChip left={rowScaledX(PROMPT2_X)} top={top + (rowH_s - promptH_s) / 2} width={promptW_s} height={promptH_s} tone="blue" disabled={editMode} onClick={() => openPrompt(i, "animation")} />
                <div className="absolute" style={{ left: rowScaledX(CLIP_X), top, width: thumbW_s }}>
                  {clipSrc ? (
                    <Thumb src={clipSrc} width={thumbW_s} height={rowH_s} borderColor="var(--ink)" badgeBg="var(--ink)" badgeColor="#fff" num={i + 1} playButton dim approved={approved[clipKey]} disabled={editMode} onClick={() => openLightbox(i, "clip", clipSrc, `Row ${i + 1} · clip`)} />
                  ) : (
                    <EmptySlot width={thumbW_s} height={rowH_s} disabled={editMode} onClick={() => openLightbox(i, "clip", "", `Row ${i + 1} · clip`)} />
                  )}
                </div>
              </div>
            );
          })}
        </DragBlock>
        {editMode && (
          <ResizeHandle
            x={rowScaledX(CLIP_X) + thumbW_s}
            y={rowScaledTop(4) + rowH_s}
            onMove={(dw, dh) => resizeRows(dw, dh)}
          />
        )}

        {/* video output */}
        <DragBlock editMode={editMode} x={vid.x} y={vid.y} onMove={(dx, dy) => moveBlock("video", dx, dy)}>
          {videoSrc ? (
            <button
              type="button"
              className="text-center"
              style={{ width: vidSize.w, cursor: editMode ? "grab" : "pointer" }}
              onClick={() => !editMode && openLightbox(-1, "clip", videoSrc, "Final video", "video")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={videoSrc} alt="Video" className="w-full rounded-xl border-[3px] object-cover shadow-lg transition-transform hover:scale-[1.03]" style={{ height: vidSize.h, borderColor: "var(--coral)" }} />
              <div className="cap mt-2" style={{ color: "var(--muted)" }}>Video</div>
            </button>
          ) : (
            <EmptySlot
              width={vidSize.w}
              height={vidSize.h}
              disabled={editMode}
              onClick={() => { openLightbox(-1, "clip", "", "Final video", "video"); setReplaceOpen(true); }}
            />
          )}
        </DragBlock>
        {editMode && <ResizeHandle x={vid.x + vidSize.w} y={vid.y + vidSize.h} onMove={(dw, dh) => resizeBlock("video", dw, dh)} />}

        {/* wires — rendered LAST so they paint on top of every card (otherwise a
            wire whose path happens to run under a card goes invisible). The
            SVG here is PURELY visual — pointer-events is hard-off, always —
            because a full-canvas SVG with pointer-events:auto turned out to
            swallow clicks/drags meant for every card underneath it, even with
            individual paths set to pointer-events:none. Real HTML divs for the
            drag handles instead, rendered as separate small elements below,
            sidesteps that SVG hit-testing ambiguity entirely.
            overflow:visible matters here too — an SVG clips to its own box by
            default, so a wire endpoint dragged past the nominal 0/2000/1600
            canvas edge (blocks can go anywhere, no bound) would otherwise
            just vanish mid-stroke instead of drawing all the way to it. */}
        <svg
          className="absolute inset-0"
          width={CANVAS_W}
          height={CANVAS_H}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{ pointerEvents: "none", overflow: "visible" }}
        >
          {wireDefs.map((w) => {
            const b = wireBends[w.id] ?? { x: 0, y: 0 };
            const cx = (w.x1 + w.x2) / 2 + b.x;
            const cy = (w.y1 + w.y2) / 2 + b.y;
            const d = `M ${w.x1},${w.y1} Q ${cx},${cy} ${w.x2},${w.y2}`;
            return (
              <g key={w.id}>
                <path d={d} fill="none" stroke={w.color} strokeWidth={w.width * 3} strokeOpacity={0.12} strokeLinecap="round" />
                <path d={d} fill="none" stroke={w.color} strokeWidth={w.width} strokeLinecap="round" strokeDasharray={w.dash} />
              </g>
            );
          })}
        </svg>

        {/* drag handles — real HTML elements, not SVG shapes, each individually
            hit-testable so they can never block anything outside their own
            small circle */}
        {editMode && wireDefs.map((w) => {
          const b = wireBends[w.id] ?? { x: 0, y: 0 };
          const cx = (w.x1 + w.x2) / 2 + b.x;
          const cy = (w.y1 + w.y2) / 2 + b.y;
          return <WireHandle key={w.id} cx={cx} cy={cy} color={w.color} onMove={(dx, dy) => moveWire(w.id, dx, dy)} />;
        })}

        {/* re-attachable wire ENDPOINTS — a square handle sitting right on
            the wire's target end (not its bend, that's WireHandle above).
            Drag it onto a different prompt chip to rewire what this wire
            actually points at; drop it on empty canvas and it snaps back. */}
        {editMode && wireDefs.filter((w) => w.reattachable).map((w) => (
          <WireEndpointHandle
            key={`${w.id}-end`}
            x={w.x2}
            y={w.y2}
            color={w.color}
            onDown={() => setWireDragEnd({ id: w.id, x: w.x2, y: w.y2 })}
            onMove={(dx, dy) => moveWireEnd(w.id, dx, dy)}
            onDrop={() => dropWireEnd(w.id)}
          />
        ))}
          </div>
        </div>
      </div>

      {/* ---- lightbox ---- */}
      {lightbox && (
        <Overlay onClose={() => setLightbox(null)}>
          <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl" style={{ background: "var(--node)" }}>
            {lightbox.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightbox.src} alt={lightbox.label} className="max-h-[60vh] w-full object-contain" style={{ background: "var(--canvas-2)" }} />
            )}
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[13px] font-bold">{lightbox.label}</div>
                {lightbox.kind !== "row" && approved[lightbox.key] && <div className="text-[11px] font-semibold" style={{ color: "var(--green)" }}>✓ Approved</div>}
              </div>
              {/* Frame/New Image/Clip drop Approve + Close entirely — click
                  outside (Overlay's own onClose) already closes the
                  lightbox, and these are pipeline outputs you regenerate
                  rather than individually approve; Remove is the only
                  action that makes sense on them, handled below. */}
              {lightbox.kind !== "row" && (
                <div className="flex gap-2">
                  {lightbox.row >= 0 && lightbox.src && (
                    <button type="button" onClick={() => toggleApproved(lightbox.key)} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white shadow" style={{ background: approved[lightbox.key] ? "var(--muted)" : "var(--green)" }}>
                      {approved[lightbox.key] ? "Unapprove" : "Approve"}
                    </button>
                  )}
                  <button type="button" onClick={() => setLightbox(null)} className="rounded-lg border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--node-line)" }}>
                    Close
                  </button>
                </div>
              )}
            </div>

            {/* Replace + Remove — character and video keep the toggle-based
                Replace flow (character: Replace only, always exactly one of
                them, no Remove; video: Replace + Remove together). Row slots
                are Remove-when-filled / picker-directly-when-empty instead,
                no Replace toggle: Frame/New Image/Clip are pipeline outputs
                you regenerate rather than swap. (The source-video card used
                to be in this branch too; it now handles its own URL/Go/Remove
                inline and never opens a lightbox.) This is a prototype with
                no backend and project data is static, so every override here
                is in-memory session state (characterOverrideId/slotOverrides
                above) — reload the page and it all resets. */}
            <div className="border-t px-4 py-3" style={{ borderColor: "var(--node-line)" }}>
              {lightbox.kind === "row" ? (
                lightbox.src ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        removeSlot(lightbox);
                        setReplaceOpen(false);
                        setLightbox(null);
                      }}
                      className="text-[12px] font-semibold"
                      style={{ color: "var(--coral)" }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  pickerGrid
                )
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setReplaceOpen((v) => !v)}
                      className="text-[12px] font-semibold"
                      style={{ color: "var(--blue)" }}
                    >
                      {replaceOpen ? "Cancel" : `Replace ${replaceLabelFor(lightbox.kind)} ▾`}
                    </button>
                    {lightbox.kind === "video" && (
                      <button
                        type="button"
                        onClick={() => {
                          removeSlot(lightbox);
                          setReplaceOpen(false);
                          setLightbox(null);
                        }}
                        className="text-[12px] font-semibold"
                        style={{ color: "var(--coral)" }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {replaceOpen && pickerGrid}
                </>
              )}
            </div>
          </div>
        </Overlay>
      )}

      {/* ---- transcript popup ---- */}
      {transcriptOpen && (
        <Overlay onClose={() => setTranscriptOpen(false)}>
          <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl p-5 shadow-2xl" style={{ background: "var(--node)" }}>
            <div className="cap" style={{ color: "var(--coral-deep)" }}>Transcript</div>
            <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
              {transcriptDisplaySegments.map((seg, i) => (
                <div key={i} className="flex gap-3">
                  {seg.time && (
                    <span className="w-10 shrink-0 pt-[1px] text-right font-mono text-[12px]" style={{ color: "var(--faint)" }}>
                      {seg.time}
                    </span>
                  )}
                  <div className="min-w-0">
                    {seg.speaker && (
                      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--blue)" }}>
                        {seg.speaker}
                      </div>
                    )}
                    <p className="leading-relaxed" style={{ color: "var(--ink)", fontSize: 14 }}>{seg.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--node-line)" }}>
              <button
                type="button"
                onClick={() => { setTranscriptOpen(false); openTranscript(); }}
                className="text-[12px] font-semibold"
                style={{ color: "var(--blue)" }}
              >
                Edit as text
              </button>
              <button type="button" onClick={() => setTranscriptOpen(false)} className="rounded-lg border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--node-line)" }}>
                Close
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ---- prompt editor ---- */}
      {promptModal && (
        <Overlay onClose={() => setPromptModal(null)}>
          <div className="flex w-full max-w-lg flex-col gap-3 rounded-2xl p-5 shadow-2xl" style={{ background: "var(--node)" }}>
            <div className="cap" style={{ color: promptModal.kind === "animation" ? "var(--blue)" : "var(--coral-deep)" }}>
              {promptModal.kind === "transcript"
                ? "Transcript"
                : promptModal.kind === "prompt4"
                  ? "Prompt 4 · New Script"
                  : `Row ${promptModal.row + 1} · ${promptModal.kind === "image" ? "Prompt 2 · Image" : "Prompt 3 · Animation"}`}
            </div>
            <textarea
              className="min-h-[140px] rounded-lg border p-3 text-[13px] leading-relaxed outline-none"
              style={{ borderColor: "var(--node-line)", background: "var(--canvas-2)", color: "var(--ink)" }}
              value={promptModal.value}
              onChange={(e) => setPromptModal({ ...promptModal, value: e.target.value })}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPromptModal(null)} className="rounded-lg border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--node-line)" }}>
                Cancel
              </button>
              <button type="button" onClick={saveModalPrompt} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white shadow" style={{ background: "var(--blue)" }}>
                Save
              </button>
              {/* Stub — no real generation logic yet, just a placeholder for
                  where "run this prompt" will eventually hang. */}
              <button
                type="button"
                onClick={() => console.log("Go: generation not implemented yet", promptModal)}
                className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white shadow"
                style={{ background: "var(--coral)" }}
              >
                Go
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/** Wraps a block so it's draggable in edit mode. `raw` skips the position wrapper
 * (used for rows, which already position each of their own children absolutely). */
function DragBlock({
  editMode, x, y, onMove, children, raw,
}: {
  editMode: boolean; x: number; y: number; onMove: (dx: number, dy: number) => void; children: React.ReactNode; raw?: boolean;
}) {
  const dragState = useRef<{ startX: number; startY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editMode) return;
    e.preventDefault(); // stop native selection/drag from hijacking the gesture
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer session — safe to ignore */ }
    dragState.current = { startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    dragState.current = { startX: e.clientX, startY: e.clientY };
    onMove(dx, dy);
  };
  const onPointerUp = () => {
    dragState.current = null;
  };

  const wrapperStyle: React.CSSProperties = raw
    ? { position: "relative" }
    : { position: "absolute", left: x, top: y };

  return (
    <div
      style={{ ...wrapperStyle, WebkitUserSelect: "none", userSelect: "none", touchAction: "none", cursor: editMode ? "grab" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragStart={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// A real HTML element, not an SVG shape — see the note above where this is
// used. Small (18px) and individually positioned, so it can never accidentally
// swallow pointer events meant for anything else on the canvas.
function WireHandle({
  cx, cy, color, onMove,
}: {
  cx: number; cy: number; color: string; onMove: (dx: number, dy: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* no active pointer session */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    onMove(dx, dy);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      style={{
        position: "absolute", left: cx - 9, top: cy - 9, width: 18, height: 18,
        borderRadius: "50%", background: color, border: "2px solid #fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)", cursor: "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// Square handle sitting on a wire's actual END (not its bend, see WireHandle
// above) for reattachable wires — drag it onto a different target and drop
// to rewire. Same real-HTML-div pointer pattern as everything else on this
// canvas; onDown seeds the parent's transient drag-position state before
// any move fires, onDrop hands control back for hit-testing/commit.
function WireEndpointHandle({
  x, y, color, onDown, onMove, onDrop,
}: {
  x: number; y: number; color: string; onDown: () => void; onMove: (dx: number, dy: number) => void; onDrop: () => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    onDown();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* no active pointer session — synthetic/edge-case pointer sessions can throw NotFoundError here, safe to ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    onMove(dx, dy);
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    onDrop();
  };

  return (
    <div
      title="Drag onto a different prompt to reattach"
      style={{
        position: "absolute", left: x - 10, top: y - 10, width: 20, height: 20,
        borderRadius: 5, background: color, border: "2.5px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)", cursor: "grab", zIndex: 30,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// Bottom-right corner grip for the three resizable cards (character/video/
// sidebar). Same real-HTML-div pattern as WireHandle, for the same
// reason — small, individually hit-testable, never swallows clicks meant
// for anything else.
function ResizeHandle({
  x, y, onMove,
}: {
  x: number; y: number; onMove: (dw: number, dh: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* no active pointer session */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dw = e.clientX - dragRef.current.startX;
    const dh = e.clientY - dragRef.current.startY;
    dragRef.current = { startX: e.clientX, startY: e.clientY };
    onMove(dw, dh);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      style={{
        position: "absolute", left: x - 9, top: y - 9, width: 18, height: 18,
        borderRadius: 5, background: "var(--node)", border: "2px solid var(--blue)",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)", cursor: "nwse-resize",
        display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 2,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" style={{ pointerEvents: "none" }}>
        <path d="M7 1 1 7M7 4.5 4.5 7" stroke="var(--blue)" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Header({ left, width = PROMPT_W, label }: { left: number; width?: number; label: string }) {
  // font-size reads off the live column width so it scales with rowsScale
  // the same way the thumbnails/prompt chips under it do — measured against
  // the reference asset, where FRAME/NEW IMAGE/CLIP read noticeably bigger
  // than the small 11px .cap default used everywhere else on this canvas.
  return (
    <div
      className="absolute cap border-b-2 pb-1"
      style={{
        left, top: 462, width, borderColor: "var(--ink)",
        fontSize: width * 0.15, letterSpacing: ".04em", whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

function Thumb({
  src, width = THUMB_W, height = ROW_H, borderColor, badgeBg, badgeColor, num, playButton, dim, approved, onClick, disabled,
}: {
  src: string; width?: number; height?: number; borderColor: string; badgeBg: string; badgeColor: string; num: number;
  playButton?: boolean; dim?: boolean; approved?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className="relative block" style={{ cursor: disabled ? "grab" : "pointer" }} onClick={disabled ? undefined : onClick}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="rounded-lg border-[2.5px] object-cover shadow transition-transform hover:scale-[1.04]" style={{ width, height, borderColor, filter: dim ? "brightness(0.55)" : undefined }} />
      <span className="absolute -left-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-md font-mono text-[10px] font-bold" style={{ background: badgeBg, color: badgeColor }}>
        {String(num).padStart(2, "0")}
      </span>
      {approved && (
        <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full text-white shadow" style={{ background: "var(--green)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}
      {playButton && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90">
            <svg width="12" height="12" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      )}
    </button>
  );
}

// Renders in place of Thumb (or the video card) once a slot's been Removed
// — a plain "+" invitation, no badge/Approve/Replace/Remove chrome. Clicking
// it opens the same lightbox+picker every other slot uses to fill itself,
// just pre-expanded straight to the picker (see the onClick callers) instead
// of showing a broken/empty image first.
function EmptySlot({
  width, height, onClick, disabled,
}: {
  width: number; height: number; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="grid place-items-center rounded-lg border-2 border-dashed transition-transform hover:scale-[1.03]"
      style={{ width, height, borderColor: "var(--node-line)", background: "#4b5563", cursor: disabled ? "grab" : "pointer" }}
      onClick={disabled ? undefined : onClick}
    >
      {/* Fixed literal colors, not theme tokens — this box should read the
          same dark grey in light and dark mode, not adapt like the rest of
          the canvas does. */}
      <span className="font-mono font-black" style={{ color: "#fff", fontSize: Math.min(width, height) * 0.35 }}>+</span>
    </button>
  );
}

function PromptChip({ left, top, width = PROMPT_W, height = PROMPT_H, tone, onClick, disabled }: { left: number; top: number; width?: number; height?: number; tone: "ink" | "blue"; onClick?: () => void; disabled?: boolean }) {
  // Box stays the same size (PROMPT_W/PROMPT_H, unresized) — per the
  // reference asset, what needs to scream "this is a prompt" is the WORD,
  // not the box: one big bold centered "PROMPT", no icon, matching the
  // reference exactly (it really does just say "PROMPT", not the prompt
  // text itself). Icon dropped — there's no room for it next to text this
  // size, and the reference doesn't have one either. font-size reads off
  // the live height so it scales with rowsScale like everything else here.
  return (
    <button
      type="button"
      className="absolute grid place-items-center rounded-lg border bg-node shadow-sm transition-transform hover:scale-[1.02]"
      style={{
        left, top, width, height,
        borderColor: tone === "blue" ? "var(--blue)" : "var(--ink)",
        borderWidth: 1.5,
        background: tone === "blue" ? "color-mix(in srgb, var(--blue) 6%, var(--node))" : "var(--node)",
        cursor: disabled ? "grab" : "pointer",
      }}
      onClick={disabled ? undefined : onClick}
    >
      <span
        className="font-mono font-black uppercase"
        style={{ color: tone === "blue" ? "var(--blue)" : "var(--ink)", fontSize: height * 0.55, letterSpacing: ".06em" }}
      >
        {tone === "blue" ? "Prompt 3" : "Prompt 2"}
      </span>
    </button>
  );
}

// The sidebar's source-video card: paste a URL, hit Go, get a transcript.
//
// Replaced a mock "pick from your uploaded videos" picker. Two states, one
// box: empty (URL input + Go) and filled (the link + Remove/Go). Go is
// persistent in the filled state on purpose — a pull can fail on a private
// video or an AssemblyAI hiccup, and re-running it is the obvious recovery.
//
// Height is pinned by the caller to sbCardH rather than being content-driven,
// so the fan-out wires that originate at this card's bottom edge stay where
// the layout math says they are.
function SourceVideoCard({
  width, height, url, draft, onDraftChange, status, error, disabled, onGo, onRemove,
}: {
  width: number;
  height: number;
  url: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  status: "idle" | "loading" | "error";
  error: string | null;
  disabled?: boolean;
  onGo: () => void;
  onRemove: () => void;
}) {
  const loading = status === "loading";

  // Full URLs overflow a 255px card, and the interesting part for recognising
  // "which video is this" is the host plus the tail of the path.
  let host = url ?? "";
  try {
    if (url) host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* not parseable — fall back to showing the raw string */
  }

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-xl border-[3px] shadow"
      style={{ width, height, borderColor: "var(--yellow)", background: "var(--node)" }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--node-line)" }}>
        <span className="h-4 w-4 rounded-full" style={{ background: "linear-gradient(135deg, var(--coral), var(--pink))" }} />
        <span className="cap" style={{ color: "var(--muted)" }}>Source video</span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3 p-4">
        {url ? (
          <div className="min-w-0">
            <div className="truncate text-[17px] font-extrabold" style={{ color: "var(--ink)" }}>{host}</div>
            <div className="mt-1 break-all text-[11px] leading-snug" style={{ color: "var(--faint)" }}>{url}</div>
          </div>
        ) : (
          <input
            type="url"
            value={draft}
            disabled={disabled || loading}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onGo(); }}
            placeholder="Paste an Instagram / TikTok / YouTube link"
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={{
              borderColor: "var(--node-line)",
              background: "var(--canvas-2)",
              color: "var(--ink)",
              // The canvas sets user-select:none globally for drag sanity;
              // an input needs it back or the text can't be selected.
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        )}

        {loading && (
          <div className="text-[12px] font-semibold" style={{ color: "var(--blue)" }}>Pulling transcript…</div>
        )}
        {status === "error" && error && (
          <div className="text-[11px] font-semibold leading-snug" style={{ color: "var(--coral)" }}>{error}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "var(--node-line)" }}>
        {url ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled || loading}
            className="text-[12px] font-semibold disabled:opacity-40"
            style={{ color: "var(--coral)" }}
          >
            Remove
          </button>
        ) : (
          <span className="cap" style={{ color: "var(--faint)" }}>no source yet</span>
        )}
        <button
          type="button"
          onClick={onGo}
          disabled={disabled || loading || (!url && !draft.trim())}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow disabled:opacity-40"
          style={{ background: "var(--coral)" }}
        >
          {loading ? "…" : "Go"}
        </button>
      </div>
    </div>
  );
}

// Sidebar's Prompt 4 (next script) chip — same big-bold-centered-text
// treatment as the row-level PromptChip above, but living in the sidebar's
// normal document flow instead of being absolutely positioned on the canvas,
// so it sizes via its own SizableId entry (sidebarPrompt4) instead of
// row-level left/top props.
function SidebarPromptChip({
  label, width, height, onClick, disabled,
}: {
  label: string; width: number; height: number; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="grid place-items-center rounded-lg border bg-node shadow-sm transition-transform hover:scale-[1.02]"
      style={{
        width, height, borderColor: "var(--ink)", borderWidth: 1.5,
        cursor: disabled ? "grab" : "pointer",
      }}
      onClick={disabled ? undefined : onClick}
    >
      <span
        className="font-mono font-black uppercase"
        style={{ color: "var(--ink)", fontSize: height * 0.55, letterSpacing: ".06em" }}
      >
        {label}
      </span>
    </button>
  );
}

function Pill({ label, outline }: { label: string; outline?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-full border px-4 py-2 shadow ${outline ? "border-dashed shadow-none" : "bg-node"}`} style={{ borderColor: "var(--node-line)", background: outline ? "transparent" : "var(--node)" }}>
      {!outline && <ZapIcon color="var(--coral)" size={13} />}
      <span className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>{label}</span>
    </div>
  );
}

function ArrowGap() {
  return (
    <div className="flex justify-center py-1">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth={2}>
        <path d="M12 4v16M6 14l6 6 6-6" />
      </svg>
    </div>
  );
}

function ZapIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

