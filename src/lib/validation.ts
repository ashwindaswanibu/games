import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "3–20 characters: letters, numbers or underscores.");

/**
 * Characters that are invisible, blank-looking or reorder text: controls, format characters
 * (zero-width spaces, bidi overrides, …), line/paragraph separators, and filler characters that
 * render as blanks. Mirrors `profiles_display_name_visible_check` in the database.
 */
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u2800\u3164\uFFA0]/u;
/** A zero-width joiner between two emoji (👩‍💻) is part of the emoji, not hidden text. */
const EMOJI_JOINER = /(\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic})/gu;
const VISIBLE_CHAR = /[\p{L}\p{N}\p{S}]/u;

/** Shown on every board, so it must be visible and can't hide or reorder text. */
export const displayNameSchema = z
  .string()
  .normalize("NFC")
  .trim()
  .min(1, "Pick a display name.")
  .max(40, "Keep it under 40 characters.")
  .refine((name) => !HIDDEN_CHARS.test(name.replace(EMOJI_JOINER, "$1")), "Use visible characters only.")
  .refine((name) => VISIBLE_CHAR.test(name), "Include at least one letter, number or emoji.");

// bcrypt (used by Supabase Auth) ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.");
