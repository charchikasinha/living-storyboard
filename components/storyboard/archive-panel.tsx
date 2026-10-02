"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import { copyPasteRequest, parsePrompts, type Provider } from "@/lib/cowriter";
import type { ArchivedImage, ArchivedPrompt } from "@/lib/storyboard";

/** Drag payload types shared with the drop targets in the studio. */
export const DRAG_PROMPT = "application/x-sb-prompt";
export const DRAG_IMAGE = "application/x-sb-image";
const DRAG_SOURCE = "application/x-sb-cowriter";
/** Set when a co-writer block lands in the archive (so the block can show ✓). */
const droppedInArchive = { current: false };

type Props = {
  scene: string;
  prompts: ArchivedPrompt[];
  images: ArchivedImage[];
  onAddPrompts: (texts: string[], source: string) => void;
  onSetPrompts: (next: ArchivedPrompt[]) => void;
  onUsePrompt: (text: string) => void;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onUseImage: (image: ArchivedImage) => void;
};

export function ArchivePanel(props: Props) {
  return (
    <aside className="sb-archive" aria-label="Archive">
      <CoWriter scene={props.scene} onAdd={props.onAddPrompts} onUse={props.onUsePrompt} />
      <PromptArchive {...props} />
      <ImageArchive {...props} />
    </aside>
  );
}

// ---------------------------------------------------------------------------

function CoWriter({
  scene,
  onAdd,
  onUse,
}: {
  scene: string;
  onAdd: (texts: string[], source: string) => void;
  onUse: (text: string) => void;
}) {
  const [geminiReady, setGeminiReady] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"gemini" | "manual">("manual");
  const [brief, setBrief] = useState("");
  const [manual, setManual] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    void fetch("/api/cowriter")
      .then((r) => r.json())
      .then((d: { providers?: Provider[] }) => {
        const ok = (d.providers ?? []).includes("gemini");
        setGeminiReady(ok);
        if (ok) setMode("gemini");
      })
      .catch(() => setGeminiReady(false));
  }, []);

  const generate = async () => {
    if (!brief.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cowriter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gemini", brief, scene, count }),
      });
      const data = (await res.json()) as { prompts?: string[]; error?: string };
      if (!res.ok || !data.prompts) throw new Error(data.error || "Co-writer failed");
      setResults(data.prompts);
      setAdded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const makeBlocks = () => {
    const list = parsePrompts(manual);
    if (!list.length) return;
    setResults(list);
    setAdded(new Set());
    setManual("");
  };

  // Escape hatch without a key: copy a ready-made request for Claude / ChatGPT.
  const copyRequest = async () => {
    const topic = manual.trim() || scene.trim();
    if (!topic) {
      setError("Write a line about the scene first, then copy the request.");
      return;
    }
    setError("");
    try {
      await navigator.clipboard.writeText(copyPasteRequest(topic, scene, count));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  };

  const source = mode === "gemini" ? "Gemini" : "Manual";
  const addOne = (i: number) => {
    onAdd([results[i]], source);
    setAdded((s) => new Set(s).add(i));
  };
  const addAll = () => {
    const idx = results.map((_, i) => i).filter((i) => !added.has(i));
    if (!idx.length) return;
    onAdd(idx.map((i) => results[i]), source);
    setAdded(new Set(results.map((_, i) => i)));
  };

  return (
    <section className="sb-arch-card">
      <div className="sb-arch-head">
        <button className="sb-arch-title" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="sb-section-label">Co-writer</span>
          <span className="sb-arch-caret">{open ? "−" : "+"}</span>
        </button>
        <select
          className="sb-select sb-mode"
          value={mode}
          aria-label="How to write prompts"
          onChange={(e) => {
            setMode(e.target.value as "gemini" | "manual");
            setError("");
          }}
        >
          <option value="gemini" disabled={!geminiReady}>
            Gemini{geminiReady === false ? " — add key" : ""}
          </option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {open && (
        <div className="sb-arch-body">
          {mode === "gemini" ? (
            <>
              <label className="sb-cw-label" htmlFor="sb-brief">
                ✦ Ask Gemini for prompts
              </label>
              <textarea
                id="sb-brief"
                rows={3}
                value={brief}
                placeholder="Describe the scene you want prompts for — e.g. a golden retriever plays with a red ball; a woman in a white summer dress brings his food; he jumps on her, then eats."
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void generate();
                }}
              />
              <div className="sb-arch-row sb-cw-controls">
                <label className="sb-count">
                  Beats
                  <select value={count} onChange={(e) => setCount(+e.target.value)}>
                    {[3, 4, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="sb-btn sb-btn-primary" onClick={() => void generate()} disabled={busy || !brief.trim()}>
                  {busy ? "Writing…" : "✦ Ask Gemini"}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="sb-cw-label" htmlFor="sb-manual">
                Write or paste prompts — one per line
              </label>
              <textarea
                id="sb-manual"
                rows={4}
                value={manual}
                placeholder={"1. Wide angle, 32mm — the dog plays with a red ball.\n2. Low angle — she brings his food in a pan.\n3. He jumps on her, then starts eating."}
                onChange={(e) => setManual(e.target.value)}
              />
              <div className="sb-arch-row sb-cw-controls">
                <button
                  className="sb-link sb-copy-req"
                  onClick={() => void copyRequest()}
                  title="Copies a ready-made request you can paste into Claude or ChatGPT; paste their reply back here"
                >
                  {copied ? "✓ Request copied" : "Copy a request for Claude"}
                </button>
                <button className="sb-btn sb-btn-primary" onClick={makeBlocks} disabled={!manual.trim()}>
                  Make blocks
                </button>
              </div>
            </>
          )}

          {error && <p className="sb-field-error">{error}</p>}

          {results.length > 0 && (
            <div className="sb-results">
              <div className="sb-arch-row">
                <span className="sb-results-hint">Drag blocks into the archive ↓</span>
                <button className="sb-btn sb-btn-primary" onClick={addAll} disabled={added.size === results.length}>
                  ＋ Add all, in order
                </button>
              </div>
              <ol>
                {results.map((r, i) => (
                  <li
                    key={i}
                    className={added.has(i) ? "is-added" : ""}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "copy";
                      e.dataTransfer.setData(DRAG_PROMPT, r);
                      e.dataTransfer.setData(DRAG_SOURCE, String(i));
                      e.dataTransfer.setData("text/plain", r);
                    }}
                    onDragEnd={(e) => {
                      if (e.dataTransfer.dropEffect !== "none" && droppedInArchive.current) {
                        setAdded((s) => new Set(s).add(i));
                      }
                      droppedInArchive.current = false;
                    }}
                    title="Drag into the prompt archive"
                  >
                    <span className="sb-prompt-num">{i + 1}</span>
                    <span>{r}</span>
                    <span className="sb-result-tools">
                      {added.has(i) ? (
                        <span className="sb-added">✓</span>
                      ) : (
                        <button title="Add to prompt archive" onClick={() => addOne(i)}>＋</button>
                      )}
                      <button title="Use now" onClick={() => onUse(r)}>→</button>
                    </span>
                  </li>
                ))}
              </ol>
              <button className="sb-link" onClick={() => setResults([])}>Clear blocks</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function PromptArchive({ prompts, onAddPrompts, onSetPrompts, onUsePrompt }: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragId = useRef<string | null>(null);

  const insertAt = (text: string, at: number) => {
    droppedInArchive.current = true;
    const next = [...prompts];
    next.splice(at, 0, { id: Math.random().toString(36).slice(2, 10), text, source: "AI" });
    onSetPrompts(next);
  };
  const [overEmpty, setOverEmpty] = useState(false);
  // "Fire next": step through the archive in order, like a shooting script.
  const [next, setNext] = useState(0);
  const nextIndex = Math.min(next, Math.max(0, prompts.length - 1));
  const fire = (i: number) => {
    const p = prompts[i];
    if (!p) return;
    onUsePrompt(p.text);
    setNext(i + 1 >= prompts.length ? 0 : i + 1);
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0) return;
    const next = [...prompts];
    const [item] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, item);
    onSetPrompts(next);
  };

  return (
    <section
      className={`sb-arch-card ${overEmpty ? "is-drop" : ""}`}
      onDragOverCapture={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_SOURCE)) return;
        e.preventDefault();
        setOverEmpty(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverEmpty(false);
      }}
      onDropCapture={(e) => {
        // Capture phase so the "Add a prompt" input can't swallow the drop.
        const text = e.dataTransfer.getData(DRAG_PROMPT);
        setOverEmpty(false);
        if (!text || !e.dataTransfer.types.includes(DRAG_SOURCE)) return;
        if ((e.target as HTMLElement).closest(".sb-prompt-list li")) return; // row handles exact position
        e.preventDefault();
        e.stopPropagation();
        insertAt(text, prompts.length);
      }}
    >
      <div className="sb-arch-head is-static">
        <span className="sb-section-label">Prompt archive</span>
        {prompts.length > 0 ? (
          <button className="sb-btn sb-btn-primary sb-fire" onClick={() => fire(nextIndex)} title={`Send #${nextIndex + 1} to Direction`}>
            ▶ Fire next · {nextIndex + 1}/{prompts.length}
          </button>
        ) : (
          <span className="sb-arch-count">0</span>
        )}
      </div>
      <form
        className="sb-arch-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onAddPrompts([draft.trim()], "Manual");
          setDraft("");
        }}
      >
        <input value={draft} placeholder="Add a prompt…" onChange={(e) => setDraft(e.target.value)} />
        <button className="sb-btn" type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>
      {prompts.length === 0 ? (
        <p className="sb-arch-empty">Collect lines here before you shoot. Drag one onto “Tell the scene” (or click →) to use it.</p>
      ) : (
        <ol
          className="sb-prompt-list"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverIndex(null);
          }}
        >
          {prompts.map((p, i) => (
            <li
              key={p.id}
              className={`${overIndex === i ? "is-drop-before" : ""} ${i === nextIndex ? "is-next" : ""}`}
              draggable={editing !== p.id}
              onDragStart={(e) => {
                dragId.current = p.id;
                e.dataTransfer.effectAllowed = "copyMove";
                e.dataTransfer.setData(DRAG_PROMPT, p.text);
                e.dataTransfer.setData("text/plain", p.text);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                if (!dragId.current && !e.dataTransfer.types.includes(DRAG_SOURCE)) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setOverIndex(e.clientY > rect.top + rect.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const at = overIndex ?? i;
                setOverIndex(null);
                if (dragId.current) {
                  move(prompts.findIndex((x) => x.id === dragId.current), at);
                  return;
                }
                const text = e.dataTransfer.getData(DRAG_PROMPT);
                if (text) insertAt(text, at);
              }}
            >
              <span className="sb-grip" aria-hidden>⋮⋮</span>
              <span className="sb-prompt-num">{i + 1}</span>
              {editing === p.id ? (
                <textarea
                  autoFocus
                  defaultValue={p.text}
                  rows={2}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    onSetPrompts(text ? prompts.map((x) => (x.id === p.id ? { ...x, text } : x)) : prompts.filter((x) => x.id !== p.id));
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) (e.target as HTMLTextAreaElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="sb-prompt-text" onDoubleClick={() => setEditing(p.id)} title="Double-click to edit · drag to reorder or onto the scene box">
                  {p.text}
                </span>
              )}
              <span className="sb-prompt-tools">
                <button title="Use now" onClick={() => fire(i)}>→</button>
                <button title="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>↑</button>
                <button title="Move down" onClick={() => move(i, i + 2)} disabled={i === prompts.length - 1}>↓</button>
                <button title="Remove" onClick={() => onSetPrompts(prompts.filter((x) => x.id !== p.id))}>✕</button>
              </span>
            </li>
          ))}
          {overIndex === prompts.length && <li className="sb-drop-end" aria-hidden />}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function ImageArchive({ images, onAddImages, onRemoveImage, onUseImage }: Props) {
  const [over, setOver] = useState(false);
  const addFiles = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) onAddImages(files);
  };
  return (
    <section
      className={`sb-arch-card ${over ? "is-drop" : ""}`}
      onDragOver={(e: DragEvent) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        setOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="sb-arch-head is-static">
        <span className="sb-section-label">Image archive</span>
        <span className="sb-arch-count">{images.length}</span>
      </div>
      <div className="sb-image-grid">
        {images.map((img) => (
          <figure
            key={img.id}
            className="sb-arch-img"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData(DRAG_IMAGE, img.id);
            }}
            title={`${img.name} — drag onto the reference frame or a shot`}
          >
            <img src={blobUrl(img.blob)} alt={img.name} draggable={false} />
            <button className="sb-arch-img-use" title="Use as this shot's reference frame" onClick={() => onUseImage(img)}>
              ＋
            </button>
            <button className="sb-arch-img-del" title="Remove from archive" onClick={() => onRemoveImage(img.id)}>
              ✕
            </button>
          </figure>
        ))}
        <label className="sb-arch-img sb-arch-img-add" title="Add images (or drop files here)">
          <input type="file" accept="image/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)} />
          <span>＋</span>
          Add
        </label>
      </div>
      {images.length === 0 && <p className="sb-arch-empty">Drop location photos, sketches or mood frames here.</p>}
    </section>
  );
}
