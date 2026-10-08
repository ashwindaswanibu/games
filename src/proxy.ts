import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth-cookies";
import { publicEnv } from "@/lib/public-env";

/** Routes reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth/"];
/** Routes a signed-in user has no reason to see. */
const SIGNED_OUT_ONLY = ["/login", "/signup"];
/** Route handlers answer signed-out callers with 401 themselves; a redirect to HTML would break fetch(). */
const API_PREFIX = "/api/";

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

/**
 * Refreshes the Supabase session cookie on every navigation and bounces signed-out visitors to
 * /login. This is a convenience layer only: every page and server action re-checks auth itself.
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

  if (path.startsWith(API_PREFIX)) return response;
  if (!signedIn && !matches(path, PUBLIC_PREFIXES)) return redirectTo("/login");
  if (signedIn && matches(path, SIGNED_OUT_ONLY)) return redirectTo("/");
  return response;
}

export const config = {
  matcher: [
    // Sealed puzzle images need no session (see src/app/api/assets/[id]/sealed/route.ts).
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|api/assets/.+/sealed$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
