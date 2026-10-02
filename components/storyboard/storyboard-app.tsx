"use client";

import { ReactorProvider, ReactorView } from "@reactor-team/js-sdk";
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ArchivePanel, DRAG_IMAGE, DRAG_PROMPT } from "@/components/storyboard/archive-panel";
import { blobUrl } from "@/components/storyboard/blob-url";
import { ChainPlayer, exportVersion } from "@/components/storyboard/chain-player";
import { PresentMode } from "@/components/storyboard/present-mode";
import { Projects } from "@/components/storyboard/projects";
import { scriptLines } from "@/components/storyboard/script-panel";
import { ShotList } from "@/components/storyboard/shot-list";
import { useSpeech } from "@/hooks/use-speech";
import { frameAtVersion, type LiveTape, Timeline } from "@/components/storyboard/timeline";
import { useOrbisSession } from "@/hooks/use-orbis-session";
import { ORBIS_MODEL_NAME, ORBIS_TRACKS, requestReactorJwt } from "@/lib/orbis";
import {
  type ActiveDirections,
  type Board,
  type Controls,
  DEFAULT_CONTROLS,
  deleteBoard,
  lastBoardId,
  LENSES,
  loadBoards,
  rememberBoard,
  composePrompt,
  describeActive,
  DIRECTION_GROUPS,
  downloadBlob,
  extFor,
  formatClock,
  grabFrame,
  newBoard,
  newShot,
  grabFrameSized,
  type Frame,
  type Mark,
  pickTapeMime,
  sanitizeBoard,
  saveBoard,
  type Segment,
  type Shot,
  truncateAt,
  type Version,
  versionLength,
  slug,
  to16x9,
  uid,
} from "@/lib/storyboard";

export { blobUrl };

/** Best image to represent a shot: chosen hero still, latest still, reference. */
export function coverFor(shot: Shot): Blob | null {
  const hero = shot.stills.find((s) => s.id === shot.heroId);
  if (hero) return hero.blob;
  if (shot.stills.length) return shot.stills.at(-1)!.blob;
  if (shot.refImage) return shot.refImage;
  const v = shot.versions.find((x) => x.id === shot.activeVersionId);
  const seg = v && shot.segments.find((x) => x.id === v.parts[0]?.segId);
  return seg?.frames[Math.floor(seg.frames.length / 2)]?.blob ?? null;
}

const IDLE_DISCONNECT_MS = 3 * 60_000;

export function StoryboardApp() {
  const jwtPromise = useRef<Promise<string> | null>(null);
  const currentJwt = useRef<string | null>(null);
  const getJwt = useCallback(async () => {
    const pending = (jwtPromise.current ??= requestReactorJwt());
    try {
      const jwt = await pending;
      currentJwt.current = jwt;
      return jwt;
    } catch (error) {
      if (jwtPromise.current === pending) jwtPromise.current = null;
      throw error;
    }
  }, []);
  const getCurrentJwt = useCallback(() => currentJwt.current, []);
  const clearJwt = useCallback(() => {
    jwtPromise.current = null;
    currentJwt.current = null;
  }, []);

  return (
    <ReactorProvider
      apiUrl="https://api.reactor.inc"
      modelName={ORBIS_MODEL_NAME}
      modelTracks={[...ORBIS_TRACKS]}
      connectOptions={{ autoConnect: false }}
      jwtToken={getJwt}
    >
      <Studio clearJwt={clearJwt} getCurrentJwt={getCurrentJwt} />
    </ReactorProvider>
  );
}

function Studio({
  clearJwt,
  getCurrentJwt,
}: {
  clearJwt: () => void;
  getCurrentJwt: () => string | null;
}) {
  const session = useOrbisSession(clearJwt, getCurrentJwt);

  // ---- Productions (persisted locally in IndexedDB) ----
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<"projects" | "studio">("projects");
  const [selectedId, setSelectedId] = useState("");
  const refreshBoards = async () => {
    const list = await loadBoards();
    if (!list.length) {
      const first = newBoard();
      await saveBoard(first);
      list.push(first);
    }
    setBoards(list.map(sanitizeBoard));
  };
  useEffect(() => {
    void refreshBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!board) return;
    const timer = setTimeout(() => {
      void saveBoard(board);
      setBoards((list) => list && [board, ...list.filter((b) => b.id !== board.id)]);
    }, 400);
    return () => clearTimeout(timer);
  }, [board]);

  const updateBoard = (fn: (b: Board) => Board) =>
    setBoard((b) => (b ? { ...fn(b), updatedAt: Date.now() } : b));
  const updateShot = (id: string, fn: (s: Shot) => Shot) =>
    updateBoard((b) => ({
      ...b,
      shots: b.shots.map((s) => (s.id === id ? fn(s) : s)),
    }));

  const shots = board?.shots ?? [];
  const selectedIndex = Math.max(
    0,
    shots.findIndex((s) => s.id === selectedId),
  );
  const shot = shots[selectedIndex];

  // ---- Theme ----
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sb-theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {}
  }, []);
  const toggleTheme = () =>
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      try {
        localStorage.setItem("sb-theme", next);
      } catch {}
      return next;
    });

  // ---- Hints (helper text) on/off ----
  const [hints, setHints] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("sb-hints") === "off") setHints(false);
    } catch {}
  }, []);
  const toggleHints = () =>
    setHints((h) => {
      try {
        localStorage.setItem("sb-hints", h ? "off" : "on");
      } catch {}
      return !h;
    });
  const hintsButton = (
    <button
      className={`sb-icon-btn sb-hints-btn ${hints ? "is-on" : ""}`}
      onClick={toggleHints}
      aria-pressed={hints}
      title={hints ? "Hide hints and example text" : "Show hints and example text"}
    >
      ?
    </button>
  );

  // ---- Direction state for the selected shot ----
  const [dirs, setDirs] = useState<
    Record<string, { active: ActiveDirections; custom: string; draft: string; controls: Controls }>
  >({});
  const current = (shot && dirs[shot.id]) || { active: {}, custom: "", draft: "", controls: DEFAULT_CONTROLS };
  const active = current.active;
  const custom = current.custom;
  const customDraft = current.draft;
  const controls = current.controls;
  const setControl = <K extends keyof Controls>(key: K, value: Controls[K]) =>
    patchDirs({ controls: { ...controls, [key]: value } });
  const patchDirs = (patch: Partial<typeof current>) =>
    shot && setDirs((d) => ({ ...d, [shot.id]: { ...current, ...patch } }));
  const setCustomDraft = (draft: string) => patchDirs({ draft });
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playing = session.runStarted && playingId !== null;
  const playingShot = shots.find((s) => s.id === playingId);
  const isLiveHere = playing && playingId === shot?.id;

  const prompt = shot ? composePrompt(shot.description, active, custom, controls) : "";

  const logDirection = (id: string, text: string) =>
    updateShot(id, (s) => ({
      ...s,
      directions: [...s.directions, { at: Date.now(), text }].slice(-40),
    }));

  const applyDirections = (nextActive: ActiveDirections, nextCustom: string) => {
    patchDirs({ active: nextActive, custom: nextCustom, draft: nextCustom });
  };

  // While a shot is live, send the latest composed prompt shortly after the
  // director stops clicking, so quick chip combos land as one direction.
  const lastSentPrompt = useRef("");
  const cursorRef = useRef<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const liveSummary = describeActive(active, custom, controls);
  const [lastDirection, setLastDirection] = useState<{ text: string; at: number; shotId: string } | null>(null);
  useEffect(() => {
    if (!isLiveHere || cursorRef.current !== null || !shot || !prompt || prompt === lastSentPrompt.current) return;
    const timer = setTimeout(() => {
      lastSentPrompt.current = prompt;
      void session.steerWith(prompt);
      logDirection(shot.id, liveSummary || "Scene only");
      addTapeMark(liveSummary || "Scene only");
      setLastDirection({ text: custom || liveSummary || "Scene only", at: Date.now(), shotId: shot.id });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, isLiveHere, reviewing]);

  const toggleChip = (groupId: string, label: string) => {
    const group = DIRECTION_GROUPS.find((g) => g.id === groupId)!;
    const current = active[groupId] ?? [];
    let next: string[];
    if (current.includes(label)) next = current.filter((l) => l !== label);
    else next = group.exclusive ? [label] : [...current, label];
    applyDirections({ ...active, [groupId]: next }, custom);
  };

  const submitCustom = () => {
    applyDirections(active, customDraft);
  };

  /** Re-send the current prompt even if nothing changed ("once more"). */
  const steerAgain = (label: string) => {
    if (!isLiveHere || !shot || !prompt) return;
    lastSentPrompt.current = prompt;
    void session.steerWith(prompt);
    logDirection(shot.id, label);
    addTapeMark(label);
    setLastDirection({ text: label, at: Date.now(), shotId: shot.id });
  };

  // ---- Script mode ----
  const [panelTab, setPanelTab] = useState<"direct" | "script">("direct");
  const [followScript, setFollowScript] = useState(true);
  const [sentLines, setSentLines] = useState<Record<string, Set<number>>>({});
  const goToLine = (index: number) => {
    if (!shot) return;
    const lines = scriptLines(shot.script);
    const line = lines[index];
    updateShot(shot.id, (s) => ({ ...s, scriptLine: index }));
    if (!line || !followScript) return;
    applyDirections(active, line);
    if (isLiveHere) {
      setSentLines((m) => ({ ...m, [shot.id]: new Set([...(m[shot.id] ?? []), index]) }));
    }
  };

  // ---- Voice direction (hold to speak) ----
  const speech = useSpeech((text) => {
    applyDirections(active, text);
    setNotice(isLiveHere ? `Directing: “${text}”` : `Set: “${text}” — it applies when you play the shot.`);
  });

  const selectShot = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
  };

  const shotFile = (blob: Blob | null, name: string) =>
    blob ? new File([blob], `${name}.jpg`, { type: blob.type || "image/jpeg" }) : null;

  /** Start Orbis on a fresh segment inside `version`, recording it to tape. */
  const runIntoVersion = async (
    target: Shot,
    version: Version,
    segment: Segment,
    image: File | null,
    label: string,
    previousActive: string | null,
  ) => {
    updateShot(target.id, (s) => ({
      ...s,
      segments: [...s.segments, segment],
      versions: [...s.versions, version],
      activeVersionId: version.id,
    }));
    setCursor(null);
    setReviewPlaying(false);
    setPlayingId(target.id);
    lastSentPrompt.current = prompt;
    const ok = await session.startShot(image, prompt);
    if (ok) {
      startTape(target.id, version.id, segment.id, label);
      logDirection(target.id, label);
      setLastDirection({ text: custom || describeActive(active, "", controls) || "Scene", at: Date.now(), shotId: target.id });
    } else {
      setPlayingId(null);
      updateShot(target.id, (s) => ({
        ...s,
        segments: s.segments.filter((x) => x.id !== segment.id),
        versions: s.versions.filter((x) => x.id !== version.id),
        activeVersionId: previousActive,
      }));
    }
  };

  const nextVersionNumber = (s: Shot) => s.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  const newSegment = (): Segment => ({
    id: uid(),
    blob: null,
    durationMs: 0,
    frames: [],
    marks: [],
    createdAt: Date.now(),
  });

  const playShot = async () => {
    if (!shot) return;
    if (!prompt) {
      setNotice("Describe the scene first — Orbis needs words to start from.");
      return;
    }
    await finalizeTape();
    const segment = newSegment();
    const version: Version = {
      id: uid(),
      n: nextVersionNumber(shot),
      createdAt: Date.now(),
      parentId: null,
      branchAtMs: null,
      parts: [{ segId: segment.id, from: 0, to: null }],
    };
    const summary = describeActive(active, custom, controls);
    await runIntoVersion(
      shot,
      version,
      segment,
      shotFile(shot.refImage, slug(shot.title)),
      `▶ Started${summary ? ` — ${summary}` : ""}`,
      shot.activeVersionId,
    );
  };

  /** Keep the tape up to the cursor, regenerate everything after it. */
  const redirectFromCursor = async () => {
    if (!shot || !activeVersion) return;
    if (!prompt) {
      setNotice("Describe the scene first.");
      return;
    }
    const liveHere = tapeRef.current?.shotId === shot.id ? liveTape : null;
    const liveMs = liveHere?.ms ?? 0;
    const at = Math.min(cursor ?? versionLength(activeVersion, liveMs), versionLength(activeVersion, liveMs));
    const frame = frameAtVersion(activeVersion, at, shot.segments, liveHere) ?? shot.refImage;
    const kept = truncateAt(activeVersion, at, liveMs);
    await finalizeTape();
    const segment = newSegment();
    const version: Version = {
      id: uid(),
      n: nextVersionNumber(shot),
      createdAt: Date.now(),
      parentId: activeVersion.id,
      branchAtMs: at,
      parts: [...kept.filter((p) => p.to !== null && p.to > p.from), { segId: segment.id, from: 0, to: null }],
    };
    const summary = describeActive(active, custom, controls);
    setNotice(`Redirecting from ${formatClock(at)} — the new take appears in a few seconds.`);
    await runIntoVersion(
      shot,
      version,
      segment,
      shotFile(frame, `${slug(shot.title)}-${Math.round(at)}`),
      `⟲ Redirected v${activeVersion.n} at ${formatClock(at)}${summary ? ` — ${summary}` : ""}`,
      activeVersion.id,
    );
  };

  const stopShot = async () => {
    await finalizeTape();
    await session.stopShot();
    setPlayingId(null);
  };

  // ---- Notices ----
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4_500);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- Connection clock + idle auto-disconnect (credits are billed per minute) ----
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (session.connected) setConnectedAt((t) => t ?? Date.now());
    else setConnectedAt(null);
    lastActivity.current = Date.now();
  }, [session.connected]);
  useEffect(() => {
    if (session.runStarted) lastActivity.current = Date.now();
  }, [session.runStarted, session.prompt]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const finalizeRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const live = sessionRef.current;
      if (
        live.connected &&
        !live.runStarted &&
        !live.controlsBusy &&
        Date.now() - lastActivity.current > IDLE_DISCONNECT_MS
      ) {
        lastActivity.current = Date.now();
        setNotice("Disconnected after 3 idle minutes to save credits.");
        void finalizeRef.current().then(() => live.disconnectSession());
      }
    }, 1_000);
    return () => clearInterval(t);
  }, []);

  // ---- Capture ----
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const [flash, setFlash] = useState(false);
  const captureStill = async () => {
    let blob: Blob | null = null;
    let target = playingId;
    if (cursor !== null && shot && activeVersion) {
      target = shot.id;
      const review = stageRef.current?.querySelector(".sb-review-video") as HTMLVideoElement | null;
      blob = review?.videoWidth
        ? await grabFrame(review)
        : frameAtVersion(activeVersion, cursor, shot.segments, tapeForActive);
    } else {
      const video = liveVideo();
      if (video?.videoWidth) blob = await grabFrame(video);
    }
    if (!blob || !target) {
      setNotice("Nothing on screen to capture yet.");
      return;
    }
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const id = uid();
    updateShot(target, (s) => ({
      ...s,
      stills: [...s.stills, { id, blob, createdAt: Date.now() }],
      heroId: s.heroId ?? id,
    }));
  };

  // ---- Tape: record every live run, with frame snapshots for scrubbing ----
  type TapeState = {
    shotId: string;
    versionId: string;
    segId: string;
    recorder: MediaRecorder | null;
    chunks: Blob[];
    frames: Frame[];
    marks: Mark[];
    acc: number;
    resumedAt: number | null;
    timers: ReturnType<typeof setInterval>[];
  };
  const tapeRef = useRef<TapeState | null>(null);
  const pausedRef = useRef(session.paused);
  pausedRef.current = session.paused;
  const [liveTape, setLiveTape] = useState<LiveTape>(null);
  const tapeMs = (t: TapeState) => t.acc + (t.resumedAt ? Date.now() - t.resumedAt : 0);
  const liveVideo = () =>
    liveRef.current?.querySelector("video") as HTMLVideoElement | null;

  const startTape = (shotId: string, versionId: string, segId: string, firstMark: string) => {
    const tape: TapeState = {
      shotId,
      versionId,
      segId,
      recorder: null,
      chunks: [],
      frames: [],
      marks: [{ t: 0, text: firstMark }],
      acc: 0,
      resumedAt: null,
      timers: [],
    };
    tapeRef.current = tape;
    const waitForPicture = setInterval(() => {
      if (tapeRef.current !== tape) return clearInterval(waitForPicture);
      const video = liveVideo();
      const stream = video?.srcObject as MediaStream | null;
      if (!video || !stream || !video.videoWidth || video.readyState < 2) return;
      clearInterval(waitForPicture);
      const videoOnly = new MediaStream(stream.getVideoTracks());
      const mime = pickTapeMime();
      const recorder = new MediaRecorder(videoOnly, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
      recorder.ondataavailable = (e) => e.data.size && tape.chunks.push(e.data);
      recorder.start(1000);
      tape.recorder = recorder;
      tape.resumedAt = Date.now();
      if (pausedRef.current) {
        recorder.pause();
        tape.resumedAt = null;
      }
      const snap = setInterval(() => {
        const v = liveVideo();
        if (!tape.resumedAt || !v?.videoWidth) return;
        const t = tapeMs(tape);
        void grabFrameSized(v).then((blob) => tape.frames.push({ t, blob }));
      }, 500);
      tape.timers.push(snap);
    }, 150);
    tape.timers.push(waitForPicture);
    const clock = setInterval(() => {
      if (tapeRef.current !== tape) return;
      setLiveTape({ segId, frames: tape.frames, marks: tape.marks, ms: tapeMs(tape) });
    }, 250);
    tape.timers.push(clock);
    setLiveTape({ segId, frames: tape.frames, marks: tape.marks, ms: 0 });
  };

  const addTapeMark = (text: string) => {
    const tape = tapeRef.current;
    if (tape) tape.marks.push({ t: tapeMs(tape), text });
  };

  /** Stop recording and store the finished segment on its shot/version. */
  const finalizeTape = async () => {
    const tape = tapeRef.current;
    if (!tape) return;
    tapeRef.current = null;
    tape.timers.forEach(clearInterval);
    setLiveTape(null);
    const ms = tapeMs(tape);
    const recorder = tape.recorder;
    if (!recorder || ms < 300) {
      // Nothing was captured: drop the empty segment and any version left empty.
      updateShot(tape.shotId, (s) => {
        const versions = s.versions
          .map((v) => ({ ...v, parts: v.parts.filter((p) => p.segId !== tape.segId) }))
          .filter((v) => v.parts.length);
        return {
          ...s,
          segments: s.segments.filter((x) => x.id !== tape.segId),
          versions,
          activeVersionId: versions.some((v) => v.id === s.activeVersionId)
            ? s.activeVersionId
            : (versions.at(-1)?.id ?? null),
        };
      });
      recorder?.state !== "inactive" && recorder?.stop();
      return;
    }
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    const blob = new Blob(tape.chunks, { type: recorder.mimeType || "video/webm" });
    updateShot(tape.shotId, (s) => ({
      ...s,
      segments: s.segments.map((seg) =>
        seg.id === tape.segId
          ? { ...seg, blob, durationMs: ms, frames: [...tape.frames], marks: [...tape.marks] }
          : seg,
      ),
      versions: s.versions.map((v) => ({
        ...v,
        parts: v.parts.map((p) => (p.segId === tape.segId && p.to === null ? { ...p, to: ms } : p)),
      })),
    }));
  };

  finalizeRef.current = finalizeTape;

  // Keep the tape in step with Orbis: pause with it, finish when the run ends.
  useEffect(() => {
    const tape = tapeRef.current;
    if (!tape?.recorder) return;
    if (session.paused && tape.resumedAt) {
      tape.acc += Date.now() - tape.resumedAt;
      tape.resumedAt = null;
      if (tape.recorder.state === "recording") tape.recorder.pause();
    } else if (!session.paused && !tape.resumedAt) {
      tape.resumedAt = Date.now();
      if (tape.recorder.state === "paused") tape.recorder.resume();
    }
  }, [session.paused]);
  useEffect(() => {
    if (!session.runStarted && tapeRef.current && !session.controlsBusy) void finalizeTape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.runStarted, session.controlsBusy]);

  // ---- Review: scrub back through the tape ----
  const [cursor, setCursor] = useState<number | null>(null);
  cursorRef.current = cursor;
  useEffect(() => setReviewing(cursor !== null), [cursor]);
  const [reviewPlaying, setReviewPlaying] = useState(false);
  const [reviewStart, setReviewStart] = useState(0);
  const [exporting, setExporting] = useState<{ id: string; progress: number } | null>(null);
  const activeVersion = shot?.versions.find((v) => v.id === shot.activeVersionId) ?? null;
  const tapeForActive =
    liveTape && activeVersion?.parts.some((p) => p.segId === liveTape.segId) ? liveTape : null;

  useEffect(() => {
    setCursor(null);
    setReviewPlaying(false);
  }, [selectedId, shot?.activeVersionId]);

  const enterReview = () => {
    if (isLiveHere && !session.paused) void session.pause();
  };
  const scrub = (t: number) => {
    enterReview();
    setReviewPlaying(false);
    setCursor(Math.max(0, t));
  };
  const backToLive = () => {
    setCursor(null);
    setReviewPlaying(false);
    if (session.paused) void session.resume();
  };
  /** Segments for playback, with the still-recording one as a playable snapshot. */
  const playable = () => {
    if (!shot || !activeVersion) return null;
    const tape = tapeRef.current;
    let segments = shot.segments;
    let parts = activeVersion.parts;
    if (tape && tapeForActive) {
      const ms = tapeMs(tape);
      segments = segments.map((s) =>
        s.id === tape.segId ? { ...s, blob: new Blob(tape.chunks, { type: "video/webm" }), durationMs: ms } : s,
      );
      parts = parts.map((p) => (p.to === null ? { ...p, to: ms } : p));
    }
    return { segments, parts };
  };
  const [playback, setPlayback] = useState<ReturnType<typeof playable>>(null);
  const playFromHere = () => {
    const chain = playable();
    if (!chain || !activeVersion) return;
    enterReview();
    const length = versionLength({ ...activeVersion, parts: chain.parts });
    const from = cursor === null || cursor >= length - 300 ? 0 : cursor;
    setPlayback(chain);
    setReviewStart(from);
    setCursor(from);
    setReviewPlaying(true);
  };

  const exportActive = async (id: string) => {
    const v = shot?.versions.find((x) => x.id === id);
    if (!shot || !v) return;
    setExporting({ id, progress: 0 });
    try {
      const blob = await exportVersion(v.parts, shot.segments, (progress) => setExporting({ id, progress }));
      downloadBlob(blob, `${slug(shot.title)}-v${v.n}.webm`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const deleteVersion = (id: string) =>
    updateShot(shot!.id, (s) => {
      const versions = s.versions.filter((v) => v.id !== id);
      const used = new Set(versions.flatMap((v) => v.parts.map((p) => p.segId)));
      return {
        ...s,
        versions,
        segments: s.segments.filter((seg) => used.has(seg.id)),
        activeVersionId: s.activeVersionId === id ? (versions.at(-1)?.id ?? null) : s.activeVersionId,
        heroId: s.heroId === id ? null : s.heroId,
      };
    });

  // ---- Shots ----
  const addShot = (partial: Partial<Shot> = {}, afterIndex = shots.length - 1) => {
    const created = newShot({ title: `Shot ${shots.length + 1}`, ...partial });
    updateBoard((b) => {
      const next = [...b.shots];
      next.splice(afterIndex + 1, 0, created);
      return { ...b, shots: next };
    });
    selectShot(created.id);
    setSelectedId(created.id);
  };

  const removeShot = (id: string) => {
    if (shots.length <= 1) return;
    const index = shots.findIndex((s) => s.id === id);
    updateBoard((b) => ({ ...b, shots: b.shots.filter((s) => s.id !== id) }));
    const neighbour = shots[index + 1] ?? shots[index - 1];
    if (neighbour) setSelectedId(neighbour.id);
  };

  const moveShot = (id: string, delta: number) =>
    updateBoard((b) => {
      const i = b.shots.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= b.shots.length) return b;
      const next = [...b.shots];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...b, shots: next };
    });

  const setReference = async (id: string, file: Blob | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Drop an image (JPG, PNG, WebP).");
      return;
    }
    try {
      const cropped = await to16x9(file);
      updateShot(id, (s) => ({ ...s, refImage: cropped }));
    } catch {
      setNotice("Couldn't read that image.");
    }
  };

  const onDropRef = (id: string) => (event: DragEvent) => {
    event.preventDefault();
    setDropHint(null);
    const archived = event.dataTransfer.getData(DRAG_IMAGE);
    if (archived) {
      const img = board?.imageArchive.find((x) => x.id === archived);
      if (img) updateShot(id, (s) => ({ ...s, refImage: img.blob }));
      return;
    }
    void setReference(id, event.dataTransfer.files?.[0]);
  };

  // ---- Archive (prompts + images collected before shooting) ----
  const [dropHint, setDropHint] = useState<"tell" | "scene" | "ref" | null>(null);
  const acceptsPrompt = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_PROMPT);
  const acceptsImage = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_IMAGE) || e.dataTransfer.types.includes("Files");
  const usePrompt = (text: string) => {
    applyDirections(active, text);
    setNotice(isLiveHere ? `Directing: “${text.slice(0, 80)}”` : "Prompt set — it applies when you shoot.");
  };
  const addPrompts = (texts: string[], source: string) =>
    updateBoard((b) => ({
      ...b,
      promptArchive: [...b.promptArchive, ...texts.map((text) => ({ id: uid(), text, source }))],
    }));
  const addArchiveImages = async (files: Blob[], names?: string[]) => {
    const added: { id: string; blob: Blob; name: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        added.push({ id: uid(), blob: await to16x9(files[i]), name: names?.[i] ?? (files[i] as File).name ?? "image" });
      } catch {
        // skip unreadable files
      }
    }
    if (added.length) updateBoard((b) => ({ ...b, imageArchive: [...b.imageArchive, ...added] }));
  };

  const [presenting, setPresenting] = useState(false);

  const leaveLiveIfOtherBoard = async (nextId: string) => {
    if (board && board.id !== nextId && (session.runStarted || tapeRef.current)) await stopShot();
  };
  const openBoard = async (id: string) => {
    await leaveLiveIfOtherBoard(id);
    const next = id === board?.id ? board : boards?.find((b) => b.id === id);
    if (!next) return;
    if (next !== board) {
      setBoard(sanitizeBoard(next));
      setSelectedId(next.shots[0]?.id ?? "");
    }
    rememberBoard(id);
    setView("studio");
  };
  const newProduction = async () => {
    const created = newBoard();
    created.title = "Untitled production";
    await saveBoard(created);
    setBoards((list) => [created, ...(list ?? [])]);
    await leaveLiveIfOtherBoard(created.id);
    setBoard(created);
    setSelectedId(created.shots[0]?.id ?? "");
    rememberBoard(created.id);
    setView("studio");
  };
  const removeProduction = async (id: string) => {
    await deleteBoard(id);
    setBoards((list) => (list ?? []).filter((b) => b.id !== id));
    if (board?.id === id) setBoard(null);
  };

  if (!boards) {
    return <div className="sb" data-theme={theme} data-hints={hints ? "on" : "off"}><div className="sb-loading">Loading…</div></div>;
  }

  if (view === "projects" || !board || !shot) {
    return (
      <div className="sb" data-theme={theme} data-hints={hints ? "on" : "off"}>
        <div className="sb-topbar">
          <div className="sb-brand">
            <span className="sb-logo" aria-hidden><i /><i /><i /></span>
            <div className="sb-brand-name">Living Storyboard</div>
          </div>
          <div className="sb-topbar-actions">
            <span className={`sb-status sb-status-${session.runStarted ? "live" : session.status}`}>
              <span className="dot" />
              {session.runStarted ? "Live" : session.connected ? "Connected" : "Offline"}
            </span>
            {hintsButton}
            <button className="sb-icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode">{theme === "light" ? "☾" : "☀"}</button>
          </div>
        </div>
        <Projects
          boards={boards}
          liveBoardId={playing && board ? board.id : null}
          liveShotTitle={playing ? (playingShot?.title ?? null) : null}
          lastId={lastBoardId()}
          onOpen={(id) => void openBoard(id)}
          onNew={() => void newProduction()}
          onDelete={(id) => void removeProduction(id)}
        />
      </div>
    );
  }

  const stageLength = activeVersion ? versionLength(activeVersion, tapeForActive?.ms ?? 0) : 0;
  const reviewFrame =
    activeVersion && cursor !== null
      ? frameAtVersion(activeVersion, cursor, shot.segments, tapeForActive)
      : null;
  const stageStill =
    (activeVersion &&
      frameAtVersion(activeVersion, cursor ?? Math.max(0, stageLength - 1), shot.segments, tapeForActive)) ||
    shot.refImage;

  const status = session.status;
  const statusLabel =
    status === "ready"
      ? session.runStarted
        ? "Live"
        : "Connected"
      : status === "disconnected"
        ? "Offline"
        : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className="sb" data-theme={theme} data-hints={hints ? "on" : "off"}>
      {/* ---------- Top bar ---------- */}
      <div className="sb-topbar">
        <div className="sb-brand">
          <button className="sb-logo sb-logo-btn" onClick={() => setView("projects")} title="All productions" aria-label="All productions">
            <i /><i /><i />
          </button>
          <div>
            <button className="sb-eyebrow sb-crumb" onClick={() => setView("projects")}>← Productions</button>
            <input
              className="sb-board-title"
              value={board.title}
              aria-label="Production title"
              onChange={(e) => updateBoard((b) => ({ ...b, title: e.target.value }))}
            />
          </div>
        </div>

        <div className="sb-topbar-actions">
          <span className={`sb-status sb-status-${session.runStarted ? "live" : status}`}>
            <span className="dot" />
            {statusLabel}
            {connectedAt && <span className="sb-mono">{formatClock(now - connectedAt)}</span>}
          </span>
          {!session.connected ? (
            <button
              className="sb-btn sb-btn-primary"
              disabled={session.controlsBusy || status === "connecting"}
              onClick={() => void session.connectSession()}
            >
              {status === "connecting" || status === "waiting" ? "Connecting…" : "Connect to Orbis"}
            </button>
          ) : (
            <button
              className="sb-btn"
              disabled={session.controlsBusy}
              onClick={async () => {
                await finalizeTape();
                setPlayingId(null);
                setCursor(null);
                void session.disconnectSession();
              }}
            >
              Disconnect
            </button>
          )}
          <button className="sb-btn" onClick={() => setPresenting(true)}>
            Present
          </button>
          {hintsButton}
          <button
            className="sb-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </div>

      {(session.error || notice) && (
        <div className={`sb-toast ${session.error ? "is-error" : ""}`} role="status">
          <span>{session.error || notice}</span>
          <button
            aria-label="Dismiss"
            onClick={() => {
              session.clearError();
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="sb-workspace sb-workspace-3">
        <ArchivePanel
          scene={shot.description}
          prompts={board.promptArchive}
          images={board.imageArchive}
          onAddPrompts={addPrompts}
          onSetPrompts={(next) => updateBoard((b) => ({ ...b, promptArchive: next }))}
          onUsePrompt={usePrompt}
          onAddImages={(files) => void addArchiveImages(files)}
          onRemoveImage={(id) => updateBoard((b) => ({ ...b, imageArchive: b.imageArchive.filter((x) => x.id !== id) }))}
          onUseImage={(img) => {
            updateShot(shot.id, (s) => ({ ...s, refImage: img.blob }));
            setNotice(`“${img.name}” is now the reference frame for ${shot.title || "this shot"}.`);
          }}
        />

        {/* ---------- Play area ---------- */}
        <section className="sb-stage-col">
          <ShotList
            shots={shots}
            selectedId={shot.id}
            liveId={playing ? playingId : null}
            onSelect={selectShot}
            onAdd={() => addShot()}
            onMove={moveShot}
            onDelete={removeShot}
            onDropRef={onDropRef}
          />
          <div className="sb-stage" ref={stageRef}>
            {session.runStarted ? (
              <div className="sb-live-layer" ref={liveRef}>
                <ReactorView
                  track="main_video"
                  audioTrack="main_audio"
                  muted={session.muted}
                  videoObjectFit="cover"
                />
              </div>
            ) : stageStill ? (
              <img src={blobUrl(stageStill)} alt="" className={`sb-stage-ref ${activeVersion ? "is-tape" : ""}`} />
            ) : (
              <div className="sb-stage-empty">
                <div className="sb-frame-marks" aria-hidden />
              </div>
            )}

            {/* Review layer: scrubbed frame, or playback of the recorded tape */}
            {reviewPlaying && playback ? (
              <div className="sb-review-layer">
                <ChainPlayer
                  className="sb-review-video"
                  parts={playback.parts}
                  segments={playback.segments}
                  startAt={reviewStart}
                  onTime={(ms) => setCursor(ms)}
                  onEnded={() => setReviewPlaying(false)}
                />
              </div>
            ) : cursor !== null && activeVersion && session.runStarted && reviewFrame ? (
              <div className="sb-review-layer">
                <img src={blobUrl(reviewFrame)} alt="" />
              </div>
            ) : null}

            {!session.runStarted && !reviewPlaying && cursor === null && (
              <div className="sb-stage-overlay">
                {!session.connected ? (
                  <span>{activeVersion ? "Scrub the tape below, or connect to redirect" : "Connect to Orbis to bring this shot to life"}</span>
                ) : session.controlsBusy && playingId ? (
                  <span className="sb-pulse">Setting the scene…</span>
                ) : (
                  <button className="sb-play-big" onClick={() => void playShot()} disabled={session.controlsBusy}>
                    ▶ {activeVersion ? "New take of" : "Shoot"} {shot.title || `Shot ${selectedIndex + 1}`}
                  </button>
                )}
              </div>
            )}

            {cursor !== null || reviewPlaying ? (
              <span className="sb-live-tag sb-review-tag">
                ⏪ REVIEW · TAKE {activeVersion?.n ?? 1} · {formatClock(cursor ?? 0)}
                {isLiveHere && " · live paused"}
              </span>
            ) : playing ? (
              <span className="sb-live-tag">
                ● LIVE · {isLiveHere ? `TAKE ${activeVersion?.n ?? 1}` : playingShot?.title || "Shot"}
              </span>
            ) : activeVersion ? (
              <span className="sb-live-tag sb-idle-tag">TAKE {activeVersion.n}</span>
            ) : null}
            <span className="sb-lens-tag">
              {controls.lens || "Auto lens"} · 16:9{tapeForActive && cursor === null && !reviewPlaying ? ` · REC ${formatClock(tapeForActive.ms)}` : ""}
            </span>
            {isLiveHere && cursor === null && lastDirection?.shotId === shot.id && (
              <span className={`sb-caption ${now - lastDirection.at < 2500 ? "is-applying" : ""}`}>
                <span className="sb-caption-text">“{lastDirection.text}”</span>
                <span className="sb-caption-state">{now - lastDirection.at < 2500 ? "Applying" : "Applied"}</span>
              </span>
            )}
            {speech.listening && (
              <span className="sb-caption sb-caption-voice">
                <span className="sb-mic-dot" /> <span className="sb-caption-text">{speech.interim || "Listening…"}</span>
              </span>
            )}
            {flash && <div className="sb-flash" />}
          </div>

          <div className="sb-transport">
            <div className="sb-transport-group">
              {isLiveHere ? (
                <>
                  <button className="sb-btn" onClick={() => void playShot()} disabled={session.controlsBusy} title="Start a brand-new take from the reference frame">
                    ↻ New take
                  </button>
                  <button className="sb-btn" onClick={() => void stopShot()} disabled={session.controlsBusy}>
                    ■ Cut
                  </button>
                </>
              ) : (
                <button
                  className="sb-btn sb-btn-primary"
                  onClick={() => void playShot()}
                  disabled={!session.connected || session.controlsBusy}
                >
                  ▶ {playing ? "Switch to this shot" : activeVersion ? "New take" : "Shoot live"}
                </button>
              )}
              {playing && cursor === null && (
                <button
                  className="sb-btn"
                  disabled={session.controlsBusy}
                  onClick={() => void (session.paused ? session.resume() : session.pause())}
                >
                  {session.paused ? "Resume" : "Pause"}
                </button>
              )}
            </div>
            <div className="sb-transport-group">
              <button className="sb-btn" onClick={() => void captureStill()} disabled={!playing && cursor === null}>
                ◉ Capture still
              </button>
              <button className="sb-icon-btn" onClick={session.toggleMuted} title="Sound">
                {session.muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          <Timeline
            version={activeVersion}
            versions={shot.versions}
            segments={shot.segments}
            live={tapeForActive}
            isLive={isLiveHere}
            cursor={cursor}
            reviewPlaying={reviewPlaying}
            canRedirect={session.connected}
            busy={session.controlsBusy}
            heroId={shot.heroId}
            exporting={exporting}
            onScrub={scrub}
            onBack={(sec) => {
              const len = activeVersion ? versionLength(activeVersion, tapeForActive?.ms ?? 0) : 0;
              scrub(Math.max(0, (cursor ?? len) - sec * 1000));
            }}
            onBackToLive={backToLive}
            onPlayFromHere={playFromHere}
            onStopReview={() => setReviewPlaying(false)}
            onRedirect={() => void redirectFromCursor()}
            onSelectVersion={(id) => updateShot(shot.id, (s) => ({ ...s, activeVersionId: id }))}
            onHero={(id) => updateShot(shot.id, (s) => ({ ...s, heroId: s.heroId === id ? null : id }))}
            onExport={(id) => void exportActive(id)}
            onDelete={deleteVersion}
          />

          <div className="sb-section-label">Stills · {shot.title || `Shot ${selectedIndex + 1}`}</div>
          <TakesGallery
            shot={shot}
            onHero={(id) => updateShot(shot.id, (s) => ({ ...s, heroId: s.heroId === id ? null : id }))}
            onDeleteStill={(id) =>
              updateShot(shot.id, (s) => ({
                ...s,
                stills: s.stills.filter((x) => x.id !== id),
                heroId: s.heroId === id ? null : s.heroId,
              }))
            }
            onDeleteTake={(id) =>
              updateShot(shot.id, (s) => ({
                ...s,
                takes: s.takes.filter((x) => x.id !== id),
                heroId: s.heroId === id ? null : s.heroId,
              }))
            }
            onUseAsReference={(blob) => updateShot(shot.id, (s) => ({ ...s, refImage: blob }))}
            onArchive={(blob) => {
              void addArchiveImages([blob], [`${shot.title || "Shot"} still`]);
              setNotice("Still added to the image archive.");
            }}
            onNewShotFrom={(blob) =>
              addShot({ refImage: blob, description: shot.description }, selectedIndex)
            }
          />
        </section>

        {/* ---------- Direction panel ---------- */}
        <aside className="sb-panel sb-panel-clean">
          {/* 1. Shot + setting */}
          <div className="sb-panel-head">
            <span className="sb-shot-num">{String(selectedIndex + 1).padStart(2, "0")}</span>
            <input
              className="sb-shot-title"
              value={shot.title}
              placeholder={`Shot ${selectedIndex + 1}`}
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, title: e.target.value }))}
            />
          </div>
          <label
            className={`sb-setting ${dropHint === "scene" ? "is-drop" : ""}`}
            title="The fixed setup of this shot — included in every prompt"
            onDragOver={(e) => {
              if (!acceptsPrompt(e)) return;
              e.preventDefault();
              setDropHint("scene");
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(e) => {
              const text = e.dataTransfer.getData(DRAG_PROMPT);
              if (!text) return;
              e.preventDefault();
              setDropHint(null);
              updateShot(shot.id, (s) => ({ ...s, description: text }));
            }}
          >
            <span>Setting</span>
            <input
              value={shot.description}
              placeholder="Who and where — e.g. a golden retriever in a sunny living room"
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, description: e.target.value }))}
            />
          </label>

          {/* 2. Direction: type or hold to speak */}
          <div
            className={`sb-tell ${dropHint === "tell" ? "is-drop" : ""}`}
            onDragOver={(e) => {
              if (!acceptsPrompt(e)) return;
              e.preventDefault();
              setDropHint("tell");
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(e) => {
              const text = e.dataTransfer.getData(DRAG_PROMPT);
              if (!text) return;
              e.preventDefault();
              setDropHint(null);
              usePrompt(text);
            }}
          >
            <div className="sb-section-label">
              Direction {isLiveHere ? <em className="sb-live-hint">live — lands in ~2s</em> : <em>what happens now</em>}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <textarea
                rows={3}
                value={speech.listening ? speech.interim : customDraft}
                placeholder="Type, speak, or drop a prompt from the archive — e.g. the dog jumps on her happily, then starts eating."
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitCustom();
                  }
                }}
              />
              <div className="sb-tell-actions">
                <button
                  type="button"
                  className={`sb-btn sb-mic ${speech.listening ? "is-on" : ""}`}
                  disabled={!speech.supported}
                  title={speech.supported ? "Hold to speak a direction" : "Voice input needs Google Chrome"}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    speech.start();
                  }}
                  onPointerUp={speech.stop}
                  onPointerLeave={() => speech.listening && speech.stop()}
                >
                  🎙 {speech.listening ? "Listening…" : "Hold to speak"}
                </button>
                <button className="sb-btn sb-btn-primary" type="submit">
                  {isLiveHere ? "⚡ Direct" : "Set"}
                </button>
              </div>
              {speech.error && <p className="sb-field-error">{speech.error}</p>}
            </form>
            {custom && (
              <button className="sb-link sb-clear-action" onClick={() => applyDirections(active, "")}>
                Clear “{custom.length > 40 ? custom.slice(0, 40) + "…" : custom}”
              </button>
            )}
          </div>

          {/* 3. Reference frame (compact) */}
          <div
            className={`sb-ref-compact ${dropHint === "ref" ? "is-drop" : ""}`}
            onDragOver={(e) => {
              if (!acceptsImage(e)) return;
              e.preventDefault();
              setDropHint("ref");
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={onDropRef(shot.id)}
          >
            <label className="sb-ref-thumb" title="Drop an image here, or click to choose">
              <input type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => void setReference(shot.id, e.target.files?.[0])} />
              {shot.refImage ? <img src={blobUrl(shot.refImage)} alt="Reference frame" /> : <span>＋</span>}
            </label>
            <div className="sb-ref-text">
              <span className="sb-section-label">Reference frame</span>
              <span>{shot.refImage ? "Orbis starts from this image." : "Optional — drop an image from the archive."}</span>
              {shot.refImage && (
                <button className="sb-link" onClick={() => updateShot(shot.id, (s) => ({ ...s, refImage: null }))}>
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* 4. Pills */}
          <div className="sb-directions">
            <div className="sb-section-label">Shot</div>
            {DIRECTION_GROUPS.filter((g) => g.id === "camera" || g.id === "shot").map((group) => (
              <ChipGroup key={group.id} group={group} active={active} onToggle={toggleChip} />
            ))}
            <div className="sb-chip-group" style={{ ["--accent" as string]: "#111" }}>
              <span className="sb-chip-label">Lens</span>
              <div className="sb-chips">
                {LENSES.map((l) => (
                  <button
                    key={l.label}
                    className={`sb-chip sb-chip-lens ${controls.lens === l.label ? "is-on" : ""}`}
                    aria-pressed={controls.lens === l.label}
                    onClick={() => setControl("lens", controls.lens === l.label ? "" : l.label)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            {DIRECTION_GROUPS.filter((g) => g.id === "mood").map((group) => (
              <ChipGroup key={group.id} group={group} active={active} onToggle={toggleChip} />
            ))}
          </div>

          {/* 5. Sliders */}
          <div className="sb-directions sb-sliders">
            <div className="sb-section-label">Feel</div>
            <Slider label="Move speed" left="Slow" right="Fast" color="#2f6bff" value={controls.speed} onChange={(v) => setControl("speed", v)} />
            <Slider label="Warmth" left="Cool" right="Warm" color="#ff8a00" gradient="linear-gradient(90deg,#5aa9ff,#d8d8d8,#ffb347)" value={controls.warmth} onChange={(v) => setControl("warmth", v)} />
            <Slider label="Light level" left="Dark" right="Bright" color="#111" gradient="linear-gradient(90deg,#111,#eee)" value={controls.key} onChange={(v) => setControl("key", v)} />
          </div>

          {/* 6. Folded extras */}
          <details className="sb-fold">
            <summary>Notes for cast &amp; crew{shot.notes ? " ·  ✓" : ""}</summary>
            <textarea
              rows={3}
              value={shot.notes}
              placeholder="Intent, blocking, performance notes, props… shown in Present mode."
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, notes: e.target.value }))}
            />
          </details>
          {shot.directions.length > 0 && (
            <details className="sb-fold sb-history">
              <summary>Direction log · {shot.directions.length}</summary>
              <ol>
                {[...shot.directions].reverse().slice(0, 12).map((d) => (
                  <li key={d.at}>
                    <time>{new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                    {d.text}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </aside>
      </div>

      {presenting && (
        <PresentMode
          board={board}
          startIndex={selectedIndex}
          onClose={() => setPresenting(false)}
        />
      )}
    </div>
  );
}

function TakesGallery({
  shot,
  onHero,
  onDeleteStill,
  onDeleteTake,
  onUseAsReference,
  onNewShotFrom,
  onArchive,
}: {
  shot: Shot;
  onHero: (id: string) => void;
  onDeleteStill: (id: string) => void;
  onDeleteTake: (id: string) => void;
  onUseAsReference: (blob: Blob) => void;
  onNewShotFrom: (blob: Blob) => void;
  onArchive: (blob: Blob) => void;
}) {
  const items = useMemo(
    () =>
      [
        ...shot.stills.map((s) => ({ kind: "still" as const, ...s })),
        ...shot.takes.map((t) => ({ kind: "take" as const, ...t })),
      ].sort((a, b) => b.createdAt - a.createdAt),
    [shot.stills, shot.takes],
  );

  if (!items.length) {
    return (
      <div className="sb-takes-empty">
        Stills you capture (live or while scrubbing the tape) collect here. Star one to make it the frame your crew sees.
      </div>
    );
  }

  const base = slug(shot.title);
  return (
    <div className="sb-takes">
      {items.map((item, i) => (
        <figure key={item.id} className={`sb-take ${shot.heroId === item.id ? "is-hero" : ""}`}>
          {item.kind === "still" ? (
            <img src={blobUrl(item.blob)} alt="" />
          ) : (
            <video src={blobUrl(item.blob)} muted loop playsInline onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
          )}
          <span className="sb-take-kind">
            {item.kind === "still" ? "Still" : `Take · ${formatClock(item.durationMs)}`}
          </span>
          <figcaption>
            <button title="Show this in Present mode" className={shot.heroId === item.id ? "is-on" : ""} onClick={() => onHero(item.id)}>★</button>
            {item.kind === "still" && (
              <>
                <button title="Use as this shot's reference frame" onClick={() => onUseAsReference(item.blob)}>⤒ Ref</button>
                <button title="Start a new shot from this frame" onClick={() => onNewShotFrom(item.blob)}>＋ Shot</button>
                <button title="Save to the image archive" onClick={() => onArchive(item.blob)}>⇢ Arch</button>
              </>
            )}
            <button title="Download" onClick={() => downloadBlob(item.blob, `${base}-${item.kind}-${items.length - i}.${extFor(item.blob)}`)}>↓</button>
            <button title="Delete" onClick={() => (item.kind === "still" ? onDeleteStill(item.id) : onDeleteTake(item.id))}>✕</button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function ChipGroup({
  group,
  active,
  onToggle,
}: {
  group: (typeof DIRECTION_GROUPS)[number];
  active: ActiveDirections;
  onToggle: (groupId: string, label: string) => void;
}) {
  return (
    <div className="sb-chip-group" style={{ ["--accent" as string]: group.color }}>
      <span className="sb-chip-label">{group.label}</span>
      <div className="sb-chips">
        {group.chips.map((chip) => {
          const on = (active[group.id] ?? []).includes(chip.label);
          return (
            <button
              key={chip.label}
              className={`sb-chip ${on ? "is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggle(group.id, chip.label)}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Slider that commits on release, so dragging sends one direction, not dozens. */
function Slider({
  label,
  left,
  right,
  color,
  gradient,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  color: string;
  gradient?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onChange(draft);
  return (
    <label className="sb-slider" style={{ ["--accent" as string]: color, ["--track" as string]: gradient ?? "var(--surface-2)" }}>
      <span className="sb-slider-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => setDraft(+e.target.value)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="sb-slider-ends">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </label>
  );
}
