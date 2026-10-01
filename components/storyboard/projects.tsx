"use client";

import { useMemo, useState } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import { coverFor } from "@/components/storyboard/storyboard-app";
import type { Board } from "@/lib/storyboard";

type Props = {
  boards: Board[];
  liveBoardId: string | null;
  liveShotTitle: string | null;
  lastId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function ago(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const boardCover = (b: Board) => {
  for (const s of b.shots) {
    const c = coverFor(s);
    if (c) return c;
  }
  return null;
};

const takesIn = (b: Board) => b.shots.reduce((n, s) => n + s.versions.length, 0);

export function Projects({ boards, liveBoardId, liveShotTitle, lastId, onOpen, onNew, onDelete }: Props) {
  const [filter, setFilter] = useState<"all" | "progress" | "done">("all");
  const [query, setQuery] = useState("");
  const resume = boards.find((b) => b.id === (liveBoardId ?? lastId));

  const shown = useMemo(
    () =>
      boards.filter((b) => {
        const done = b.shots.length > 0 && b.shots.every((s) => s.heroId);
        if (filter === "done" && !done) return false;
        if (filter === "progress" && done) return false;
        const q = query.trim().toLowerCase();
        return !q || b.title.toLowerCase().includes(q) || b.shots.some((s) => s.title.toLowerCase().includes(q));
      }),
    [boards, filter, query],
  );

  const now = new Date();
  return (
    <div className="sb-projects">
      <div className="sb-projects-hero">
        <div>
          <div className="sb-eyebrow">
            {now.toLocaleDateString([], { weekday: "long" })} ·{" "}
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <h1>{greeting()}.</h1>
          <p>
            {boards.length
              ? `${boards.length} production${boards.length > 1 ? "s" : ""} on this computer. Pick one up where you left off.`
              : "Start a production and direct your first shot."}
          </p>
        </div>

        {resume && (
          <button className={`sb-resume ${liveBoardId ? "is-live" : ""}`} onClick={() => onOpen(resume.id)}>
            <div className="sb-resume-thumb">
              {boardCover(resume) && <img src={blobUrl(boardCover(resume))} alt="" />}
            </div>
            <div className="sb-resume-text">
              <span className="sb-resume-tag">{liveBoardId ? "● Session live" : "Last opened"}</span>
              <strong>{resume.title}</strong>
              <span>{liveShotTitle ? `Directing “${liveShotTitle}”` : `${resume.shots.length} shots · ${takesIn(resume)} takes`}</span>
            </div>
            <span className="sb-btn sb-btn-primary">▶ Resume directing</span>
          </button>
        )}
      </div>

      <div className="sb-projects-bar">
        <div className="sb-tabs" role="tablist">
          {(
            [
              ["all", "All productions"],
              ["progress", "In progress"],
              ["done", "Locked"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "is-on" : ""} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="sb-projects-tools">
          <input
            className="sb-search"
            placeholder="Search productions or shots…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="sb-btn sb-btn-primary" onClick={onNew}>
            ＋ New production
          </button>
        </div>
      </div>

      <div className="sb-project-grid">
        {shown.map((b) => {
          const cover = boardCover(b);
          const live = b.id === liveBoardId;
          const done = b.shots.length > 0 && b.shots.every((s) => s.heroId);
          return (
            <div key={b.id} className={`sb-project ${live ? "is-live" : ""}`}>
              <button className="sb-project-open" onClick={() => onOpen(b.id)}>
                <div className="sb-project-cover">
                  {cover ? <img src={blobUrl(cover)} alt="" /> : <span>{b.title.slice(0, 1).toUpperCase()}</span>}
                  <span className={`sb-shot-status is-${live ? "live" : done ? "done" : takesIn(b) ? "wip" : "draft"}`}>
                    {live ? "Live" : done ? "Locked" : takesIn(b) ? "In progress" : "Draft"}
                  </span>
                </div>
                <div className="sb-project-meta">
                  <strong>{b.title || "Untitled production"}</strong>
                  <span>
                    {b.shots.length} shot{b.shots.length === 1 ? "" : "s"} · {takesIn(b)} take{takesIn(b) === 1 ? "" : "s"} · {ago(b.updatedAt)}
                  </span>
                </div>
              </button>
              {!live && (
                <button
                  className="sb-project-delete"
                  title="Delete production"
                  onClick={() => {
                    if (window.confirm(`Delete “${b.title}” and all its takes from this computer?`)) onDelete(b.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <button className="sb-project sb-project-new" onClick={onNew}>
          <span>＋</span>
          New production
        </button>
      </div>
    </div>
  );
}
