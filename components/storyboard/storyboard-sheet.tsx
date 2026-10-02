"use client";

import { useEffect, useState } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import {
  type Board,
  DEFAULT_LAYOUT,
  formatClock,
  type PanelFrame,
  type Still,
  type StoryboardLayout,
  storyboardPanels,
} from "@/lib/storyboard";

const DRAG_PANEL = "application/x-sb-panel";
const FRAMES: PanelFrame[] = ["16:9", "2.39:1", "4:3"];
const RATIO: Record<PanelFrame, string> = { "16:9": "16 / 9", "2.39:1": "2.39 / 1", "4:3": "4 / 3" };

type Props = {
  board: Board;
  onClose: () => void;
  onLayout: (layout: StoryboardLayout) => void;
  onEditStill: (shotId: string, stillId: string, patch: Partial<Still>) => void;
};

/** The production's storyboard: every starred still, laid out as panels on one sheet. */
export function StoryboardSheet({ board, onClose, onLayout, onEditStill }: Props) {
  const layout = { ...DEFAULT_LAYOUT, ...(board.storyboard ?? {}) };
  const panels = storyboardPanels(board);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const shotCount = new Set(panels.map((p) => p.shot.id)).size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest("input, textarea")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<StoryboardLayout>) => onLayout({ ...layout, ...patch });

  const moveBefore = (id: string, beforeId: string | null) => {
    const ids = panels.map((p) => p.still.id).filter((x) => x !== id);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at === -1 ? ids.length : at, 0, id);
    set({ order: ids });
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const ids = panels.map((p) => p.still.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ order: ids });
  };

  return (
    <div className="sb-sheet-layer" role="dialog" aria-modal="true" aria-label="Storyboard">
      <div className="sb-sheet">
        <header className="sb-sheet-head">
          <div className="sb-sheet-titles">
            <span className="sb-kicker">
              {board.title || "Untitled production"} · {panels.length} panel{panels.length === 1 ? "" : "s"}
              {panels.length ? ` from ${shotCount} shot${shotCount === 1 ? "" : "s"}` : ""}
            </span>
            <h2>Storyboard</h2>
          </div>
          <div className="sb-sheet-controls">
            <div className="sb-sheet-seg-group">
              <span className="sb-kicker">Per row</span>
              <div className="sb-sheet-seg" role="radiogroup" aria-label="Panels per row">
                {([2, 3, 4] as const).map((n) => (
                  <button key={n} role="radio" aria-checked={layout.perRow === n} className={layout.perRow === n ? "is-on" : ""} onClick={() => set({ perRow: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="sb-sheet-seg-group">
              <span className="sb-kicker">Frame</span>
              <div className="sb-sheet-seg" role="radiogroup" aria-label="Panel frame">
                {FRAMES.map((f) => (
                  <button key={f} role="radio" aria-checked={layout.frame === f} className={layout.frame === f ? "is-on" : ""} onClick={() => set({ frame: f })}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <button className="sb-btn" onClick={() => window.print()} disabled={!panels.length}>
              Print / PDF
            </button>
            <button className="sb-btn sb-btn-primary" onClick={onClose} aria-label="Close storyboard">
              ✕ Close
            </button>
          </div>
        </header>

        {panels.length === 0 ? (
          <div className="sb-sheet-empty">
            <strong>No panels yet.</strong>
            <span>Capture stills while you direct, then press ★ on the ones that tell the story. They land here, in order.</span>
          </div>
        ) : (
          <div
            className="sb-sheet-grid"
            style={{ gridTemplateColumns: `repeat(${layout.perRow}, minmax(0, 1fr))` }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_PANEL)) e.preventDefault();
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(DRAG_PANEL);
              if (!id) return;
              e.preventDefault();
              if (!overId) moveBefore(id, null);
              setDragId(null);
              setOverId(null);
            }}
          >
            {panels.map(({ still, shot, shotIndex }, i) => (
              <article
                key={still.id}
                className={`sb-pnl-card ${dragId === still.id ? "is-dragging" : ""} ${overId === still.id && dragId !== still.id ? "is-over" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_PANEL, still.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(still.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_PANEL)) return;
                  e.preventDefault();
                  setOverId(still.id);
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DRAG_PANEL);
                  if (!id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (id !== still.id) moveBefore(id, still.id);
                  setDragId(null);
                  setOverId(null);
                }}
              >
                <div className="sb-pnl-frame" style={{ aspectRatio: RATIO[layout.frame] }}>
                  <img src={blobUrl(still.blob)} alt="" draggable={false} />
                  <span className="sb-pnl-grip" aria-hidden>⋮⋮</span>
                  <div className="sb-pnl-tools">
                    <button title="Move earlier" aria-label="Move earlier" onClick={() => nudge(still.id, -1)} disabled={i === 0}>←</button>
                    <button title="Move later" aria-label="Move later" onClick={() => nudge(still.id, 1)} disabled={i === panels.length - 1}>→</button>
                    <button title="Take off the storyboard" aria-label="Remove from storyboard" onClick={() => onEditStill(shot.id, still.id, { starred: false })}>✕</button>
                  </div>
                </div>
                <div className="sb-pnl-body">
                  <span className="sb-pnl-num">{String(i + 1).padStart(2, "0")}</span>
                  <div className="sb-pnl-text">
                    <span className="sb-kicker">
                      Shot {String(shotIndex + 1).padStart(2, "0")} · {shot.title || "Untitled"}
                      {still.atMs !== undefined ? ` · ${formatClock(still.atMs)}` : ""}
                    </span>
                    <textarea
                      className="sb-pnl-caption"
                      rows={2}
                      value={still.caption ?? ""}
                      placeholder="What happens in this frame…"
                      onChange={(e) => onEditStill(shot.id, still.id, { caption: e.target.value })}
                    />
                    {still.tags && <span className="sb-pnl-tags">{still.tags}</span>}
                    <input
                      className="sb-pnl-note"
                      value={still.note ?? ""}
                      placeholder="Add note…"
                      onChange={(e) => onEditStill(shot.id, still.id, { note: e.target.value })}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <footer className="sb-sheet-foot">
          <span>Drag panels to reorder</span>
          <span>★ on any still adds it here</span>
          <span>Captions come from the direction at that moment — click to edit</span>
          <span className="sb-sheet-foot-end">Esc to close</span>
        </footer>
      </div>
    </div>
  );
}
