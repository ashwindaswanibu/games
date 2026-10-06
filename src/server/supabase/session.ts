import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/public-env";
import type { Database } from "../database.types";

/**
 * Supabase client bound to the current request's auth cookies. Use it only for auth operations
 * (who is the caller, sign in/out); data access goes through `db()` with explicit checks.
 */
export async function sessionClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't write cookies. Safe to ignore: the proxy refreshes sessions.
        }
      },
    },
  });
}
