import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cueAt } from "@/core/daylight";
import { Home } from "@/components/home/home";
import { CUE_GROUND, homeProps, renderedAt } from "@/components/home/home-props";
import { HOME_FONT_VARS } from "../../(home)/fonts";
import { fixtureView, isFixtureDate, SCENARIOS, type Scenario } from "./fixtures";

/**
 * Dev-only: the home rendered from fixture views (spec §13.2), so its UI is built and reviewed
 * without a seeded database. 404 unless HOME_QA=1 in development.
 *
 *   /home-fixtures?f=B&qa_t=13:40&date=2026-09-23
 */

export const metadata: Metadata = { title: "Home fixtures", robots: { index: false } };

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.HOME_QA === "1";
}

function scenarioOf(value: string | string[] | undefined): Scenario {
  return SCENARIOS.find((s) => s === value) ?? "B";
}

export async function generateViewport({ searchParams }: PageProps<"/home-fixtures">): Promise<Viewport> {
  if (!enabled()) return {};
  const params = await searchParams;
  const date = typeof params.date === "string" && isFixtureDate(params.date) ? params.date : undefined;
  const { view, sceneAt } = fixtureView(scenarioOf(params.f), date);
  return { themeColor: CUE_GROUND[cueAt(sceneAt, view.clock)] };
}

export default async function HomeFixturesPage({ searchParams }: PageProps<"/home-fixtures">) {
  if (!enabled()) notFound();
  const params = await searchParams;
  const date = typeof params.date === "string" && isFixtureDate(params.date) ? params.date : undefined;
  const { view, sceneAt } = fixtureView(scenarioOf(params.f), date);
  const realNow = renderedAt();
  // The clock runs from the scene's time: the view was "built" just now.
  const live = { ...view, generatedAt: new Date(realNow).toISOString() };
  return <Home {...homeProps(live, params, { realNow, sceneAt })} className={HOME_FONT_VARS} />;
}
