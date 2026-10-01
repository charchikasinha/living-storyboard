"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";

import type { Shot } from "@/lib/storyboard";

export const scriptLines = (script: string) =>
  script
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

const SAMPLE = `EXT. ROOFTOP — NIGHT
The city hums below. MARA stands at the ledge, coat snapping in the wind.
Rain begins — a whisper at first. The sodium lights flicker as the camera creeps toward her.
Her phone buzzes against the concrete. She lets it ring twice before answering.
Lightning. The skyline goes black — all of it, all at once. Only her face stays lit.`;

type Props = {
  shot: Shot;
  live: boolean;
  follow: boolean;
  sent: Set<number>;
  onFollow: (on: boolean) => void;
  onChangeScript: (text: string) => void;
  onGoToLine: (index: number) => void;
  onOnceMore: () => void;
};

/** Screenplay view: each line can drive the live shot ("camera follows script"). */
export function ScriptPanel({ shot, live, follow, sent, onFollow, onChangeScript, onGoToLine, onOnceMore }: Props) {
  const lines = scriptLines(shot.script);
  const [editing, setEditing] = useState(!lines.length);
  const listRef = useRef<HTMLOListElement>(null);
  const current = Math.min(shot.scriptLine, Math.max(0, lines.length - 1));

  useEffect(() => {
    setEditing(!scriptLines(shot.script).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id]);

  useEffect(() => {
    listRef.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  const onKey = (e: KeyboardEvent) => {
    if (editing) return;
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (current < lines.length - 1) onGoToLine(current + 1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (current > 0) onGoToLine(current - 1);
    }
  };

  return (
    <div className="sb-script" onKeyDown={onKey}>
      <div className="sb-script-head">
        <span className="sb-section-label">Shooting script</span>
        <button className="sb-link" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {editing ? (
        <>
          <textarea
            className="sb-script-edit"
            rows={10}
            value={shot.script}
            placeholder="Paste your scene, one beat per line…"
            onChange={(e) => onChangeScript(e.target.value)}
          />
          {!shot.script && (
            <button className="sb-link" onClick={() => onChangeScript(SAMPLE)}>
              Use a sample scene
            </button>
          )}
        </>
      ) : (
        <>
          <label className="sb-toggle">
            <input type="checkbox" checked={follow} onChange={(e) => onFollow(e.target.checked)} />
            <span className="sb-toggle-track" aria-hidden />
            Camera follows script
            <em>{follow ? (live ? "each line steers the live shot" : "lines steer once a shot is live") : "read-only"}</em>
          </label>

          <ol className="sb-script-lines" ref={listRef} tabIndex={0} aria-label="Script lines (Enter = next line)">
            {lines.map((line, i) => {
              const isHeading = /^(INT\.|EXT\.|INT\/EXT)/i.test(line);
              return (
                <li
                  key={i}
                  className={`${i === current ? "is-current" : ""} ${sent.has(i) ? "is-sent" : ""} ${isHeading ? "is-heading" : ""}`}
                  onClick={() => onGoToLine(i)}
                >
                  <span className="sb-script-num">{i + 1}</span>
                  <span className="sb-script-text">{line}</span>
                  {sent.has(i) && <span className="sb-script-check" title="Sent to Orbis">✓</span>}
                </li>
              );
            })}
          </ol>

          <div className="sb-script-actions">
            <button className="sb-btn" onClick={() => current > 0 && onGoToLine(current - 1)} disabled={current === 0}>
              ← Back
            </button>
            <button className="sb-btn" onClick={onOnceMore} disabled={!live || !follow}>
              ↻ Once more
            </button>
            <button
              className="sb-btn sb-btn-primary"
              onClick={() => onGoToLine(Math.min(lines.length - 1, current + 1))}
              disabled={current >= lines.length - 1}
            >
              Next line ↵
            </button>
          </div>
        </>
      )}
    </div>
  );
}
