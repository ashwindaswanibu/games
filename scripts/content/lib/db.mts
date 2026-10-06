import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/database.types";
import { supabaseEnv } from "./env.mjs";

export type ContentDb = SupabaseClient<Database>;

let client: ContentDb | undefined;

/** Service-role client for content scripts (bypasses RLS; local tooling only). */
export function contentDb(): ContentDb {
  if (!client) {
    const { url, secretKey } = supabaseEnv();
    client = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** bytea as PostgREST expects it in JSON: "\x" + hex. */
export function toBytea(bytes: Buffer): string {
  return `\\x${bytes.toString("hex")}`;
}
