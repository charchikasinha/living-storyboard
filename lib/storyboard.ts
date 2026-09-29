// Data model, direction vocabulary and browser helpers for the Living Storyboard.

export type Still = { id: string; blob: Blob; createdAt: number; note?: string };
export type Take = {
  id: string;
  blob: Blob;
  createdAt: number;
  durationMs: number;
};
export type DirectionEvent = { at: number; text: string };

// ---- Tape: every live run is recorded as a segment; versions stitch segments.
export type Frame = { t: number; blob: Blob }; // t = ms from segment start
export type Mark = { t: number; text: string };
export type Segment = {
  id: string;
  blob: Blob | null; // null while still recording
  durationMs: number;
  frames: Frame[];
  marks: Mark[];
  createdAt: number;
};
/** A slice of a segment; `to` is null while that segment is still recording. */
export type Part = { segId: string; from: number; to: number | null };
export type Version = {
  id: string;
  n: number;
  createdAt: number;
  parentId: string | null;
  branchAtMs: number | null;
  parts: Part[];
};

export type Shot = {
  id: string;
  title: string;
  description: string;
  notes: string;
  refImage: Blob | null;
  stills: Still[];
  takes: Take[];
  directions: DirectionEvent[];
  heroId: string | null; // still, take or version shown in present mode
  segments: Segment[];
  versions: Version[];
  activeVersionId: string | null;
};

export type Board = {
  id: string;
  title: string;
  shots: Shot[];
  updatedAt: number;
};

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newShot(partial: Partial<Shot> = {}): Shot {
  return {
    id: uid(),
    title: "",
    description: "",
    notes: "",
    refImage: null,
    stills: [],
    takes: [],
    directions: [],
    heroId: null,
    segments: [],
    versions: [],
    activeVersionId: null,
    ...partial,
  };
}

export function newBoard(): Board {
  return {
    id: uid(),
    title: "Untitled production",
    shots: [
      newShot({
        title: "Opening",
        description:
          "A lone figure stands at the edge of a rooftop at dusk, city lights flickering on below.",
      }),
    ],
    updatedAt: Date.now(),
  };
}

// ---- Direction vocabulary -------------------------------------------------

export type DirectionGroup = {
  id: string;
  label: string;
  color: string; // vivid accent, kept saturated on the monochrome base
  exclusive: boolean; // only one active at a time (e.g. one camera move)
  chips: { label: string; prompt: string }[];
};

export const DIRECTION_GROUPS: DirectionGroup[] = [
  {
    id: "camera",
    label: "Camera",
    color: "#2f6bff",
    exclusive: true,
    chips: [
      { label: "Static", prompt: "locked-off static camera" },
      { label: "Push in", prompt: "the camera slowly pushes in toward the subject" },
      { label: "Pull back", prompt: "the camera slowly pulls back to reveal the wider scene" },
      { label: "Pan left", prompt: "the camera pans slowly to the left" },
      { label: "Pan right", prompt: "the camera pans slowly to the right" },
      { label: "Orbit", prompt: "the camera orbits slowly around the subject" },
      { label: "Crane up", prompt: "the camera cranes up and rises above the scene" },
      { label: "Handheld", prompt: "handheld camera with subtle natural shake" },
    ],
  },
  {
    id: "shot",
    label: "Framing",
    color: "#7a3cff",
    exclusive: true,
    chips: [
      { label: "Wide", prompt: "wide establishing shot" },
      { label: "Medium", prompt: "medium shot" },
      { label: "Close-up", prompt: "tight close-up on the subject's face" },
      { label: "Over shoulder", prompt: "over-the-shoulder framing" },
      { label: "Low angle", prompt: "low-angle shot looking up" },
      { label: "Top down", prompt: "overhead top-down angle" },
    ],
  },
  {
    id: "light",
    label: "Light",
    color: "#ff8a00",
    exclusive: true,
    chips: [
      { label: "Golden hour", prompt: "warm golden-hour sunlight" },
      { label: "Blue hour", prompt: "cool blue-hour twilight" },
      { label: "Night", prompt: "night, lit by practical lights" },
      { label: "Neon", prompt: "saturated neon lighting" },
      { label: "Candlelight", prompt: "flickering candlelight" },
      { label: "Hard noon", prompt: "harsh midday sun with hard shadows" },
      { label: "Silhouette", prompt: "strong backlight turning the subject into a silhouette" },
    ],
  },
  {
    id: "mood",
    label: "Mood",
    color: "#ff2d6f",
    exclusive: true,
    chips: [
      { label: "Tense", prompt: "tense, suspenseful atmosphere" },
      { label: "Dreamy", prompt: "soft, dreamy atmosphere" },
      { label: "Melancholic", prompt: "quiet, melancholic mood" },
      { label: "Joyful", prompt: "warm, joyful energy" },
      { label: "Eerie", prompt: "eerie, unsettling stillness" },
      { label: "Epic", prompt: "grand, epic scale" },
    ],
  },
  {
    id: "world",
    label: "World",
    color: "#00b37e",
    exclusive: false,
    chips: [
      { label: "Rain", prompt: "rain begins to fall" },
      { label: "Fog", prompt: "fog rolls in" },
      { label: "Snow", prompt: "snow drifts down" },
      { label: "Wind", prompt: "strong wind moves through the scene" },
      { label: "Dust", prompt: "dust particles hang in the light" },
      { label: "Crowd", prompt: "people move through the background" },
    ],
  },
];

export const STYLE_SUFFIX =
  "Cinematic, photorealistic, subtle natural motion, continuous shot, no cuts.";

export type ActiveDirections = Record<string, string[]>; // groupId -> chip labels

export function composePrompt(
  description: string,
  active: ActiveDirections,
  custom: string,
) {
  const parts: string[] = [];
  const base = description.trim();
  if (base) parts.push(base.replace(/[.\s]+$/, ""));
  for (const group of DIRECTION_GROUPS) {
    for (const label of active[group.id] ?? []) {
      const chip = group.chips.find((c) => c.label === label);
      if (chip) parts.push(chip.prompt);
    }
  }
  if (custom.trim()) parts.push(custom.trim().replace(/[.\s]+$/, ""));
  if (!parts.length) return "";
  const sentence = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(". ");
  return `${sentence}. ${STYLE_SUFFIX}`;
}

export function describeActive(active: ActiveDirections, custom: string) {
  const labels = DIRECTION_GROUPS.flatMap((g) => active[g.id] ?? []);
  if (custom.trim()) labels.push(`“${custom.trim()}”`);
  return labels.join(" · ");
}

// ---- Image helpers --------------------------------------------------------

/** Center-crop any image to 16:9 (Orbis distorts other ratios) as a JPEG. */
export async function to16x9(file: Blob, maxWidth = 1920): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const target = 16 / 9;
  let sw = bitmap.width;
  let sh = bitmap.height;
  let sx = 0;
  let sy = 0;
  if (sw / sh > target) {
    sw = Math.round(sh * target);
    sx = Math.round((bitmap.width - sw) / 2);
  } else {
    sh = Math.round(sw / target);
    sy = Math.round((bitmap.height - sh) / 2);
  }
  const width = Math.min(maxWidth, sw);
  const height = Math.round(width / target);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      0.9,
    ),
  );
}

export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not capture frame"))),
      "image/jpeg",
      0.92,
    ),
  );
}

export function pickRecorderMime() {
  const options = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export const extFor = (blob: Blob) =>
  blob.type.includes("mp4") ? "mp4" : blob.type.includes("webm") ? "webm" : "jpg";

export const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shot";

export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---- Persistence (IndexedDB keeps images and video blobs on this computer) --

const DB_NAME = "living-storyboard";
const STORE = "boards";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadBoard(): Promise<Board | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Board) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveBoard(board: Board) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(board, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Saving is best-effort; the board still works in memory.
  }
}

// ---- Tape helpers ------------------------------------------------------------

export const partLength = (part: Part, liveMs = 0) =>
  (part.to ?? part.from + liveMs) - part.from;

export const versionLength = (v: Version, liveMs = 0) =>
  v.parts.reduce((sum, p) => sum + Math.max(0, partLength(p, liveMs)), 0);

/** Find which part/segment a version-time T falls in. */
export function locate(v: Version, t: number, liveMs = 0) {
  let offset = 0;
  for (let i = 0; i < v.parts.length; i++) {
    const part = v.parts[i];
    const len = partLength(part, liveMs);
    if (t < offset + len || i === v.parts.length - 1) {
      const local = part.from + Math.max(0, Math.min(len, t - offset));
      return { index: i, part, offset, local };
    }
    offset += len;
  }
  return null;
}

/** Latest frame at or before local time t (falls back to the first frame). */
export function frameAt(frames: Frame[], t: number): Blob | null {
  if (!frames.length) return null;
  let best = frames[0];
  for (const f of frames) {
    if (f.t <= t) best = f;
    else break;
  }
  return best.blob;
}

/** Parts of a version cut off at version-time T (the redirect point). */
export function truncateAt(v: Version, t: number, liveMs = 0): Part[] {
  const hit = locate(v, t, liveMs);
  if (!hit) return [];
  return [
    ...v.parts.slice(0, hit.index),
    { ...hit.part, to: Math.max(hit.part.from, Math.round(hit.local)) },
  ];
}

/** Older boards / interrupted recordings: fill new fields, drop empty parts. */
export function sanitizeBoard(board: Board): Board {
  return {
    ...board,
    shots: board.shots.map((raw) => {
      const shot = { ...newShot(), ...raw };
      const segments = (shot.segments ?? []).filter((s) => s.blob && s.durationMs > 0);
      const ok = new Set(segments.map((s) => s.id));
      const versions = (shot.versions ?? [])
        .map((v) => ({
          ...v,
          parts: v.parts
            .filter((p) => ok.has(p.segId))
            .map((p) => ({
              ...p,
              to: p.to ?? segments.find((s) => s.id === p.segId)!.durationMs,
            })),
        }))
        .filter((v) => v.parts.length);
      const activeVersionId = versions.some((v) => v.id === shot.activeVersionId)
        ? shot.activeVersionId
        : (versions.at(-1)?.id ?? null);
      return { ...shot, segments, versions, activeVersionId };
    }),
  };
}

export function pickTapeMime() {
  // WebM seeks reliably after a duration fix; prefer it for the rewind tape.
  const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function grabFrameSized(video: HTMLVideoElement, width = 1280): Promise<Blob> {
  const w = Math.min(width, video.videoWidth || width);
  const h = Math.round(w * ((video.videoHeight || 9) / (video.videoWidth || 16)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("frame"))), "image/jpeg", 0.85),
  );
}
