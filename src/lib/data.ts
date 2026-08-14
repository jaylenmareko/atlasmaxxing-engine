// Single source of truth for every character + project this prototype knows
// about. Library reads this list to render cards; Production reads a single
// project (by id, from the URL) to render the canvas. This is what makes
// clicking a project in Library actually load it into Production instead of
// the two pages being unrelated static screens.

export type GenGroup = "NEW" | "CONT" | "SAME";

export interface RowData {
  frame: string;
  newImage: string;
  genGroup: GenGroup;
  line: string;
  action: string;
  environment: string;
}

export interface Character {
  id: string;
  name: string;
  photo: string;
  wardrobe: number;
  environments: number;
  page: string;
}

export type ProjectTone = "blue" | "green" | "violet" | "muted";

export interface ProjectData {
  id: string;
  title: string;
  characterId: string;
  version: string;
  source: string;
  status: string;
  tone: ProjectTone;
  thumb: string;
  updated: string;
  tag: string; // short slug shown in the header badge, e.g. "nephew-advice"
  sourceHandle: string;
  sourceCaption: string;
  sourceRowLabel: string;
  transcript: string;
  rows: RowData[];
}

export const characters: Character[] = [
  { id: "ace", name: "Ace", photo: "/thumbs/character.jpg", wardrobe: 3, environments: 2, page: "Meta" },
  { id: "reyna", name: "Reyna", photo: "/thumbs/newimage2.jpg", wardrobe: 5, environments: 4, page: "Meta + TikTok" },
];

// The mock `uploadedSourceVideos` list that used to live here is gone. It
// existed to fake a "pick a source video from your library" flow while there
// was no real pipeline; the sidebar's source card now takes a pasted video
// URL and pulls a real transcript through /api/transcript, so a stand-in
// picker would just be a second, fake way to do the same thing.
//
// The sourceHandle / sourceCaption / sourceRowLabel fields on ProjectData
// above are kept: they still describe where each seeded project came from,
// even though the card no longer renders them.

// The 5-row FRAME -> NEW IMAGE -> CLIP chain we have real assets for
// (acegotaura_'s "3 dating red flags" recreation). Reused across the other
// mock projects below since there's only one real asset set right now —
// each project still gets its own independent id/status/approvals/prompt
// edits, only the underlying thumbnails are shared placeholders.
const nephewAdviceRows: RowData[] = [
  { frame: "/thumbs/frame1.jpg", newImage: "/thumbs/newimage1.jpg", genGroup: "NEW",
    line: "Nephew — dating today ain't the game your mom and dad played.",
    action: "leans forward, opens with a direct address to camera", environment: "book-lined study, leather armchair" },
  { frame: "/thumbs/frame2.jpg", newImage: "/thumbs/newimage2.jpg", genGroup: "CONT",
    line: "Get her on a call, FaceTime her, before you waste a whole night.",
    action: "continues speaking, natural hand gesture", environment: "same study, chained off row 1" },
  { frame: "/thumbs/frame3.jpg", newImage: "/thumbs/newimage3.jpg", genGroup: "CONT",
    line: "Half these women online look different than you'd think.",
    action: "leans back slightly, raises an eyebrow", environment: "same study — chain depth 3, re-anchor next row" },
  { frame: "/thumbs/frame4.jpg", newImage: "/thumbs/newimage4.jpg", genGroup: "SAME",
    line: "The app matters — every app's got its own culture.",
    action: "same still, animated only — no new generation", environment: "reused from row 3" },
  { frame: "/thumbs/frame5.jpg", newImage: "/thumbs/newimage5.jpg", genGroup: "NEW",
    line: "So tell me — you moving with intention? Comment below.",
    action: "direct to camera, closing line", environment: "book-lined study, fresh anchor to master lock" },
];

export const projects: ProjectData[] = [
  {
    id: "would-you-have-ordered-for-her",
    title: '"Would you have ordered for her?" recreation',
    characterId: "ace",
    version: "V2",
    source: "from video",
    status: "Gate 2 · Images",
    tone: "blue",
    thumb: "/thumbs/newimage2.jpg",
    updated: "2m ago",
    tag: "nephew-advice",
    sourceHandle: "acegotaura_",
    sourceCaption: "3 dating red flags",
    sourceRowLabel: "Row 818",
    transcript: "\"Nephew — dating today ain't the game your mom and dad played…\"",
    rows: nephewAdviceRows,
  },
  {
    id: "date-with-intention",
    title: "Date with intention",
    characterId: "ace",
    version: "V1",
    source: "from idea",
    status: "Shipped",
    tone: "green",
    thumb: "/thumbs/video-output.jpg",
    updated: "yesterday",
    tag: "date-with-intention",
    sourceHandle: "acegotaura_",
    sourceCaption: "date with intention",
    sourceRowLabel: "Idea intake",
    transcript: "\"You don't just show up — you move with intention, every step.\"",
    rows: nephewAdviceRows,
  },
  {
    id: "service-test-waiter",
    title: "Service test — how she treats the waiter",
    characterId: "ace",
    version: "V1",
    source: "from idea",
    status: "Gate 1 · Plan",
    tone: "muted",
    thumb: "/thumbs/newimage4.jpg",
    updated: "3d ago",
    tag: "waiter-test",
    sourceHandle: "acegotaura_",
    sourceCaption: "how she treats the waiter",
    sourceRowLabel: "Idea intake",
    transcript: "\"Watch how she talks to people who can't do anything for her.\"",
    rows: nephewAdviceRows,
  },
  {
    id: "trophy-wife-red-flags",
    title: "Trophy wife red flags",
    characterId: "reyna",
    version: "V3",
    source: "from video",
    status: "Gate 3 · Video",
    tone: "violet",
    thumb: "/thumbs/newimage3.jpg",
    updated: "4d ago",
    tag: "trophy-wife",
    sourceHandle: "reynaspeaks_",
    sourceCaption: "trophy wife red flags",
    sourceRowLabel: "Row 402",
    transcript: "\"If she's never wrong, that's not confidence — that's a warning.\"",
    rows: nephewAdviceRows,
  },
];

export function getProject(id: string): ProjectData | undefined {
  return projects.find((p) => p.id === id);
}

export function getCharacter(id: string): Character | undefined {
  return characters.find((c) => c.id === id);
}
