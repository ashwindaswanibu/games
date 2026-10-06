import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "3–20 characters: letters, numbers or underscores.");

/** Mirrors the `profiles.display_name` check constraint. */
export const DISPLAY_NAME_MAX = 40;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Pick a display name.")
  .max(DISPLAY_NAME_MAX, `Keep it under ${DISPLAY_NAME_MAX} characters.`);

/** A display name the player may leave blank (undefined), e.g. to default it to their username. */
export const optionalDisplayNameSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .pipe(displayNameSchema.optional());

// bcrypt (used by Supabase Auth) ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.");
