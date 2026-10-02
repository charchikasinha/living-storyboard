"use client";

import { useEffect, useMemo, useState } from "react";

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

const TAGLINES = [
  "Lights. Camera. Orbis.",
  "Quiet on set.",
  "Ready when you are, director.",
  "Roll camera.",
];

/** Each time the app is opened, show the next tagline (starting with "Lights. Camera. Orbis."). */
function useTagline() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    try {
      const seen = Number(sessionStorage.getItem("sb-tagline"));
      if (Number.isFinite(seen) && sessionStorage.getItem("sb-tagline") !== null) {
        setIndex(seen);
        return;
      }
      const raw = localStorage.getItem("sb-tagline-next");
      const next = raw === null ? 0 : Number(raw) % TAGLINES.length;
      setIndex(next);
      sessionStorage.setItem("sb-tagline", String(next));
      localStorage.setItem("sb-tagline-next", String((next + 1) % TAGLINES.length));
    } catch {}
  }, []);
  return TAGLINES[index] ?? TAGLINES[0];
}

const SPINE_TONES = ["#d9e4e1", "#e3dcef", "#efdfd8", "#dde8d6", "#e6e4dc", "#e9e1cf"];
const SPINE_TONES_DARK = ["#1d2a2b", "#25202f", "#2e221f", "#1f2a1e", "#26262a", "#2c2719"];

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
  const tagline = useTagline();
  const [view, setView] = useState<"grid" | "shelf">("grid");
  useEffect(() => {
    try {
      if (localStorage.getItem("sb-home-view") === "shelf") setView("shelf");
    } catch {}
  }, []);
  const pickView = (v: "grid" | "shelf") => {
    setView(v);
    try {
      localStorage.setItem("sb-home-view", v);
    } catch {}
  };
  const [featuredId, setFeaturedId] = useState<string | null>(null);
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
          <h1>{tagline}</h1>
          <p>
            {greeting()}
            {boards.length
              ? ` — ${boards.length} production${boards.length > 1 ? "s" : ""} on the shelf.`
              : ". Start a production and direct your first shot."}
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
          <div className="sb-tabs sb-view-toggle" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={view === "grid"} className={view === "grid" ? "is-on" : ""} onClick={() => pickView("grid")} title="Grid">
              ▦ Grid
            </button>
            <button role="radio" aria-checked={view === "shelf"} className={view === "shelf" ? "is-on" : ""} onClick={() => pickView("shelf")} title="Shelf">
              ▥ Shelf
            </button>
          </div>
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

      {view === "shelf" ? (
        <Shelf
          boards={shown}
          featuredId={featuredId ?? resume?.id ?? shown[0]?.id ?? null}
          liveBoardId={liveBoardId}
          onFeature={setFeaturedId}
          onOpen={onOpen}
          onNew={onNew}
        />
      ) : (
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
      )}
    </div>
  );
}

function Shelf({
  boards,
  featuredId,
  liveBoardId,
  onFeature,
  onOpen,
  onNew,
}: {
  boards: Board[];
  featuredId: string | null;
  liveBoardId: string | null;
  onFeature: (id: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const featured = boards.find((b) => b.id === featuredId) ?? boards[0];
  const code = (b: Board) => `LS-${String(boards.indexOf(b) + 1).padStart(3, "0")}`;
  if (!featured) {
    return (
      <button className="sb-project sb-project-new" onClick={onNew}>
        <span>＋</span>
        New production
      </button>
    );
  }
  const cover = boardCover(featured);
  const done = featured.shots.filter((s) => s.heroId).length;
  const live = featured.id === liveBoardId;
  return (
    <div className="sb-shelf">
      <article className={`sb-shelf-feature ${live ? "is-live" : ""}`}>
        {cover ? <img src={blobUrl(cover)} alt="" /> : <div className="sb-shelf-blank">{featured.title.slice(0, 1).toUpperCase()}</div>}
        <div className="sb-shelf-scrim" />
        <div className="sb-shelf-top">
          {live ? <span className="sb-shot-status is-live">● Live</span> : <span />}
          <span className="sb-shelf-code">CAT. {code(featured)}</span>
        </div>
        <div className="sb-shelf-info">
          <span className="sb-shelf-kicker">
            {featured.shots.length} shot{featured.shots.length === 1 ? "" : "s"} · {takesIn(featured)} take{takesIn(featured) === 1 ? "" : "s"} · {ago(featured.updatedAt)}
          </span>
          <h2>{featured.title || "Untitled production"}</h2>
          {featured.shots[0]?.description && <p>{featured.shots[0].description}</p>}
          <div className="sb-shelf-progress">
            <span>Shots with a best take</span>
            <span className="sb-mono">
              {done} / {featured.shots.length}
            </span>
            <i style={{ width: `${featured.shots.length ? (done / featured.shots.length) * 100 : 0}%` }} />
          </div>
          <button className="sb-btn sb-btn-primary" onClick={() => onOpen(featured.id)}>
            ▶ {live ? "Resume directing" : "Open production"}
          </button>
        </div>
      </article>
      <div className="sb-spines" role="list">
        {boards
          .filter((b) => b.id !== featured.id)
          .map((b, i) => {
            const c = boardCover(b);
            return (
              <button
                key={b.id}
                role="listitem"
                className="sb-spine"
                style={{ ["--tone" as string]: SPINE_TONES[i % SPINE_TONES.length], ["--tone-dark" as string]: SPINE_TONES_DARK[i % SPINE_TONES_DARK.length] }}
                onClick={() => onFeature(b.id)}
                onDoubleClick={() => onOpen(b.id)}
                title={`${b.title} — click to pull off the shelf, double-click to open`}
              >
                {c && <img src={blobUrl(c)} alt="" />}
                <span className="sb-spine-code">{code(b)}</span>
                <span className="sb-spine-title">{b.title || "Untitled"}</span>
                <span className="sb-spine-meta">{takesIn(b)}T</span>
              </button>
            );
          })}
        <button className="sb-spine sb-spine-new" onClick={onNew} title="New production">
          <span>＋</span>
        </button>
      </div>
    </div>
  );
}
