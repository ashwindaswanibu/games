import type { Metadata } from "next";
import { HomeField } from "@/components/home-field/field";
import { requireProfile } from "@/server/auth";
import { getHome } from "@/server/home";

export const metadata: Metadata = { title: "Today" };

/** Today: the day's games as one field (src/components/home-field). */
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const profile = await requireProfile();
  // Set by /auth/welcome after a first Google sign-in: the player never picked their @handle.
  const { welcome } = await searchParams;
  return (
    <HomeField
      model={await getHome(profile)}
      welcome={welcome === "1" ? { firstName: profile.display_name.split(" ")[0]!, displayName: profile.display_name, username: profile.username } : null}
    />
  );
}
