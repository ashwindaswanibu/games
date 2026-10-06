import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the Supabase session cookies, shared by the proxy and the server's session client so
 * they can't drift apart. No browser code talks to Supabase, so the cookies holding the access and
 * refresh tokens are HttpOnly (page scripts, and so any future XSS, can't read them) and Secure in
 * production. (@supabase/ssr fixes their max-age itself; session lifetime is set in Supabase Auth.)
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};
