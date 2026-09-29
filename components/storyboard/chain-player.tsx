"use client";

import { useEffect, useRef } from "react";

import { blobUrl } from "@/components/storyboard/blob-url";
import type { Part, Segment } from "@/lib/storyboard";

/** MediaRecorder WebM has no duration/cues; forcing a seek to the end makes
 *  Chrome index the file so later seeks land accurately. */
export async function prepareSeekable(video: HTMLVideoElement) {
  if (video.readyState < 1) {
    await new Promise<void>((resolve) =>
      video.addEventListener("loadedmetadata", () => resolve(), { once: true }),
    );
  }
  if (!Number.isFinite(video.duration)) {
    await new Promise<void>((resolve) => {
      const done = () => {
        if (Number.isFinite(video.duration)) {
          video.removeEventListener("durationchange", done);
          video.removeEventListener("timeupdate", done);
          resolve();
        }
      };
      video.addEventListener("durationchange", done);
      video.addEventListener("timeupdate", done);
      video.currentTime = 1e101;
      setTimeout(resolve, 3000);
    });
  }
}

export function seekTo(video: HTMLVideoElement, seconds: number) {
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = seconds;
    setTimeout(done, 1500);
  });
}

type Props = {
  parts: Part[];
  segments: Segment[];
  startAt?: number; // ms in version time
  loop?: boolean;
  muted?: boolean;
  className?: string;
  onTime?: (ms: number) => void;
  onEnded?: () => void;
};

/** Plays a version (a list of segment slices) back as one continuous clip. */
export function ChainPlayer({
  parts,
  segments,
  startAt = 0,
  loop = false,
  muted = true,
  className,
  onTime,
  onEnded,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cbs = useRef({ onTime, onEnded });
  cbs.current = { onTime, onEnded };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const lengths = parts.map((p) => (p.to ?? p.from) - p.from);
    const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));

    const playPart = async (i: number, localStart: number) => {
      if (cancelled) return;
      const part = parts[i];
      const seg = segments.find((s) => s.id === part?.segId);
      if (!part || !seg?.blob) {
        if (loop && parts.length) return playPart(0, parts[0].from);
        cbs.current.onEnded?.();
        return;
      }
      if (video.src !== blobUrl(seg.blob)) {
        video.src = blobUrl(seg.blob);
        await prepareSeekable(video);
      }
      if (cancelled) return;
      await seekTo(video, localStart / 1000);
      if (cancelled) return;
      await video.play().catch(() => {});

      const tick = () => {
        if (cancelled) return;
        const localMs = video.currentTime * 1000;
        cbs.current.onTime?.(offsets[i] + (localMs - part.from));
        const end = part.to ?? Infinity;
        if (localMs >= end - 40 || video.ended) {
          video.pause();
          void playPart(i + 1, parts[i + 1]?.from ?? 0);
          return;
        }
        timer = setTimeout(tick, 40);
      };
      timer = setTimeout(tick, 40);
    };

    // Find the part that contains startAt.
    let index = 0;
    for (let i = 0; i < parts.length; i++) {
      if (startAt >= offsets[i]) index = i;
    }
    const local = (parts[index]?.from ?? 0) + Math.max(0, startAt - (offsets[index] ?? 0));
    void playPart(index, local);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      video.pause();
    };
    // Restart only when the chain itself or the start point changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, segments, startAt, loop]);

  return <video ref={videoRef} className={className} muted={muted} playsInline />;
}

/** Re-record a version in real time into one downloadable WebM file. */
export async function exportVersion(
  parts: Part[],
  segments: Segment[],
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  const total = parts.reduce((sum, p) => sum + ((p.to ?? p.from) - p.from), 0);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);
  const mime = ["video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let done = 0;
  let started = false;
  for (const part of parts) {
    const seg = segments.find((s) => s.id === part.segId);
    if (!seg?.blob) continue;
    video.src = blobUrl(seg.blob);
    await prepareSeekable(video);
    if (!started) {
      canvas.width = Math.min(1920, video.videoWidth || 1920);
      canvas.height = Math.round(canvas.width * ((video.videoHeight || 9) / (video.videoWidth || 16)));
      recorder.start(500);
      started = true;
    }
    await seekTo(video, part.from / 1000);
    await video.play().catch(() => {});
    const end = part.to ?? Infinity;
    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const local = video.currentTime * 1000;
        onProgress(Math.min(1, (done + local - part.from) / Math.max(1, total)));
        if (local >= end - 40 || video.ended) {
          video.pause();
          resolve();
          return;
        }
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    done += (part.to ?? part.from) - part.from;
  }
  if (!started) throw new Error("Nothing recorded in this version yet.");
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });
  onProgress(1);
  return new Blob(chunks, { type: "video/webm" });
}
