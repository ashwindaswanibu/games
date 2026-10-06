/**
 * Environment for content scripts. Scripts run locally (`npm run content:*`), with `.env.local`
 * loaded by the npm script. A missing variable fails with what it is for and where to get it.
 */

export function requireEnv(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

export function supabaseEnv(): { url: string; secretKey: string } {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL", "Run `npm run db:start` and copy the API URL into .env.local."),
    secretKey: requireEnv("SUPABASE_SECRET_KEY", "Run `npm run db:start` and copy the secret key into .env.local."),
  };
}

/** TMDB is the image source (stills, backdrops). Its key is free but personal; see README. */
export function tmdbApiKey(): string {
  return requireEnv(
    "TMDB_API_KEY",
    "Image pipelines need a TMDB API key: create a free account at https://www.themoviedb.org/settings/api, " +
      "then add TMDB_API_KEY=<v3 key or v4 read token> to .env.local. Until then use the DEV FIXTURE generators " +
      "(npm run content:fixtures).",
  );
}

/** True for a Supabase running on this machine. Fixture generators refuse anything else by default. */
export function isLocalSupabase(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host.endsWith(".localhost");
}
