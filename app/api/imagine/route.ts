import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Text → still frame with Nano Banana, for the image archive. Tried in order;
// a retired (404) or busy (503/429) model falls through to the next.
const IMAGE_MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-3.5-flash-image",
  "gemini-3-flash-image",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

const key = () => {
  const v = process.env.GEMINI_API_KEY?.trim();
  return v && !v.startsWith("replace_with") ? v : null;
};

export async function POST(request: Request) {
  const apiKey = key();
  if (!apiKey) return NextResponse.json({ error: "Add a GEMINI_API_KEY to .env.local to generate frames." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { prompt?: string } | null;
  const prompt = body?.prompt?.trim();
  if (!prompt) return NextResponse.json({ error: "Nothing to picture yet." }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });
  const tried: string[] = [];
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            text: `A single cinematic film still, photorealistic, wide 16:9 frame, no text or captions. ${prompt}`,
          },
        ],
        config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "16:9" } },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const out = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (out?.data) {
        return new Response(Buffer.from(out.data, "base64"), {
          headers: { "Content-Type": out.mimeType || "image/png", "Cache-Control": "no-store" },
        });
      }
      tried.push(`${model}: no image returned`);
    } catch (error) {
      const msg = String(error instanceof Error ? error.message : error).slice(0, 240);
      tried.push(`${model}: ${msg}`);
      console.warn(`[imagine] ${model} failed: ${msg}`);
    }
  }
  const quota = tried.length > 0 && tried.every((t) => /429|404|RESOURCE_EXHAUSTED|NOT_FOUND|quota/i.test(t)) && tried.some((t) => /429|quota/i.test(t));
  return NextResponse.json(
    {
      error: quota
        ? "Image generation isn't included in this Gemini key's free quota — add billing in Google AI Studio, or drop your own images into the archive."
        : "Couldn't generate a frame right now — try again in a moment.",
      tried,
    },
    { status: 502 },
  );
}
