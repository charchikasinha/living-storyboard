// Shared co-writer prompt + parsing (used by the API route and the copy-paste fallback).

export type Provider = "claude" | "openai" | "gemini";

export const PROVIDER_LABEL: Record<Provider, string> = {
  claude: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
};

export const COWRITER_SYSTEM = `You are a film co-writer helping a director prepare live AI video.
The director will steer a real-time video generator (Visko Orbis) that renders ONE continuous shot with no cuts; each prompt is sent while the video is playing and morphs the scene within ~2 seconds.

Write a sequence of short prompts — one per story beat — that the director can fire in order.
Rules for every prompt:
- 1–2 sentences, under 40 words, present tense, concrete and visual.
- Open with the shot: framing/angle, lens and light (e.g. "Wide angle, 32mm, warm morning sun through the windows —"), then describe what we SEE: subject action, camera move, atmosphere.
- Keep continuity with the previous beat (same place and characters unless the brief says otherwise).
- No cuts, no scene numbers, no dialogue quotes, no camera jargon the model can't render (e.g. "smash cut").
Return ONLY a JSON array of strings, nothing else.`;

export function cowriterUserMessage(brief: string, scene: string, count: number) {
  return [
    scene.trim() ? `Current scene: ${scene.trim()}` : "",
    `Director's brief: ${brief.trim()}`,
    `Write ${count} beats.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Full request for pasting into claude.ai / chatgpt.com when no API key is set. */
export function copyPasteRequest(brief: string, scene: string, count: number) {
  return `${COWRITER_SYSTEM.replace("Return ONLY a JSON array of strings, nothing else.", "Return the prompts as a numbered list, one per line, nothing else.")}\n\n${cowriterUserMessage(brief, scene, count)}`;
}

/** Accepts a JSON array, a numbered/bulleted list, or plain lines. */
export function parsePrompts(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        return arr.map((x) => String(typeof x === "object" && x ? (x.prompt ?? x.text ?? "") : x).trim()).filter(Boolean);
      }
    } catch {
      // fall through to line parsing
    }
  }
  return text
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
        .trim()
        .replace(/,$/, "")
        .replace(/^["“]|["”]$/g, "")
        .trim(),
    )
    .filter((l) => l.length > 3 && !/^[\[\]{}]$/.test(l));
}
