import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";

import { StoryboardApp } from "@/components/storyboard/storyboard-app";

import "./storyboard.css";

export const metadata: Metadata = {
  title: "Living Storyboard",
  description:
    "A storyboard that moves: drop in reference frames, direct each shot live with Orbis, and present the board to cast and crew.",
};

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export default function StoryboardPage() {
  return (
    <div className={`${archivo.variable} ${plexMono.variable}`}>
      <StoryboardApp />
    </div>
  );
}
