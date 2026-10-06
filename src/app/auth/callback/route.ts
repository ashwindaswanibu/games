import { NextResponse, type NextRequest } from "next/server";
import { getProfile, WELCOME_PATH } from "@/server/auth";
import { sessionClient } from "@/server/supabase/session";

/** OAuth (PKCE) landing: trade the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await sessionClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A first Google sign-in has no profile yet: the welcome handler creates one, then Today.
      const profile = await getProfile(data.user.id);
      return NextResponse.redirect(new URL(profile ? "/" : WELCOME_PATH, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=oauth", request.url));
}
