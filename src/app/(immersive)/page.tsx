import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { HomeField } from "@/components/home-field/field";
import { isMobileAgent, VIEWPORT_COOKIE, viewportFor } from "@/components/home-field/model";
import { requireProfile } from "@/server/auth";
import { getHome } from "@/server/home";

export const metadata: Metadata = { title: "Today" };

/** Today: the day's games as one field (src/components/home-field). */
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const profile = await requireProfile();
  // Set by /auth/welcome after a first Google sign-in: the player never picked their @handle.
  const [{ welcome }, jar, request] = await Promise.all([searchParams, cookies(), headers()]);
  // Laid out for the window the browser last reported, so the HTML is the home's first frame.
  const viewport = viewportFor(jar.get(VIEWPORT_COOKIE)?.value, isMobileAgent(request.get("sec-ch-ua-mobile"), request.get("user-agent")));
  return (
    <HomeField
      model={await getHome(profile)}
      viewport={viewport}
      welcome={welcome === "1" ? { firstName: profile.display_name.split(" ")[0]!, displayName: profile.display_name, username: profile.username } : null}
    />
  );
}
