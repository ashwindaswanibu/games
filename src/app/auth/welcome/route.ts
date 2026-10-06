import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth";
import { provisionProfile } from "@/server/profiles";
import { sessionClient } from "@/server/supabase/session";

/**
 * First sign-in landing (`WELCOME_PATH`): a signed-in Google account without a profile gets one,
 * named from its identity, and goes straight to Today. Nothing to fill in; the player can change
 * their username and display name later from their profile page. Idempotent, so a reload or a
 * second tab is harmless.
 *
 * Every way out other than Today signs the session out first. Every app page sends profile-less
 * sessions here, and /login sends signed-in ones to Today, so a session left signed in after a
 * failure here would bounce between the two for good.
 */
export async function GET(request: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const signOutTo = async (path: string) => {
    const supabase = await sessionClient();
    await supabase.auth.signOut();
    return to(path);
  };

  const user = await getSessionUser();
  if (!user) return to("/login");

  try {
    switch (await provisionProfile(user)) {
      case "created":
        return to("/?welcome=1");
      case "exists":
        return to("/");
      case "no-account":
        return await signOutTo("/login");
      case "not-google":
        return await signOutTo("/login?error=account");
    }
  } catch (error) {
    console.error(`Couldn't set up a profile for ${user.id}:`, error);
    return await signOutTo("/login?error=welcome");
  }
}
