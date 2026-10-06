import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "3–20 characters: letters, numbers or underscores.");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Pick a display name.")
  .max(40, "Keep it under 40 characters.");

// bcrypt (used by Supabase Auth) ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.");
