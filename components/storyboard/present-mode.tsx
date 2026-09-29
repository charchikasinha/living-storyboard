"use client";

import { useEffect, useState } from "react";

import { blobUrl, coverFor } from "@/components/storyboard/storyboard-app";
import type { Board, Shot } from "@/lib/storyboard";

function heroMedia(shot: Shot) {
  const take = shot.takes.find((t) => t.id === shot.heroId);
  if (take) return { kind: "video" as const, blob: take.blob };
  const cover = coverFor(shot);
  if (cover) return { kind: "image" as const, blob: cover };
  const lastTake = shot.takes.at(-1);
  if (lastTake) return { kind: "video" as const, blob: lastTake.blob };
  return null;
}

/** Latest distinct directions, most recent last, without the ▶ markers. */
function directionSummary(shot: Shot) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...shot.directions].reverse()) {
    const text = d.text.replace(/^▶ Started( — )?/, "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length === 4) break;
  }
  return out.reverse();
}

export function PresentMode({
  board,
  startIndex,
  onClose,
}: {
  board: Board;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const shots = board.shots;
  const shot = shots[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(shots.length - 1, i + 1));
      }
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, shots.length]);

  if (!shot) return null;
  const media = heroMedia(shot);
  const directions = directionSummary(shot);

  return (
    <div className="sb-present" role="dialog" aria-label="Present storyboard">
      <div className="sb-present-top">
        <span className="sb-eyebrow">{board.title}</span>
        <span className="sb-mono">
          {String(index + 1).padStart(2, "0")} / {String(shots.length).padStart(2, "0")}
        </span>
        <button className="sb-btn" onClick={onClose}>
          Close · Esc
        </button>
      </div>

      <div className="sb-present-body">
        <div className="sb-present-media">
          {media?.kind === "video" ? (
            <video key={blobUrl(media.blob)} src={blobUrl(media.blob)} autoPlay loop muted playsInline />
          ) : media?.kind === "image" ? (
            <img src={blobUrl(media.blob)} alt="" />
          ) : (
            <div className="sb-present-blank">No frame yet</div>
          )}
        </div>

        <div className="sb-present-text">
          <div className="sb-present-num">{String(index + 1).padStart(2, "0")}</div>
          <h2>{shot.title || `Shot ${index + 1}`}</h2>
          {shot.description && <p className="sb-present-desc">{shot.description}</p>}
          {directions.length > 0 && (
            <div className="sb-present-block">
              <span className="sb-section-label">Direction</span>
              <ul>
                {directions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {shot.notes && (
            <div className="sb-present-block">
              <span className="sb-section-label">Notes for cast &amp; crew</span>
              <p>{shot.notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="sb-present-strip">
        <button className="sb-icon-btn" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous shot">
          ←
        </button>
        {shots.map((s, i) => {
          const cover = coverFor(s);
          return (
            <button
              key={s.id}
              className={`sb-present-thumb ${i === index ? "is-on" : ""}`}
              onClick={() => setIndex(i)}
              title={s.title}
            >
              {cover ? <img src={blobUrl(cover)} alt="" /> : <span>{i + 1}</span>}
            </button>
          );
        })}
        <button className="sb-icon-btn" onClick={() => setIndex((i) => Math.min(shots.length - 1, i + 1))} disabled={index === shots.length - 1} aria-label="Next shot">
          →
        </button>
      </div>
    </div>
  );
}
