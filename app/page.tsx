import { redirect } from "next/navigation";

// The app lives at /storyboard; the original Orbis starter demo is kept at /starter.
export default function Home() {
  redirect("/storyboard");
}
