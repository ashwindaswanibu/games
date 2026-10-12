import type { Metadata } from "next";
import { GAMES } from "@/games/registry";
import { requireAdmin } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { db } from "@/server/supabase/admin";
import { AdminView } from "./admin-view";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const me = await requireAdmin();

  const [{ data: profiles, error }, { data: authUsers, error: authError }] = await Promise.all([
    db().from("profiles").select("*").order("created_at"),
    db().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw new Error(`Failed to load players: ${error.message}`);
  if (authError) throw new Error(`Failed to load accounts: ${authError.message}`);
  const emails = new Map(authUsers.users.map((u) => [u.id, u.email]));

  return <AdminView me={me} games={GAMES} profiles={profiles} emails={emails} owners={serverEnv().OWNER_USER_IDS} />;
}
