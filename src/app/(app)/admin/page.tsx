import type { Metadata } from "next";
import { Avatar, Card, SectionTitle } from "@/components/ui";
import { GAMES } from "@/games/registry";
import { isPasswordAccountEmail, requireAdmin } from "@/server/auth";
import { db } from "@/server/supabase/admin";
import { setAdmin } from "./actions";
import { ResetPasswordForm } from "./reset-password-form";

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

  return (
    <div className="grid gap-8">
      <h1 className="pt-2 text-3xl font-bold tracking-tight">Admin</h1>

      <section>
        <SectionTitle>Games</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          {GAMES.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span aria-hidden>{g.emoji}</span>
              <span className="flex-1 font-medium">{g.name}</span>
              <code className="text-xs text-muted">{g.id}</code>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${g.availability === "live" ? "bg-good/15 text-good" : "bg-surface-2 text-muted"}`}>
                {g.availability}
              </span>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-xs text-muted">Availability is set in each game&apos;s definition. Testing games are visible only to admins and never count.</p>
      </section>

      <section>
        <SectionTitle>Players ({profiles.length})</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          {profiles.map((p) => {
            const passwordAccount = isPasswordAccountEmail(emails.get(p.id));
            return (
              <div key={p.id} className="grid gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={p.display_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.display_name} {p.is_admin && <span className="text-xs text-muted">· admin</span>}
                    </p>
                    <p className="text-xs text-muted">
                      @{p.username} · {passwordAccount ? "password" : "Google"}
                    </p>
                  </div>
                  {p.id !== me.id && (
                    <form action={setAdmin}>
                      <input type="hidden" name="userId" value={p.id} />
                      <input type="hidden" name="makeAdmin" value={String(!p.is_admin)} />
                      <button type="submit" className="text-xs font-medium text-muted underline underline-offset-4 hover:text-fg">
                        {p.is_admin ? "Remove admin" : "Make admin"}
                      </button>
                    </form>
                  )}
                </div>
                {passwordAccount && <ResetPasswordForm userId={p.id} />}
              </div>
            );
          })}
        </Card>
      </section>
    </div>
  );
}
