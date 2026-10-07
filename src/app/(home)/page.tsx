import type { Viewport } from "next";
import { cueAt, homeClock } from "@/core/daylight";
import { Home } from "@/components/home/home";
import { CUE_GROUND, homeProps, renderedAt } from "@/components/home/home-props";
import { requireProfile } from "@/server/auth";
import { getHomeView } from "@/server/home";
import { HOME_FONT_VARS } from "./fonts";

/** The browser's bars take the room's ground: cream by day, the dark room after dusk. */
export function generateViewport(): Viewport {
  const now = new Date();
  return { themeColor: CUE_GROUND[cueAt(now, homeClock(now))] };
}

/**
 * Today ("/"): the day's title sequence. A server component that loads the view and hands plain
 * data to the one client root.
 */
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const profile = await requireProfile();
  const params = await searchParams;
  // Set by /auth/welcome after a first Google sign-in: the player never picked their @handle.
  const view = await getHomeView(profile, { welcome: params.welcome === "1" });
  return <Home {...homeProps(view, params, { realNow: renderedAt() })} className={HOME_FONT_VARS} />;
}
