import { GoogleGenAI } from "@google/genai";
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

async function askGemini(user: string) {
  const ai = new GoogleGenAI({ apiKey: key("GEMINI_API_KEY")! });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash",
    contents: [{ text: user }],
    config: { systemInstruction: COWRITER_SYSTEM, temperature: 0.8, maxOutputTokens: 1500 },
  });
  return response.text ?? "";
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
