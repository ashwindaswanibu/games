import type { Viewport } from "next";
import { today } from "@/core/day";
import { cueAt, homeClock } from "@/core/daylight";
import { Home } from "@/components/home/home";
import { CUE_GROUND, homeProps, renderedAt } from "@/components/home/home-props";
import { qaInstant } from "@/components/home/qa";
import { requireProfile } from "@/server/auth";
import { getHomeView } from "@/server/home";
import { HOME_FONT_VARS } from "./fonts";

type Params = Awaited<PageProps<"/">["searchParams"]>;

/**
 * The instant the page is set at: now, or (development only) the New York time `?qa_t=HH:MM`
 * pretends, so presence windows, the set-in gate and the light all read the same clock.
 */
function sceneNow(params: Params, realNow: number): number {
  return qaInstant(params, today(new Date(realNow))) ?? realNow;
}

/** The browser's bars take the room's ground: cream by day, the dark room after dusk. */
export async function generateViewport({ searchParams }: PageProps<"/">): Promise<Viewport> {
  const now = new Date(sceneNow(await searchParams, renderedAt()));
  return { themeColor: CUE_GROUND[cueAt(now, homeClock(now))] };
}

/**
 * Today ("/"): the day's title sequence. A server component that loads the view and hands plain
 * data to the one client root.
 */
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const profile = await requireProfile();
  const params = await searchParams;
  const realNow = renderedAt();
  const now = sceneNow(params, realNow);
  // Set by /auth/welcome after a first Google sign-in: the player never picked their @handle.
  const view = await getHomeView(profile, { welcome: params.welcome === "1", now: new Date(now) });
  // The device clock is checked against the real time the view was built, never the pretended one
  // (the QA offset is applied on top, as on the fixtures page).
  const built = now === realNow ? view : { ...view, generatedAt: new Date(realNow).toISOString() };
  return <Home {...homeProps(built, params, { realNow })} className={HOME_FONT_VARS} />;
}
