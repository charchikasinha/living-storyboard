"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import { copyPasteRequest, parsePrompts, PROVIDER_LABEL, type Provider } from "@/lib/cowriter";
import type { ArchivedImage, ArchivedPrompt } from "@/lib/storyboard";

/** Drag payload types shared with the drop targets in the studio. */
export const DRAG_PROMPT = "application/x-sb-prompt";
export const DRAG_IMAGE = "application/x-sb-image";

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

const ALL: Provider[] = ["claude", "openai", "gemini"];
const KEY_NAME: Record<Provider, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
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
  const [available, setAvailable] = useState<Provider[] | null>(null);
  const [provider, setProvider] = useState<Provider | "paste">("paste");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    void fetch("/api/cowriter")
      .then((r) => r.json())
      .then((d: { providers?: Provider[] }) => {
        const list = d.providers ?? [];
        setAvailable(list);
        if (list.length) setProvider(list[0]);
      })
      .catch(() => setAvailable([]));
  }, []);

  const generate = async () => {
    if (!brief.trim() || provider === "paste") return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cowriter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, brief, scene, count }),
      });
      const data = (await res.json()) as { prompts?: string[]; error?: string };
      if (!res.ok || !data.prompts) throw new Error(data.error || "Co-writer failed");
      setResults(data.prompts);
      setPicked(new Set(data.prompts.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyRequest = async () => {
    if (!brief.trim()) {
      setError("Describe what you want first.");
      return;
    }
    setError("");
    try {
      await navigator.clipboard.writeText(copyPasteRequest(brief, scene, count));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy — select the brief and copy it manually.");
    }
  };

  const addPicked = () => {
    const texts = results.filter((_, i) => picked.has(i));
    if (!texts.length) return;
    onAdd(texts, provider === "paste" ? "Pasted" : PROVIDER_LABEL[provider]);
    setResults([]);
  };

  return (
    <section className="sb-arch-card">
      <button className="sb-arch-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sb-section-label">Co-writer</span>
        <span className="sb-arch-caret">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="sb-arch-body">
          <div className="sb-seg" role="radiogroup" aria-label="AI model">
            {ALL.map((p) => {
              const ok = available?.includes(p);
              return (
                <button
                  key={p}
                  role="radio"
                  aria-checked={provider === p}
                  className={provider === p ? "is-on" : ""}
                  disabled={!ok}
                  title={ok ? `Ask ${PROVIDER_LABEL[p]}` : `Add ${KEY_NAME[p]} to .env.local to enable`}
                  onClick={() => setProvider(p)}
                >
                  {PROVIDER_LABEL[p]}
                </button>
              );
            })}
            <button role="radio" aria-checked={provider === "paste"} className={provider === "paste" ? "is-on" : ""} onClick={() => setProvider("paste")} title="No key needed: copy a request into claude.ai or ChatGPT and paste the reply back">
              Copy &amp; paste
            </button>
          </div>

          <textarea
            rows={3}
            value={brief}
            placeholder="e.g. Mara gets the call that changes everything — build tension, then the blackout."
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="sb-arch-row">
            <label className="sb-count">
              Beats
              <select value={count} onChange={(e) => setCount(+e.target.value)}>
                {[4, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {provider === "paste" ? (
              <button className="sb-btn sb-btn-primary" onClick={() => void copyRequest()}>
                {copied ? "✓ Copied" : "Copy request"}
              </button>
            ) : (
              <button className="sb-btn sb-btn-primary" onClick={() => void generate()} disabled={busy || !brief.trim()}>
                {busy ? "Writing…" : `✦ Ask ${PROVIDER_LABEL[provider]}`}
              </button>
            )}
          </div>

          {provider === "paste" && (
            <div className="sb-paste">
              <p>
                Paste the copied request into <a href="https://claude.ai/new" target="_blank" rel="noreferrer">Claude</a> or{" "}
                <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a>, then paste its reply here:
              </p>
              <textarea rows={3} value={pasted} placeholder="Paste the numbered list…" onChange={(e) => setPasted(e.target.value)} />
              <button
                className="sb-btn"
                disabled={!pasted.trim()}
                onClick={() => {
                  const list = parsePrompts(pasted);
                  setResults(list);
                  setPicked(new Set(list.map((_, i) => i)));
                  setPasted("");
                }}
              >
                Read reply
              </button>
            </div>
          )}

          {error && <p className="sb-field-error">{error}</p>}

          {results.length > 0 && (
            <div className="sb-results">
              <ol>
                {results.map((r, i) => (
                  <li key={i} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_PROMPT, r)}>
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      aria-label={`Keep beat ${i + 1}`}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                    />
                    <span>{r}</span>
                    <button title="Use now" onClick={() => onUse(r)}>→</button>
                  </li>
                ))}
              </ol>
              <div className="sb-arch-row">
                <button className="sb-link" onClick={() => setResults([])}>Discard</button>
                <button className="sb-btn sb-btn-primary" onClick={addPicked} disabled={!picked.size}>
                  ＋ Add {picked.size} to prompt archive
                </button>
              </div>
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

  const move = (from: number, to: number) => {
    if (from === to || from < 0) return;
    const next = [...prompts];
    const [item] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, item);
    onSetPrompts(next);
  };

  return (
    <section className="sb-arch-card">
      <div className="sb-arch-head is-static">
        <span className="sb-section-label">Prompt archive</span>
        <span className="sb-arch-count">{prompts.length}</span>
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
              className={`${overIndex === i ? "is-drop-before" : ""}`}
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
                if (!dragId.current) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setOverIndex(e.clientY > rect.top + rect.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                move(prompts.findIndex((x) => x.id === dragId.current), overIndex ?? i);
                setOverIndex(null);
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
                <button title="Use now" onClick={() => onUsePrompt(p.text)}>→</button>
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
