import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";

import { COWRITER_SYSTEM, cowriterUserMessage, parsePrompts, type Provider } from "@/lib/cowriter";

export const runtime = "nodejs";

// Keys stay on the server (.env.local). Placeholder values from .env.example count as missing.
const key = (name: string) => {
  const v = process.env[name]?.trim();
  return v && !v.startsWith("replace_with") ? v : null;
};

function configured(): Provider[] {
  const out: Provider[] = [];
  if (key("ANTHROPIC_API_KEY")) out.push("claude");
  if (key("OPENAI_API_KEY")) out.push("openai");
  if (key("GEMINI_API_KEY")) out.push("gemini");
  return out;
}

/** Which providers are available (booleans only — never the keys). */
export async function GET() {
  return NextResponse.json({ providers: configured() });
}

async function askClaude(user: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1200,
      system: COWRITER_SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude returned ${res.status}`);
  return (data.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
}

async function askOpenAI(user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: COWRITER_SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI returned ${res.status}`);
  return data.choices?.[0]?.message?.content ?? "";
}

// Tried in order; a busy (503), rate-limited (429) or unknown (404) model falls through to the next.
const GEMINI_MODELS = [
  process.env.GEMINI_TEXT_MODEL,
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error);
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; status?: string; message?: string } };
    if (parsed.error) return `${parsed.error.code ?? ""} ${parsed.error.status ?? ""}: ${parsed.error.message ?? ""}`.trim();
  } catch {}
  return raw.slice(0, 300);
}

async function askGemini(user: string) {
  const ai = new GoogleGenAI({ apiKey: key("GEMINI_API_KEY")! });
  let lastError: unknown = null;
  const tried: string[] = [];
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: user }],
        config: {
          systemInstruction: COWRITER_SYSTEM,
          temperature: 0.8,
          maxOutputTokens: 4000,
          // No hidden "thinking" — it was eating the output budget and cutting lists short.
          thinkingConfig: { thinkingBudget: 0 },
          // Ask for a real JSON array of strings so every beat comes back intact.
          responseMimeType: "application/json",
          responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      });
      const text = response.text ?? "";
      const truncated = response.candidates?.[0]?.finishReason === "MAX_TOKENS";
      if (text.trim() && !truncated) return text;
      if (truncated) tried.push(`${model}: reply was cut off`);
      break;
    } catch (error) {
      lastError = error;
      const msg = describe(error);
      tried.push(`${model}: ${msg}`);
      console.warn(`[cowriter] ${model} failed: ${msg}`);
      if (!/503|429|404|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|overloaded|high demand/i.test(msg)) throw new Error(msg);
      // Busy (503): wait briefly and retry this model once; otherwise move on.
      if (/503|UNAVAILABLE|overloaded|high demand/i.test(msg) && attempt === 0) {
        await sleep(2000);
        continue;
      }
      break;
    }
    }
  }
  const quota = tried.some((t) => /429|RESOURCE_EXHAUSTED/i.test(t));
  // Report the most telling failure: busy beats quota beats "model retired".
  const busy = tried.find((t) => /503|UNAVAILABLE|overloaded|high demand/i.test(t));
  const shown = busy ?? tried.find((t) => /429|RESOURCE_EXHAUSTED/i.test(t)) ?? tried.at(-1);
  throw new Error(
    !lastError
      ? "Gemini returned an empty reply."
      : quota
        ? `Gemini's free quota is used up for now — wait a minute and try again. (${shown})`
        : `Gemini is busy right now — try again in a moment. (${shown})`,
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    provider?: Provider;
    brief?: string;
    scene?: string;
    count?: number;
  } | null;
  const brief = body?.brief?.trim();
  if (!brief) return NextResponse.json({ error: "Describe what you want first." }, { status: 400 });
  const available = configured();
  const provider = body?.provider && available.includes(body.provider) ? body.provider : available[0];
  if (!provider) {
    return NextResponse.json({ error: "No AI key is set up yet — use copy & paste, or add a key to .env.local." }, { status: 400 });
  }
  const count = Math.min(12, Math.max(2, Number(body?.count) || 6));
  const user = cowriterUserMessage(brief, body?.scene ?? "", count);
  try {
    const raw =
      provider === "claude" ? await askClaude(user) : provider === "openai" ? await askOpenAI(user) : await askGemini(user);
    const prompts = parsePrompts(raw).slice(0, count);
    if (!prompts.length) throw new Error("The AI reply didn't contain any prompts. Try again.");
    return NextResponse.json({ provider, prompts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Co-writer failed" },
      { status: 502 },
    );
  }
}
