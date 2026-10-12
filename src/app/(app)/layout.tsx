import type { Viewport } from "next";
import { today } from "@/core/day";
import { requireProfile } from "@/server/auth";
import { AppFrame } from "./app-frame";
import { AppNav } from "./app-nav";

/** The browser's own bars take the room's colour, whatever the system's scheme. */
export const viewport: Viewport = { themeColor: "#0b0b0c" };

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireProfile();
  return (
    <AppFrame date={today()} nav={<AppNav username={profile.username} isAdmin={profile.is_admin} />}>
      {children}
    </AppFrame>
  );
}
