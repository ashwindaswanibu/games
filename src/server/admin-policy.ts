import "server-only";

/**
 * Who may manage whom on /admin. Admins are trusted friends, but an admin account can be
 * compromised (a stolen session), and it must not be able to lock the owner out or strip the other
 * admins. So: nobody acts on an owner but the owner; only an owner may reset another admin's
 * password or remove their admin rights; any admin may manage regular players and promote them.
 * Owners come from `OWNER_USER_IDS` (see `env.ts`); with none configured, admins can't touch each
 * other in the app at all (use the Supabase dashboard).
 *
 * Nobody resets their own password here: a reset needs no current password, so it would let a
 * stolen admin session set a password it knows and keep the account (the reset signs out every
 * other session, including the real admin's). Admins ask an owner; owners use the dashboard.
 */
export interface ManagedAccount {
  id: string;
  is_admin: boolean;
}

export function canResetPassword(caller: ManagedAccount, target: ManagedAccount, owners: readonly string[]): boolean {
  if (target.id === caller.id) return false;
  if (owners.includes(target.id)) return false;
  if (target.is_admin) return owners.includes(caller.id);
  return true;
}

export function canSetAdmin(caller: ManagedAccount, target: ManagedAccount, makeAdmin: boolean, owners: readonly string[]): boolean {
  if (target.id === caller.id) return false;
  if (owners.includes(target.id)) return false;
  if (target.is_admin && !makeAdmin) return owners.includes(caller.id);
  return true;
}
