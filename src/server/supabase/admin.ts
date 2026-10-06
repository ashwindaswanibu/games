import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/public-env";
import { serverEnv } from "../env";
import type { Database } from "../database.types";

let client: SupabaseClient<Database> | undefined;

/**
 * Service-role client: bypasses RLS. Every caller is responsible for authorizing the request
 * first (see `server/auth.ts`). Never import this from client code — `server-only` enforces it.
 */
export function db(): SupabaseClient<Database> {
  client ??= createClient<Database>(publicEnv.supabaseUrl, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
