"use client";

import type { DragEvent } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import { coverFor } from "@/components/storyboard/storyboard-app";
import type { Shot } from "@/lib/storyboard";

type Props = {
  shots: Shot[];
  selectedId: string;
  liveId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
  onDropRef: (id: string) => (e: DragEvent) => void;
};

export function shotStatus(shot: Shot, live: boolean) {
  if (live) return { label: "Live", tone: "live" };
  if (shot.heroId) return { label: "Done", tone: "done" };
  if (shot.versions.length) return { label: `${shot.versions.length} take${shot.versions.length > 1 ? "s" : ""}`, tone: "wip" };
  return { label: "Draft", tone: "draft" };
}

export function ShotList({ shots, selectedId, liveId, onSelect, onAdd, onMove, onDelete, onDropRef }: Props) {
  return (
    <nav className="sb-shotlist" aria-label="Shot list">
      <div className="sb-shotlist-head">
        <span className="sb-section-label">Shot list</span>
        <button className="sb-icon-btn sb-icon-sm" onClick={onAdd} title="New shot" aria-label="New shot">
          ＋
        </button>
      </div>
      <ol className="sb-shotlist-items">
        {shots.map((s, i) => {
          const cover = coverFor(s);
          const status = shotStatus(s, s.id === liveId);
          const selected = s.id === selectedId;
          return (
            <li key={s.id}>
              <button
                className={`sb-shot ${selected ? "is-selected" : ""} ${s.id === liveId ? "is-live" : ""}`}
                onClick={() => onSelect(s.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropRef(s.id)}
                aria-current={selected}
              >
                <div className="sb-shot-thumb">
                  {cover ? <img src={blobUrl(cover)} alt="" /> : <span>{String(i + 1).padStart(2, "0")}</span>}
                  <span className="sb-shot-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`sb-shot-status is-${status.tone}`}>{status.label}</span>
                </div>
                <div className="sb-shot-name">{s.title || `Shot ${i + 1}`}</div>
                {s.description && <div className="sb-shot-desc">{s.description}</div>}
              </button>
              {selected && (
                <div className="sb-shot-tools">
                  <button onClick={() => onMove(s.id, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button onClick={() => onMove(s.id, 1)} disabled={i === shots.length - 1} title="Move down">↓</button>
                  <button className="sb-danger" onClick={() => onDelete(s.id)} disabled={shots.length <= 1} title="Delete shot">Delete</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button className="sb-shot-add" onClick={onAdd}>
        ＋ New shot
      </button>
    </nav>
  );
}
