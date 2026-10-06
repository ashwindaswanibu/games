import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "@/server/supabase/session";

/** OAuth (PKCE) landing: trade the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await sessionClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // New Google users have no profile yet; the app layout sends them to /onboarding.
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=oauth", request.url));
}
