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

import { PresentMode } from "@/components/storyboard/present-mode";
import { useOrbisSession } from "@/hooks/use-orbis-session";
import { ORBIS_MODEL_NAME, ORBIS_TRACKS, requestReactorJwt } from "@/lib/orbis";
import {
  type ActiveDirections,
  type Board,
  composePrompt,
  describeActive,
  DIRECTION_GROUPS,
  downloadBlob,
  extFor,
  formatClock,
  grabFrame,
  loadBoard,
  newBoard,
  newShot,
  pickRecorderMime,
  saveBoard,
  type Shot,
  slug,
  to16x9,
  uid,
} from "@/lib/storyboard";

// Object URLs for blobs, created once per blob.
const urlCache = new WeakMap<Blob, string>();
export function blobUrl(blob: Blob | null | undefined) {
  if (!blob) return "";
  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
  }
  return url;
}

/** Best image to represent a shot: chosen hero still, latest still, reference. */
export function coverFor(shot: Shot): Blob | null {
  const hero = shot.stills.find((s) => s.id === shot.heroId);
  return hero?.blob ?? shot.stills.at(-1)?.blob ?? shot.refImage;
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

  // ---- Board state (persisted locally in IndexedDB) ----
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    void loadBoard().then((saved) => {
      const next = saved ?? newBoard();
      setBoard(next);
      setSelectedId(next.shots[0]?.id ?? "");
    });
  }, []);
  useEffect(() => {
    if (!board) return;
    const timer = setTimeout(() => void saveBoard(board), 400);
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

  // ---- Direction state for the selected shot ----
  const [dirs, setDirs] = useState<
    Record<string, { active: ActiveDirections; custom: string; draft: string }>
  >({});
  const current = (shot && dirs[shot.id]) || { active: {}, custom: "", draft: "" };
  const active = current.active;
  const custom = current.custom;
  const customDraft = current.draft;
  const patchDirs = (patch: Partial<typeof current>) =>
    shot && setDirs((d) => ({ ...d, [shot.id]: { ...current, ...patch } }));
  const setCustomDraft = (draft: string) => patchDirs({ draft });
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playing = session.runStarted && playingId !== null;
  const playingShot = shots.find((s) => s.id === playingId);
  const isLiveHere = playing && playingId === shot?.id;

  const prompt = shot ? composePrompt(shot.description, active, custom) : "";

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
  const liveSummary = describeActive(active, custom);
  useEffect(() => {
    if (!isLiveHere || !shot || !prompt || prompt === lastSentPrompt.current) return;
    const timer = setTimeout(() => {
      lastSentPrompt.current = prompt;
      void session.steerWith(prompt);
      logDirection(shot.id, liveSummary || "Scene only");
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, isLiveHere]);

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

  const selectShot = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
  };

  const playShot = async () => {
    if (!shot) return;
    if (!prompt) {
      setNotice("Describe the scene first — Orbis needs words to start from.");
      return;
    }
    const file = shot.refImage
      ? new File([shot.refImage], `${slug(shot.title)}.jpg`, {
          type: shot.refImage.type || "image/jpeg",
        })
      : null;
    setPlayingId(shot.id);
    lastSentPrompt.current = prompt;
    const ok = await session.startShot(file, prompt);
    if (ok) logDirection(shot.id, `▶ Started${describeActive(active, custom) ? ` — ${describeActive(active, custom)}` : ""}`);
    else setPlayingId(null);
  };

  const stopShot = async () => {
    if (recording) stopRecording();
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
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (
        session.connected &&
        !session.runStarted &&
        !session.controlsBusy &&
        Date.now() - lastActivity.current > IDLE_DISCONNECT_MS
      ) {
        setNotice("Disconnected after 3 idle minutes to save credits.");
        void session.disconnectSession();
      }
    }, 1_000);
    return () => clearInterval(t);
  }, [session]);

  // ---- Capture ----
  const stageRef = useRef<HTMLDivElement>(null);
  const getVideo = () =>
    stageRef.current?.querySelector("video") as HTMLVideoElement | null;

  const [flash, setFlash] = useState(false);
  const captureStill = async () => {
    const video = getVideo();
    const target = playingId;
    if (!video || !target || !video.videoWidth) {
      setNotice("Nothing on screen to capture yet.");
      return;
    }
    const blob = await grabFrame(video);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const id = uid();
    updateShot(target, (s) => ({
      ...s,
      stills: [...s.stills, { id, blob, createdAt: Date.now() }],
      heroId: s.heroId ?? id,
    }));
  };

  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState<{ startedAt: number; shotId: string } | null>(null);
  const startRecording = () => {
    const video = getVideo();
    if (!video || !playingId) return;
    const stream =
      (video.srcObject as MediaStream | null) ??
      (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    if (!stream) {
      setNotice("This browser can't record the stream.");
      return;
    }
    const mimeType = pickRecorderMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const shotId = playingId;
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) return;
      updateShot(shotId, (s) => ({
        ...s,
        takes: [
          ...s.takes,
          { id: uid(), blob, createdAt: Date.now(), durationMs: Date.now() - startedAt },
        ],
      }));
      setNotice("Take saved to the shot.");
    };
    recorder.start(500);
    recorderRef.current = recorder;
    setRecording({ startedAt, shotId });
  };
  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(null);
  };
  useEffect(() => {
    if (!session.runStarted && recorderRef.current) stopRecording();
  }, [session.runStarted]);

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
    void setReference(id, event.dataTransfer.files?.[0]);
  };

  const [presenting, setPresenting] = useState(false);

  if (!board || !shot) {
    return <div className="sb" data-theme={theme}><div className="sb-loading">Loading board…</div></div>;
  }

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
    <div className="sb" data-theme={theme}>
      {/* ---------- Top bar ---------- */}
      <div className="sb-topbar">
        <div className="sb-brand">
          <span className="sb-logo" aria-hidden>
            <i /><i /><i />
          </span>
          <div>
            <div className="sb-eyebrow">Living Storyboard</div>
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
              onClick={() => {
                if (recording) stopRecording();
                setPlayingId(null);
                void session.disconnectSession();
              }}
            >
              Disconnect
            </button>
          )}
          <button className="sb-btn" onClick={() => setPresenting(true)}>
            Present
          </button>
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

      <div className="sb-workspace">
        {/* ---------- Stage ---------- */}
        <section className="sb-stage-col">
          <div className="sb-stage" ref={stageRef}>
            {session.runStarted ? (
              <ReactorView
                track="main_video"
                audioTrack="main_audio"
                muted={session.muted}
                videoObjectFit="cover"
              />
            ) : shot.refImage ? (
              <img src={blobUrl(shot.refImage)} alt="" className="sb-stage-ref" />
            ) : (
              <div className="sb-stage-empty">
                <div className="sb-frame-marks" aria-hidden />
              </div>
            )}

            {!session.runStarted && (
              <div className="sb-stage-overlay">
                {!session.connected ? (
                  <span>Connect to Orbis to bring this shot to life</span>
                ) : session.controlsBusy && playingId ? (
                  <span className="sb-pulse">Setting the scene…</span>
                ) : (
                  <button className="sb-play-big" onClick={() => void playShot()} disabled={session.controlsBusy}>
                    ▶ Play {shot.title || `Shot ${selectedIndex + 1}`}
                  </button>
                )}
              </div>
            )}

            {playing && (
              <span className="sb-live-tag">
                ● LIVE · {playingShot?.title || "Shot"}
              </span>
            )}
            {recording && (
              <span className="sb-rec-tag">
                REC {formatClock(now - recording.startedAt)}
              </span>
            )}
            {flash && <div className="sb-flash" />}
          </div>

          <div className="sb-transport">
            <div className="sb-transport-group">
              {isLiveHere ? (
                <>
                  <button className="sb-btn" onClick={() => void playShot()} disabled={session.controlsBusy}>
                    ↻ Retake
                  </button>
                  <button className="sb-btn" onClick={() => void stopShot()} disabled={session.controlsBusy}>
                    ■ Stop
                  </button>
                </>
              ) : (
                <button
                  className="sb-btn sb-btn-primary"
                  onClick={() => void playShot()}
                  disabled={!session.connected || session.controlsBusy}
                >
                  ▶ {playing ? "Switch to this shot" : "Play shot"}
                </button>
              )}
              {playing && (
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
              <button className="sb-btn" onClick={() => void captureStill()} disabled={!playing}>
                ◉ Capture still
              </button>
              {recording ? (
                <button className="sb-btn sb-btn-rec is-on" onClick={stopRecording}>
                  ■ Stop take
                </button>
              ) : (
                <button className="sb-btn sb-btn-rec" onClick={startRecording} disabled={!playing}>
                  ● Record take
                </button>
              )}
              <button className="sb-icon-btn" onClick={session.toggleMuted} title="Sound">
                {session.muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>

          {/* ---------- Board strip ---------- */}
          <section className="sb-board">
            <div className="sb-board-head">
              <span className="sb-section-label">Board · {shots.length} shot{shots.length === 1 ? "" : "s"}</span>
              <div className="sb-board-tools">
                <button className="sb-link" onClick={() => moveShot(shot.id, -1)} disabled={selectedIndex === 0}>← Move</button>
                <button className="sb-link" onClick={() => moveShot(shot.id, 1)} disabled={selectedIndex === shots.length - 1}>Move →</button>
                <button className="sb-link sb-danger" onClick={() => removeShot(shot.id)} disabled={shots.length <= 1}>Delete shot</button>
              </div>
            </div>
            <div className="sb-strip">
              {shots.map((s, i) => {
                const cover = coverFor(s);
                return (
                  <button
                    key={s.id}
                    className={`sb-card ${s.id === shot.id ? "is-selected" : ""} ${s.id === playingId && playing ? "is-live" : ""}`}
                    onClick={() => selectShot(s.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDropRef(s.id)}
                  >
                    <div className="sb-card-thumb">
                      {cover ? <img src={blobUrl(cover)} alt="" /> : <span className="sb-card-empty">{String(i + 1).padStart(2, "0")}</span>}
                      {s.id === playingId && playing && <span className="sb-card-live">LIVE</span>}
                    </div>
                    <div className="sb-card-meta">
                      <span className="sb-card-num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="sb-card-title">{s.title || `Shot ${i + 1}`}</span>
                    </div>
                    <div className="sb-card-counts">
                      {s.stills.length > 0 && <span>{s.stills.length} still{s.stills.length > 1 ? "s" : ""}</span>}
                      {s.takes.length > 0 && <span>{s.takes.length} take{s.takes.length > 1 ? "s" : ""}</span>}
                    </div>
                  </button>
                );
              })}
              <button className="sb-card sb-card-add" onClick={() => addShot()}>
                <span>＋</span>
                New shot
              </button>
            </div>
          </section>

          <div className="sb-section-label">Takes · {shot.title || `Shot ${selectedIndex + 1}`}</div>
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
            onNewShotFrom={(blob) =>
              addShot({ refImage: blob, description: shot.description }, selectedIndex)
            }
          />
        </section>

        {/* ---------- Direction panel ---------- */}
        <aside className="sb-panel">
          <div className="sb-panel-head">
            <span className="sb-shot-num">{String(selectedIndex + 1).padStart(2, "0")}</span>
            <input
              className="sb-shot-title"
              value={shot.title}
              placeholder={`Shot ${selectedIndex + 1}`}
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, title: e.target.value }))}
            />
          </div>

          <label className="sb-field">
            <span>Scene</span>
            <textarea
              rows={3}
              value={shot.description}
              placeholder="Who, where, what happens. e.g. A detective lights a cigarette under a flickering streetlamp."
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, description: e.target.value }))}
            />
          </label>

          <div
            className="sb-field sb-ref"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropRef(shot.id)}
          >
            <span>Reference frame</span>
            {shot.refImage ? (
              <div className="sb-ref-row">
                <img src={blobUrl(shot.refImage)} alt="Reference" />
                <div className="sb-ref-actions">
                  <label className="sb-link">
                    Replace
                    <input type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => void setReference(shot.id, e.target.files?.[0])} />
                  </label>
                  <button className="sb-link" onClick={() => updateShot(shot.id, (s) => ({ ...s, refImage: null }))}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="sb-dropzone">
                <input type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => void setReference(shot.id, e.target.files?.[0])} />
                Drop a sketch, location photo or mood frame
                <small>or click to browse · auto-cropped to 16:9</small>
              </label>
            )}
          </div>

          <div className="sb-directions">
            <div className="sb-section-label">
              Direct {isLiveHere ? <em className="sb-live-hint">live — changes land in ~2s</em> : <em>applies when you press play</em>}
            </div>
            {DIRECTION_GROUPS.map((group) => (
              <div className="sb-chip-group" key={group.id} style={{ ["--accent" as string]: group.color }}>
                <span className="sb-chip-label">{group.label}</span>
                <div className="sb-chips">
                  {group.chips.map((chip) => {
                    const on = (active[group.id] ?? []).includes(chip.label);
                    return (
                      <button
                        key={chip.label}
                        className={`sb-chip ${on ? "is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleChip(group.id, chip.label)}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <form
              className="sb-action"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <input
                value={customDraft}
                placeholder="Action… e.g. she turns toward camera and smiles"
                onChange={(e) => setCustomDraft(e.target.value)}
              />
              <button className="sb-btn sb-btn-primary" type="submit">
                {isLiveHere ? "Direct" : "Set"}
              </button>
            </form>
            {custom && (
              <button className="sb-link sb-clear-action" onClick={() => applyDirections(active, "")}>
                Clear action “{custom}”
              </button>
            )}

            <details className="sb-prompt-preview">
              <summary>Prompt sent to Orbis</summary>
              <p>{prompt || "—"}</p>
            </details>
          </div>

          <label className="sb-field">
            <span>Notes for cast &amp; crew</span>
            <textarea
              rows={3}
              value={shot.notes}
              placeholder="Intent, blocking, performance notes, props… shown in Present mode."
              onChange={(e) => updateShot(shot.id, (s) => ({ ...s, notes: e.target.value }))}
            />
          </label>

          {shot.directions.length > 0 && (
            <div className="sb-history">
              <div className="sb-section-label">Direction log</div>
              <ol>
                {[...shot.directions].reverse().slice(0, 8).map((d) => (
                  <li key={d.at}>
                    <time>{new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                    {d.text}
                  </li>
                ))}
              </ol>
            </div>
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
}: {
  shot: Shot;
  onHero: (id: string) => void;
  onDeleteStill: (id: string) => void;
  onDeleteTake: (id: string) => void;
  onUseAsReference: (blob: Blob) => void;
  onNewShotFrom: (blob: Blob) => void;
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
        Captured stills and recorded takes for this shot collect here. Star one to make it the frame your crew sees.
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
