import type { Metadata } from "next";

import { StoryboardApp } from "@/components/storyboard/storyboard-app";

import "./storyboard.css";

export const metadata: Metadata = {
  title: "Living Storyboard",
  description:
    "A storyboard that moves: drop in reference frames, direct each shot live with Orbis, and present the board to cast and crew.",
};

export default function StoryboardPage() {
  return <StoryboardApp />;
}
