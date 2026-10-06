import { z } from "zod";

/**
 * Environment for the end-to-end suites (`npm run test:e2e*`, which load `.env.local`). The suites
 * sign in with real accounts and write to the database, so both the app and the database must be
 * local: anything else is refused before a browser starts.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalUrl(value: string): boolean {
  const host = new URL(value).hostname;
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".test");
}

const baseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine(isLocalUrl, "E2E suites only run against a local Supabase"),
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** The local admin test account (sign it up locally, then make it an admin). */
  E2E_TEST_USERNAME: z.string().min(1, "Set E2E_TEST_USERNAME in .env.local (a local admin test account)"),
  E2E_TEST_PASSWORD: z.string().min(1, "Set E2E_TEST_PASSWORD in .env.local"),
  /** The dev server under test, e.g. `npx next dev -p 3300`; any local port works. */
  E2E_BASE_URL: z.url().refine(isLocalUrl, "E2E suites only drive a local dev server").default("http://localhost:3300"),
  E2E_CHROME_PATH: z.string().min(1).default("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
});

const moviesSchema = baseSchema.extend({
  /** Where screenshots go, relative to the project root. */
  E2E_SHOTS_DIR: z.string().min(1).default("design/overnight-shots"),
});

const accountsSchema = baseSchema.extend({
  /** To sign in as an account the login form can't reach (one with a real email, like Google's). */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

function parse<S extends z.ZodType<{ E2E_BASE_URL: string }>>(schema: S): z.infer<S> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`E2E environment is incomplete (run through \`npm run test:e2e*\`, which loads .env.local):\n${problems}`);
  }
  return { ...parsed.data, E2E_BASE_URL: parsed.data.E2E_BASE_URL.replace(/\/+$/, "") };
}

export type E2eEnv = z.infer<typeof moviesSchema>;
export type E2eAccountsEnv = z.infer<typeof accountsSchema>;

/** For the Movies suite (`npm run test:e2e`). */
export function e2eEnv(): E2eEnv {
  return parse(moviesSchema);
}

/** For the accounts suite (`npm run test:e2e:accounts`). */
export function e2eAccountsEnv(): E2eAccountsEnv {
  return parse(accountsSchema);
}
