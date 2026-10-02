# Living Storyboard

**Previz you can direct.** A real-time playground where film directors try out
their ideas live with [Visko Orbis](https://www.visko.ai/models#orbis), keep the
takes that work, and leave with a storyboard.

> Demo video: _link coming_

---

## The problem

Before a shoot, directors *previsualise* (previz): they work out what each shot
looks like, where the camera goes and how the scene moves. Today that means one of
two things:

- **Static storyboards:** sketches or photos. They're fast, but they don't move, so
  timing, camera motion and mood stay in the director's head.
- **3D previz or animatics:** these move, but they take days of specialist work. A
  director can't change their mind in the middle of a meeting.

Generative video should help, but clip-based models work against how directors
think. You write a prompt, wait, get a few seconds, and if one thing is wrong you
start again from zero. Directors don't work in prompts. They work in **takes**:
*"again, slower,"* *"from there, have him turn around,"* *"same thing, but at golden
hour."*

## The idea

Living Storyboard treats Orbis as **a camera on set**. You set the scene, roll, and
direct **while the shot is playing**. Each direction lands in about two seconds and
the shot carries on; there's no regenerating and no restarting. Everything is
recorded to tape, so you can rewind to any moment and **branch a new take from
there**. The best frames become panels on a storyboard you can hand to your cast
and crew.

It's built for the way directors actually work: test the idea live, keep what
works, and show people.

## What you can do

| Stage | In the app |
|---|---|
| **Prep** | A **Gemini co-writer** turns a one-line brief into shot-by-shot beats. Collect lines in a **prompt archive** you can fire in order like a shooting script (**▶ Fire next**), and keep location photos and mood frames in an **image archive**. |
| **Set the scene** | Each shot has a **Setting** (who and where) that anchors every direction, plus an optional **reference frame**, so Orbis starts from your image. |
| **Direct live** | Type a direction, **hold to speak**, or tap pills for camera, framing, lens and mood. The live shot changes within seconds while it keeps rolling. |
| **Review and branch** | Every run is **auto-recorded to tape**. Scrub back, play it back, **★ mark the best take**, or **⟲ Redirect from here**: keep everything up to that moment and regenerate what follows as a new take (T1 → T2 → T3 …). |
| **Build the board** | **Capture stills** at any moment. **☆ Star** the ones that tell the story and they become panels on the **storyboard**: drag to reorder, choose 2, 3 or 4 per row, pick a 16:9, 2.39:1 or 4:3 frame, edit captions (pre-filled with the direction that was playing), add notes, and **Print / PDF**. |
| **Continue the scene** | Start the next shot **from a still of the previous one** (＋ Shot), so shots join up with continuity. |
| **Share** | **Present** mode plays the board back shot by shot, with the best take, directions and director's notes. |

Productions are kept on a home page with **Grid** and **Shelf** views.

## Why it needs real-time video

Real-time interaction is the whole product, not an add-on:

1. **Directing while it rolls.** Steering happens through Orbis `set_prompt` while
   the stream is running. A clip model can't take *"now he looks back"* halfway
   through a shot.
2. **Redirect from here.** Because Orbis continues from whatever frame it is given,
   any moment on the tape can become a new starting point. A take becomes a tree of
   alternatives instead of a pile of unrelated clips. Directors explore
   *variations of the same moment*, which is what previz is for.
3. **Continuity across shots.** A still captured in one shot seeds the next shot,
   so a three-shot sequence feels like one place and one world.

## Quick start

**You need:** Node.js 20.9+, Google Chrome (for voice input), and a
[Reactor](https://reactor.inc) API key with access to Visko Orbis.

```bash
git clone https://github.com/charchikasinha/living-storyboard.git
cd living-storyboard
cp .env.example .env.local     # then paste your keys into .env.local
npm install
npm run dev
```

Open <http://localhost:3000>. It takes you straight to `/storyboard`.

`.env.local`:

```dotenv
REACTOR_API_KEY=your_reactor_api_key      # required: Orbis
GEMINI_API_KEY=your_gemini_api_key        # optional: co-writer and ✦ Img
```

- With no Gemini key, set the co-writer to **Manual** and paste or write prompts
  yourself; everything else works.
- **✦ Img** (generate a reference still from a prompt) needs a Gemini key with
  image generation enabled; image models aren't on Google's free tier.
- Orbis bills per connected minute. The app **disconnects on its own after 3 idle
  minutes**, and **Disconnect** in the top bar ends the session.

### A two-minute tour

1. **＋ New production** → type a **Setting**, e.g. *"a silver SUV parked on a
   winding mountain road at sunrise"*.
2. **Connect to Orbis** → **▶ Shoot live**.
3. While it plays, type *"slow push in on the headlights"* and press **Set**, or tap
   **Push in** and **Low angle**.
4. Scrub the tape back a few seconds → change the direction → **⟲ Redirect from**.
   You now have take T2, branched from T1.
5. **Capture still** → ☆ star it → **Storyboard ↗**.

## How it works

- **Orbis session** (`hooks/use-orbis-session.ts`): Reactor JS SDK over WebRTC;
  `start` with an optional `set_image` reference frame, `set_prompt` to steer live,
  plus `pause`, `resume` and `reset`. Quick pill changes are debounced (≈450 ms) so
  a combination lands as one direction.
- **Prompt composition** (`lib/storyboard.ts`): Setting + active pills (camera,
  framing, lens, mood) + the typed or spoken direction + a cinematic style suffix.
- **Tape** (`components/storyboard/timeline.tsx`, `chain-player.tsx`): each live
  run is recorded with `MediaRecorder`, with a frame snapshot every 500 ms for
  scrubbing. A take is a list of segment slices, so *Redirect from here* keeps the
  slices up to the playhead and appends a new live segment started from the frame
  at that moment.
- **Storyboard** (`components/storyboard/storyboard-sheet.tsx`): every starred
  still, in the director's order, with layout controls and print styles.
- **Co-writer** (`app/api/cowriter/route.ts`): Gemini with structured JSON output
  (an array of beats) and a fallback chain across models when one is busy.
- **Storage:** productions, takes and stills live in the browser (IndexedDB) on
  the director's machine. Keys stay server-side in `.env.local`, and the browser
  only receives a short-lived Reactor token.

## Honest limitations

- Work is stored **in the browser that made it**; there are no accounts or sync
  yet. Takes can be exported as video files, and the storyboard as a PDF.
- **Hold to speak** uses the Web Speech API (Chrome).
- Image-generated reference frames depend on a paid Gemini key.

## Built with

[Visko Orbis](https://www.visko.ai) via the [Reactor](https://reactor.inc) JS SDK ·
Next.js · Google Gemini. Built for the **Visko Orbis Online Challenge (September
2026)** on top of the
[official starter](https://github.com/Visko-Platform/orbis-online-hackathon-starter);
the original starter demo is still available at `/starter`.

Made by Charchika Sinha.
