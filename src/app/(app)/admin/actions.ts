"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordSchema } from "@/lib/validation";
import { canResetPassword, canSetAdmin, type ManagedAccount } from "@/server/admin-policy";
import { isPasswordAccountEmail, requireAdmin } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { createInvite as storeInvite } from "@/server/invite";
import { db } from "@/server/supabase/admin";

export interface AdminFormState {
  ok?: string;
  error?: string;
}

export interface InviteFormState {
  /** The new invite code: shown once, never stored. */
  code?: string;
  note?: string;
  error?: string;
}

async function loadTarget(userId: string): Promise<ManagedAccount | null> {
  const { data, error } = await db().from("profiles").select("id, is_admin").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load player: ${error.message}`);
  return data;
}

const resetSchema = z.object({ userId: z.uuid(), password: passwordSchema });

/** Username/password accounts have no email to reset through, so an admin sets a new password. */
export async function resetPassword(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const me = await requireAdmin();
  const parsed = resetSchema.safeParse({ userId: formData.get("userId"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const target = await loadTarget(parsed.data.userId);
  if (!target) return { error: "User not found." };
  if (target.id === me.id) return { error: "You can't reset your own password here. Ask the owner." };
  if (!canResetPassword(me, target, serverEnv().OWNER_USER_IDS)) return { error: "Only the owner can reset another admin's password." };

  const { data, error: lookupError } = await db().auth.admin.getUserById(parsed.data.userId);
  if (lookupError || !data.user) return { error: "User not found." };
  if (!isPasswordAccountEmail(data.user.email)) return { error: "That player signs in with Google." };

  // The database refuses password changes the server hasn't authorised just before (see the
  // password-change-guard migration), so a stolen session can't change a password on its own.
  const { error: allowError } = await db().rpc("allow_password_change", { p_user_id: parsed.data.userId });
  if (allowError) throw new Error(`Failed to authorise the password change: ${allowError.message}`);
  const { error } = await db().auth.admin.updateUserById(parsed.data.userId, { password: parsed.data.password });
  if (error) return { error: "Couldn't update the password." };
  console.info(`admin: ${me.id} reset the password of ${target.id}`);
  return { ok: "Password updated. Send it to them privately." };
}

const adminSchema = z.object({ userId: z.uuid(), makeAdmin: z.enum(["true", "false"]) });

export async function setAdmin(formData: FormData): Promise<void> {
  const me = await requireAdmin();
  const parsed = adminSchema.parse({ userId: formData.get("userId"), makeAdmin: formData.get("makeAdmin") });
  const makeAdmin = parsed.makeAdmin === "true";
  const target = await loadTarget(parsed.userId);
  if (!target) throw new Error("User not found.");
  if (!canSetAdmin(me, target, makeAdmin, serverEnv().OWNER_USER_IDS)) throw new Error("You can't change this player's admin status.");
  const { error } = await db().from("profiles").update({ is_admin: makeAdmin }).eq("id", parsed.userId);
  if (error) throw new Error(`Failed to update admin flag: ${error.message}`);
  console.info(`admin: ${me.id} ${makeAdmin ? "made" : "removed"} ${target.id} ${makeAdmin ? "an admin" : "as admin"}`);
  revalidatePath("/admin");
}

const inviteSchema = z.object({ note: z.string().normalize("NFC").trim().min(1, "Say who it's for.").max(40, "Keep it under 40 characters.") });

/** One invite per new player; it works once. The code is only ever shown in this response. */
export async function createInvite(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const me = await requireAdmin();
  const parsed = inviteSchema.safeParse({ note: formData.get("note") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const code = await storeInvite(me.id, parsed.data.note);
  console.info(`admin: ${me.id} created an invite for "${parsed.data.note}"`);
  revalidatePath("/admin");
  return { code, note: parsed.data.note };
}

const revokeSchema = z.object({ inviteId: z.uuid() });

export async function revokeInvite(formData: FormData): Promise<void> {
  const me = await requireAdmin();
  const { inviteId } = revokeSchema.parse({ inviteId: formData.get("inviteId") });
  // Only unused invites: a used one is the record of where an account came from.
  const { error } = await db().from("invites").delete().eq("id", inviteId).is("used_at", null);
  if (error) throw new Error(`Failed to revoke invite: ${error.message}`);
  console.info(`admin: ${me.id} revoked invite ${inviteId}`);
  revalidatePath("/admin");
}
