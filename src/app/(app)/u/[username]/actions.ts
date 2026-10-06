"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, formText, type FormState } from "@/lib/form-state";
import { displayNameSchema, usernameSchema } from "@/lib/validation";
import { requireProfile } from "@/server/auth";
import { updateProfile } from "@/server/profiles";
import { takeRateLimit } from "@/server/rate-limit";

const editProfileSchema = z.object({ username: usernameSchema, displayName: displayNameSchema });

/** What the profile page shows after a save (`?saved=`). */
export type SavedNotice = "profile" | "username";

/** The signed-in player edits their own username and display name; then back to their profile. */
export async function editProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireProfile();
  const values = { username: formText(formData, "username"), displayName: formText(formData, "displayName") };
  const parsed = editProfileSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, displayName } = parsed.data;

  if (username === me.username && displayName === me.display_name) redirect(`/u/${me.username}`);
  if (!(await takeRateLimit(me.id, "profileEdits"))) {
    return { error: "That's a lot of changes. Try again in an hour.", values };
  }

  const result = await updateProfile(me, { username, displayName });
  if (!result.ok) {
    switch (result.reason) {
      case "username_taken":
        return { fieldErrors: { username: "That username is taken." }, values };
      case "display_name_taken":
        return { fieldErrors: { displayName: "Someone already goes by that name." }, values };
      case "stale":
        return { error: "Your profile changed in another tab. Reload the page and try again.", values };
      case "failed":
        return { error: "Couldn't save your profile. Try again.", values };
    }
  }

  // Usernames and display names show up across the app (nav, boards, friends' results).
  revalidatePath("/", "layout");
  const notice: SavedNotice = result.signInChanged ? "username" : "profile";
  redirect(`/u/${result.username}?saved=${notice}`);
}
