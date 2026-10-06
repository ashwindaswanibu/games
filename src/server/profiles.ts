import "server-only";
import { randomInt } from "node:crypto";
import {
  deriveDisplayName,
  deriveUsernameBase,
  escapeLike,
  nextDisplayNumber,
  numberedDisplayName,
  pickAvailableUsername,
  randomizedUsername,
  suffixedDisplayName,
  usernameCollisionPattern,
} from "@/lib/username";
import { emailForUsername, isEmailTaken, isPasswordAccountEmail, type SessionUser } from "./auth";
import type { ProfileRow } from "./database.types";
import { db } from "./supabase/admin";

const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Which `profiles` uniqueness rule a write broke, from Postgres' "Key (column)=(value) already
 * exists" detail: the account already has a profile, the username is taken, or someone already
 * goes by that display name (`profiles_display_name_lower_key`, case-insensitive). Null when it's
 * not a unique violation at all.
 */
export function profileConflict(error: DbError | null | undefined): "account" | "username" | "display_name" | "other" | null {
  if (error?.code !== UNIQUE_VIOLATION) return null;
  const text = `${error.details ?? ""} ${error.message ?? ""}`;
  if (/\(id\)=|profiles_pkey/.test(text)) return "account";
  if (/\(username\)=|profiles_username_key/.test(text)) return "username";
  if (/display_name/.test(text)) return "display_name";
  return "other";
}

/** A display-name check constraint refused the value (a rule the app's own validation doesn't mirror). */
function displayNameRejected(error: DbError): boolean {
  return error.code === CHECK_VIOLATION && /display_name/.test(`${error.message ?? ""} ${error.details ?? ""}`);
}

async function hasProfile(userId: string): Promise<boolean> {
  const { data, error } = await db().from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data !== null;
}

/**
 * Existing usernames a new name derived from `base` could collide with (`base`, `base2`, …). The
 * API caps how many rows come back, so the set can be incomplete; provisioning copes by switching
 * to random suffixes when the numbered names keep losing.
 */
async function usernamesTakenFor(base: string): Promise<Set<string>> {
  const { data, error } = await db().from("profiles").select("username").filter("username", "match", usernameCollisionPattern(base));
  if (error) throw new Error(`Failed to check usernames: ${error.message}`);
  return new Set(data.map((row) => row.username));
}

/** The next number for `name` among existing display names (`Ana Ruiz 3` when 1 and 2 are taken). */
async function nextFreeDisplayNumber(name: string): Promise<number> {
  const { data, error } = await db().from("profiles").select("display_name").ilike("display_name", `${escapeLike(name)}%`);
  if (error) throw new Error(`Failed to check display names: ${error.message}`);
  return nextDisplayNumber(name, data.map((row) => row.display_name));
}

/** 4 random base-36 characters (1.7M possibilities): a suffix nobody can claim in advance. */
function randomSuffix(): string {
  return randomInt(36 ** 4).toString(36).padStart(4, "0");
}

/** Lost username races before switching from `ana2`-style names to `ana_x7k2`-style ones. */
const NUMBERED_USERNAME_TRIES = 2;
/** Every try after the second one uses random suffixes for both names, so this is never reached in practice. */
const PROVISION_ATTEMPTS = 10;

export type ProvisionResult =
  /** The player already had a profile (or another tab created it a moment ago). */
  | "exists"
  | "created"
  /** The session outlived its account (deleted by an admin): sign the caller out. */
  | "no-account"
  /**
   * Not a Google account. Username/password accounts get their profile at sign-up, in the same
   * request, so a profile-less non-Google account was made some other way (such as Supabase's own
   * sign-up endpoint, bypassing the app's checks). It gets no profile: sign the caller out.
   */
  | "not-google";

/**
 * Gives a signed-in Google account without a profile one, named from its identity (Google's name
 * and email), so nobody is asked for anything on the way in. Safe to call concurrently for the
 * same account (two tabs) and for different accounts that want the same names: the unique
 * constraints decide, and a lost race tries again. Collisions can't lock anyone out: after a
 * couple of lost races (or names claimed on purpose) both names get random suffixes, and a display
 * name the database refuses falls back to the username.
 */
export async function provisionProfile(user: SessionUser): Promise<ProvisionResult> {
  if (await hasProfile(user.id)) return "exists";
  if (!user.providers.includes("google")) return "not-google";

  const base = deriveUsernameBase({ name: user.providerName, email: user.email });
  let usernameLosses = 0;
  let displayLosses = 0;
  let useUsernameAsDisplayName = false;

  for (let attempt = 1; attempt <= PROVISION_ATTEMPTS; attempt++) {
    const username =
      usernameLosses < NUMBERED_USERNAME_TRIES
        ? pickAvailableUsername(base, await usernamesTakenFor(base))
        : randomizedUsername(base, randomSuffix());
    const preferred = useUsernameAsDisplayName ? username : deriveDisplayName(user.providerName, username);
    const displayName =
      displayLosses === 0
        ? preferred
        : displayLosses === 1
          ? numberedDisplayName(preferred, await nextFreeDisplayNumber(preferred))
          : suffixedDisplayName(preferred, randomSuffix());

    const { error } = await db().from("profiles").insert({ id: user.id, username, display_name: displayName });
    if (!error) return "created";
    if (error.code === FOREIGN_KEY_VIOLATION) return "no-account";
    if (displayNameRejected(error) && !useUsernameAsDisplayName) {
      // The database refuses Google's name (say, one that renders blank): go by the username.
      useUsernameAsDisplayName = true;
      displayLosses = 0;
      continue;
    }

    switch (profileConflict(error)) {
      case "account": // another tab got there first
        return "exists";
      case "username": // someone claimed it since we looked
        usernameLosses++;
        break;
      case "display_name": // someone already goes by this name
        displayLosses++;
        break;
      case "other":
        if (await hasProfile(user.id)) return "exists";
        usernameLosses++;
        break;
      case null:
        throw new Error(`Failed to create profile: ${error.message}`);
    }
  }
  throw new Error(`Couldn't create a profile for ${user.id} after ${PROVISION_ATTEMPTS} attempts`);
}

// ---------------------------------------------------------------------------------------------

/**
 * How old a profile-less auth user must be before it counts as abandoned. Password sign-up creates
 * the auth user and its profile within one request, so a younger one may be a sign-up in flight.
 */
const ORPHAN_MIN_AGE_MS = 2 * 60 * 1000;

/** The auth user without a profile that holds `email`, if any (players are never returned). */
async function orphanHolding(email: string): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await db().rpc("orphan_auth_user_for_email", { p_email: email });
  if (error) throw new Error(`Failed to look up the holder of ${email}: ${error.message}`);
  return data[0] ?? null;
}

/**
 * - `free`: no profile-less auth user holds the email (a player's account still might).
 * - `reclaimed`: one did, and it was removed.
 * - `held`: one does, but it is too recent to remove: treat the username as taken for now.
 */
export type ReclaimResult = "free" | "reclaimed" | "held";

/**
 * Frees `username`'s sign-in email (`<username>@users.daily.invalid`) when an auth user without a
 * profile holds it. The app never leaves one behind for long (sign-up deletes the auth user if its
 * profile can't be created), so such a user was registered straight through Supabase Auth's public
 * sign-up endpoint (open, because new Google players need it) to squat the name, or is debris from
 * a crash. It can't be a player, so it is deleted once it is old enough not to be a sign-up in
 * flight.
 */
export async function reclaimSignInEmail(username: string, now = Date.now()): Promise<ReclaimResult> {
  const email = emailForUsername(username);
  const orphan = await orphanHolding(email);
  if (!orphan) return "free";
  if (now - new Date(orphan.created_at).getTime() < ORPHAN_MIN_AGE_MS) return "held";
  const { error: deleteError } = await db().auth.admin.deleteUser(orphan.id);
  if (deleteError) throw new Error(`Failed to remove profile-less auth user ${orphan.id}: ${deleteError.message}`);
  console.warn(`Removed profile-less auth user ${orphan.id} holding ${email}`);
  return "reclaimed";
}

// ---------------------------------------------------------------------------------------------

export type ProfileUpdateResult =
  | {
      ok: true;
      username: string;
      /** A username/password account's sign-in name changed along with its username. */
      signInChanged: boolean;
    }
  /** `stale`: the profile changed (another tab saved first) since the caller loaded it. */
  | { ok: false; reason: "username_taken" | "display_name_taken" | "stale" | "failed" };

function failedWrite(error: DbError, what: string, userId: string): ProfileUpdateResult {
  switch (profileConflict(error)) {
    case "username":
      return { ok: false, reason: "username_taken" };
    case "display_name":
      return { ok: false, reason: "display_name_taken" };
    default:
      console.error(`${what} failed for ${userId}: ${error.message}`);
      return { ok: false, reason: "failed" };
  }
}

async function setSignInEmail(userId: string, username: string) {
  return db().auth.admin.updateUserById(userId, {
    email: emailForUsername(username),
    email_confirm: true,
    user_metadata: { username },
  });
}

/**
 * Points a password account's sign-in email at whatever username its profile has *now*, read
 * fresh, rather than at a value remembered earlier: a concurrent rename may have changed it.
 * The invariant this keeps is "sign in with the username the profile shows".
 */
async function syncSignInEmail(userId: string): Promise<void> {
  const [{ data: profile, error: profileError }, { data: account, error: accountError }] = await Promise.all([
    db().from("profiles").select("username").eq("id", userId).maybeSingle(),
    db().auth.admin.getUserById(userId),
  ]);
  if (profileError || accountError || !profile || !account.user) {
    console.error(`CRITICAL: couldn't check ${userId}'s sign-in email against their username: ${profileError?.message ?? accountError?.message ?? "missing"}`);
    return;
  }
  if (account.user.email === emailForUsername(profile.username)) return;
  const { error } = await setSignInEmail(userId, profile.username);
  if (error) {
    console.error(
      `CRITICAL: ${userId} signs in as ${account.user.email ?? "?"} but their username is ${profile.username}; moving the email back failed: ${error.message}`,
    );
  }
}

/**
 * Changes a player's username and/or display name. Username/password accounts sign in with
 * `<username>@users.daily.invalid`, so for them the auth email moves first and the profile second;
 * if the profile write fails, the email follows the profile back, so the player can always sign
 * in with the username their profile shows. Google accounts only need the profile updated.
 *
 * The profile write is a compare-and-set on the username the caller loaded, so two saves racing
 * (two tabs, or a replayed request) can't leave the sign-in email and the username apart: the
 * loser changes nothing, and both re-check the email against the profile as it ends up.
 * The caller has already authorized and validated the request.
 */
export async function updateProfile(
  profile: Pick<ProfileRow, "id" | "username" | "display_name">,
  next: { username: string; displayName: string },
): Promise<ProfileUpdateResult> {
  if (next.username === profile.username) {
    const { data, error } = await db()
      .from("profiles")
      .update({ display_name: next.displayName })
      .eq("id", profile.id)
      .eq("username", profile.username)
      .select("id");
    if (error) return failedWrite(error, "Display name update", profile.id);
    if (data.length === 0) return { ok: false, reason: "stale" };
    return { ok: true, username: profile.username, signInChanged: false };
  }

  // A friendly early answer for the common case; the unique constraint still has the last word.
  const { data: holder, error: holderError } = await db().from("profiles").select("id").eq("username", next.username).maybeSingle();
  if (holderError) return failedWrite(holderError, "Username lookup", profile.id);
  if (holder) return { ok: false, reason: "username_taken" };

  const { data: account, error: accountError } = await db().auth.admin.getUserById(profile.id);
  if (accountError || !account.user) {
    console.error(`Account lookup failed for ${profile.id}: ${accountError?.message ?? "no user"}`);
    return { ok: false, reason: "failed" };
  }
  const passwordAccount = isPasswordAccountEmail(account.user.email);

  if (passwordAccount) {
    const email = emailForUsername(next.username);
    try {
      // No profile has the name, but an auth user too recent to reclaim may hold its sign-in email.
      if ((await reclaimSignInEmail(next.username)) === "held") return { ok: false, reason: "username_taken" };
    } catch (error) {
      console.error(`Sign-in email check failed for ${profile.id}:`, error);
      return { ok: false, reason: "failed" };
    }
    const { error } = await setSignInEmail(profile.id, next.username);
    if (error) {
      // Someone took the email since the check above. The admin endpoint may say `email_exists`,
      // or just 500 when the unique index refuses it, so look again before calling it a failure.
      const taken = isEmailTaken(error) || Boolean(await orphanHolding(email).catch(() => null));
      if (taken) return { ok: false, reason: "username_taken" };
      console.error(`Sign-in email update failed for ${profile.id}: ${error.message}`);
      return { ok: false, reason: "failed" };
    }
  }

  const { data: renamed, error: profileError } = await db()
    .from("profiles")
    .update({ username: next.username, display_name: next.displayName })
    .eq("id", profile.id)
    .eq("username", profile.username)
    .select("id");
  const result: ProfileUpdateResult = profileError
    ? failedWrite(profileError, "Profile rename", profile.id)
    : renamed.length === 0
      ? { ok: false, reason: "stale" }
      : { ok: true, username: next.username, signInChanged: passwordAccount };
  // Success or not, a concurrent rename may have moved the email after ours: line it up with the
  // profile as it stands.
  if (passwordAccount) await syncSignInEmail(profile.id);
  return result;
}
