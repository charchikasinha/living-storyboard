"use client";

import { PointerEvent, useRef } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import {
  type Frame,
  frameAt,
  formatClock,
  locate,
  type Mark,
  partLength,
  type Segment,
  type Version,
  versionLength,
} from "@/lib/storyboard";

export type LiveTape = {
  segId: string;
  frames: Frame[];
  marks: Mark[];
  ms: number;
} | null;

export function framesFor(segId: string, segments: Segment[], live: LiveTape) {
  if (live?.segId === segId) return live.frames;
  return segments.find((s) => s.id === segId)?.frames ?? [];
}

/** Frame shown at version-time t (used for scrubbing and redirecting). */
export function frameAtVersion(v: Version, t: number, segments: Segment[], live: LiveTape) {
  const hit = locate(v, t, live?.ms ?? 0);
  if (!hit) return null;
  return frameAt(framesFor(hit.part.segId, segments, live), hit.local);
}

type Props = {
  version: Version | null;
  versions: Version[];
  segments: Segment[];
  live: LiveTape;
  isLive: boolean;
  cursor: number | null;
  reviewPlaying: boolean;
  canRedirect: boolean;
  busy: boolean;
  heroId: string | null;
  exporting: { id: string; progress: number } | null;
  onScrub: (t: number) => void;
  onBack: (seconds: number) => void;
  onBackToLive: () => void;
  onPlayFromHere: () => void;
  onStopReview: () => void;
  onRedirect: () => void;
  onSelectVersion: (id: string) => void;
  onHero: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
};

export function Timeline(props: Props) {
  const { version, versions, segments, live, isLive, cursor } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  if (!version) {
    return (
      <div className="sb-tape sb-tape-empty">
        <span className="sb-section-label">Tape</span>
        Every run is recorded automatically. Once a shot plays, you can scrub back here and
        redirect from any moment.
      </div>
    );
  }

  const liveMs = live?.ms ?? 0;
  const length = Math.max(1, versionLength(version, liveMs));
  const head = cursor ?? length;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / length) * 100))}%`;

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.round(((clientX - rect.left) / rect.width) * length);
  };
  const down = (e: PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    props.onScrub(timeAt(e.clientX));
  };
  const move = (e: PointerEvent) => dragging.current && props.onScrub(timeAt(e.clientX));
  const up = () => (dragging.current = false);

  // Filmstrip samples, part seams and direction marks in version time.
  const samples = Array.from({ length: 12 }, (_, i) =>
    frameAtVersion(version, ((i + 0.5) / 12) * length, segments, live),
  );
  const seams: number[] = [];
  const marks: { t: number; text: string }[] = [];
  let offset = 0;
  version.parts.forEach((part, i) => {
    if (i > 0) seams.push(offset);
    const len = partLength(part, liveMs);
    const segMarks = live?.segId === part.segId ? live.marks : (segments.find((s) => s.id === part.segId)?.marks ?? []);
    for (const m of segMarks) {
      if (m.t >= part.from && m.t <= part.from + len) marks.push({ t: offset + m.t - part.from, text: m.text });
    }
    offset += len;
  });

  const parent = versions.find((v) => v.id === version.parentId);

  return (
    <div className="sb-tape">
      <div className="sb-tape-head">
        <span className="sb-section-label">
          Tape · v{version.n}
          {parent && version.branchAtMs !== null && (
            <em>redirected from v{parent.n} at {formatClock(version.branchAtMs)}</em>
          )}
        </span>
        <span className="sb-mono sb-tape-clock">
          {formatClock(head)} / {formatClock(length)}
        </span>
      </div>

      <div
        className="sb-track"
        ref={trackRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="slider"
        aria-label="Scrub through the recorded shot"
        aria-valuemin={0}
        aria-valuemax={length}
        aria-valuenow={head}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") props.onScrub(Math.max(0, head - 1000));
          if (e.key === "ArrowRight") props.onScrub(Math.min(length, head + 1000));
        }}
      >
        <div className="sb-filmstrip">
          {samples.map((blob, i) => (
            <div key={i} className="sb-filmstrip-cell">
              {blob && <img src={blobUrl(blob)} alt="" draggable={false} />}
            </div>
          ))}
        </div>
        {cursor !== null && <div className="sb-track-future" style={{ left: pct(cursor) }} />}
        {seams.map((t) => (
          <div key={t} className="sb-track-seam" style={{ left: pct(t) }} title="Redirect point" />
        ))}
        {marks.map((m, i) => (
          <div key={i} className="sb-track-mark" style={{ left: pct(m.t) }} title={`${formatClock(m.t)} · ${m.text}`} />
        ))}
        <div className={`sb-playhead ${cursor === null && isLive ? "is-live" : ""}`} style={{ left: pct(head) }} />
      </div>

      <div className="sb-tape-actions">
        <div className="sb-transport-group">
          <button className="sb-btn" onClick={() => props.onBack(5)} disabled={head <= 0}>
            ↺ 5s
          </button>
          {props.reviewPlaying ? (
            <button className="sb-btn" onClick={props.onStopReview}>
              ❚❚ Pause playback
            </button>
          ) : (
            <button className="sb-btn" onClick={props.onPlayFromHere} disabled={length < 500}>
              ▶ {cursor === null ? "Play back" : "Play from here"}
            </button>
          )}
          {isLive && cursor !== null && (
            <button className="sb-btn" onClick={props.onBackToLive}>
              ● Back to live
            </button>
          )}
        </div>
        <button
          className="sb-btn sb-btn-primary"
          onClick={props.onRedirect}
          disabled={!props.canRedirect || props.busy}
          title={props.canRedirect ? "Keep everything before this moment, regenerate everything after it with your current directions" : "Connect to Orbis to redirect"}
        >
          ⟲ Redirect from {formatClock(head)}
        </button>
      </div>

      {versions.length > 0 && (
        <div className="sb-versions">
          {[...versions].sort((a, b) => a.n - b.n).map((v) => {
            const p = versions.find((x) => x.id === v.parentId);
            const isActive = v.id === version.id;
            const isRecording = live && v.parts.some((part) => part.segId === live.segId);
            return (
              <div key={v.id} className={`sb-version ${isActive ? "is-active" : ""}`}>
                <button className="sb-version-main" onClick={() => props.onSelectVersion(v.id)}>
                  <strong>v{v.n}</strong>
                  <span>
                    {formatClock(versionLength(v, liveMs))}
                    {p && v.branchAtMs !== null ? ` · from v${p.n} @ ${formatClock(v.branchAtMs)}` : " · original"}
                  </span>
                  {isRecording && <i className="sb-version-rec">REC</i>}
                </button>
                <button title="Show this version in Present mode" className={props.heroId === v.id ? "is-on" : ""} onClick={() => props.onHero(v.id)}>★</button>
                <button title="Export as one video file" disabled={!!props.exporting || !!isRecording} onClick={() => props.onExport(v.id)}>
                  {props.exporting?.id === v.id ? `${Math.round(props.exporting.progress * 100)}%` : "↓"}
                </button>
                <button title="Delete version" disabled={!!isRecording} onClick={() => props.onDelete(v.id)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
