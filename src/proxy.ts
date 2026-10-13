import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth-cookies";
import { publicEnv } from "@/lib/public-env";

/** Routes reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth/"];
/** Routes a signed-in user has no reason to see. */
const SIGNED_OUT_ONLY = ["/login", "/signup"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

/**
 * Refreshes the Supabase session cookie on every navigation and bounces signed-out visitors to
 * /login. This is a convenience layer only: every page and server action re-checks auth itself.
 *
 * Route handlers (`/api/`) and server actions don't come through here (see `config`): each reads
 * the session itself (`getSessionUser`), which refreshes an expired one and can write its cookie
 * there (src/server/supabase/session.ts), and answers a signed-out caller its own way (401 for a
 * route, the redirect to /login for an action). That saves every search, image and move a hop.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the JWT (and refreshes it if expired). Must run before any early return.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;

  const redirectTo = (pathname: string) => {
    const redirect = NextResponse.redirect(new URL(pathname, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!signedIn && !matches(path, PUBLIC_PREFIXES)) return redirectTo("/login");
  if (signedIn && matches(path, SIGNED_OUT_ONLY)) return redirectTo("/");
  return response;
}

export const config = {
  matcher: [
    {
      // Not route handlers (api/) nor server actions (the next-action header): they read the session themselves.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [{ type: "header", key: "next-action" }],
    },
  ],
};
