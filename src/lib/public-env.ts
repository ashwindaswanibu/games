/**
 * Public configuration, safe for the browser and the proxy. `process.env.NEXT_PUBLIC_*` must be
 * referenced literally so Next.js can inline the values at build time.
 */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

export const publicEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  },
  /**
   * Google sign-in needs a Google OAuth client configured in Supabase. Off unless explicitly
   * enabled, so the button never leads to Supabase's "provider is not enabled" error page.
   */
  get googleAuthEnabled() {
    return process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  },
};
