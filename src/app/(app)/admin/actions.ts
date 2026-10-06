"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordSchema } from "@/lib/validation";
import { isPasswordAccountEmail, requireAdmin } from "@/server/auth";
import { db } from "@/server/supabase/admin";

export interface AdminFormState {
  ok?: string;
  error?: string;
}

const resetSchema = z.object({ userId: z.uuid(), password: passwordSchema });

/** Username/password accounts have no email to reset through, so an admin sets a new password. */
export async function resetPassword(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  const parsed = resetSchema.safeParse({ userId: formData.get("userId"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { data, error: lookupError } = await db().auth.admin.getUserById(parsed.data.userId);
  if (lookupError || !data.user) return { error: "User not found." };
  if (!isPasswordAccountEmail(data.user.email)) return { error: "That player signs in with Google." };

  const { error } = await db().auth.admin.updateUserById(parsed.data.userId, { password: parsed.data.password });
  if (error) return { error: "Couldn't update the password." };
  return { ok: "Password updated. Send it to them privately." };
}

const adminSchema = z.object({ userId: z.uuid(), makeAdmin: z.enum(["true", "false"]) });

export async function setAdmin(formData: FormData): Promise<void> {
  const me = await requireAdmin();
  const parsed = adminSchema.parse({ userId: formData.get("userId"), makeAdmin: formData.get("makeAdmin") });
  if (parsed.userId === me.id) throw new Error("You can't change your own admin status.");
  const { error } = await db().from("profiles").update({ is_admin: parsed.makeAdmin === "true" }).eq("id", parsed.userId);
  if (error) throw new Error(`Failed to update admin flag: ${error.message}`);
  revalidatePath("/admin");
}
