import type { Metadata } from "next";
import { Avatar, Card, SectionTitle } from "@/components/ui";
import { GAMES } from "@/games/registry";
import { canResetPassword, canSetAdmin } from "@/server/admin-policy";
import { isPasswordAccountEmail, requireAdmin } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { db } from "@/server/supabase/admin";
import { revokeInvite, setAdmin } from "./actions";
import { InviteForm } from "./invite-form";
import { ResetPasswordForm } from "./reset-password-form";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const me = await requireAdmin();

  const [{ data: profiles, error }, { data: authUsers, error: authError }, { data: invites, error: inviteError }] = await Promise.all([
    db().from("profiles").select("*").order("created_at"),
    db().auth.admin.listUsers({ perPage: 1000 }),
    db().from("invites").select("id, note, created_by, created_at, expires_at, used_by, used_at").order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(`Failed to load players: ${error.message}`);
  if (authError) throw new Error(`Failed to load accounts: ${authError.message}`);
  if (inviteError) throw new Error(`Failed to load invites: ${inviteError.message}`);
  const emails = new Map(authUsers.users.map((u) => [u.id, u.email]));
  const owners = serverEnv().OWNER_USER_IDS;
  const usernames = new Map(profiles.map((p) => [p.id, p.username]));
  const inviteOf = new Map(invites.filter((i) => i.used_by).map((i) => [i.used_by!, i]));
  const now = new Date().toISOString();
  const openInvites = invites.filter((i) => !i.used_at && i.expires_at > now);

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
        <SectionTitle>Invites</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          <InviteForm />
          {openInvites.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.note}</p>
                <p className="text-xs text-muted">
                  by @{(i.created_by && usernames.get(i.created_by)) ?? "?"} · expires {shortDate(i.expires_at)}
                </p>
              </div>
              <form action={revokeInvite}>
                <input type="hidden" name="inviteId" value={i.id} />
                <button type="submit" className="text-xs font-medium text-muted underline underline-offset-4 hover:text-fg">
                  Revoke
                </button>
              </form>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-xs text-muted">Every new player needs their own invite. Each works once and expires after a week.</p>
      </section>

      <section>
        <SectionTitle>Players ({profiles.length})</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          {profiles.map((p) => {
            const passwordAccount = isPasswordAccountEmail(emails.get(p.id));
            const canToggleAdmin = canSetAdmin(me, p, !p.is_admin, owners);
            const invite = inviteOf.get(p.id);
            const inviter = invite?.created_by ? usernames.get(invite.created_by) : undefined;
            return (
              <div key={p.id} className="grid gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={p.display_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.display_name} {p.is_admin && <span className="text-xs text-muted">· {owners.includes(p.id) ? "owner" : "admin"}</span>}
                    </p>
                    <p className="text-xs text-muted">
                      @{p.username} · {passwordAccount ? "password" : "Google"} · joined {shortDate(p.created_at)}
                      {invite && ` · invite “${invite.note}”${inviter ? ` from @${inviter}` : ""}`}
                    </p>
                  </div>
                  {canToggleAdmin && (
                    <form action={setAdmin}>
                      <input type="hidden" name="userId" value={p.id} />
                      <input type="hidden" name="makeAdmin" value={String(!p.is_admin)} />
                      <button type="submit" className="text-xs font-medium text-muted underline underline-offset-4 hover:text-fg">
                        {p.is_admin ? "Remove admin" : "Make admin"}
                      </button>
                    </form>
                  )}
                </div>
                {passwordAccount && canResetPassword(me, p, owners) && <ResetPasswordForm userId={p.id} />}
              </div>
            );
          })}
        </Card>
      </section>
    </div>
  );
}
