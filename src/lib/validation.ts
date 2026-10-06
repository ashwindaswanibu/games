import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "3–20 characters: letters, numbers or underscores.");

/** Mirrors the `profiles.display_name` length check in the database. */
export const DISPLAY_NAME_MAX = 40;

/**
 * Characters that are invisible, blank-looking or reorder text: controls, format characters
 * (zero-width spaces, bidi overrides, …), line/paragraph separators, and filler characters that
 * render as blanks. Mirrors `profiles_display_name_visible_check` in the database.
 */
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}ᅟᅠ⠀ㅤﾠ]/u;
const HIDDEN_CHARS_GLOBAL = new RegExp(HIDDEN_CHARS.source, "gu");
/** A zero-width joiner between two emoji (👩‍💻) is part of the emoji, not hidden text. */
const EMOJI_JOINER = /(\p{Extended_Pictographic}️?)‍(?=\p{Extended_Pictographic})/gu;
const JOINED_EMOJI_PLACEHOLDER = "\u{F0000}"; // a private-use character no real name contains
const VISIBLE_CHAR = /[\p{L}\p{N}\p{S}]/u;

/** Shown on every board, so it must be visible and can't hide or reorder text. */
export const displayNameSchema = z
  .string()
  .normalize("NFC")
  .trim()
  .min(1, "Pick a display name.")
  .max(DISPLAY_NAME_MAX, `Keep it under ${DISPLAY_NAME_MAX} characters.`)
  .refine((name) => !HIDDEN_CHARS.test(name.replace(EMOJI_JOINER, "$1")), "Use visible characters only.")
  .refine((name) => VISIBLE_CHAR.test(name), "Include at least one letter, number or emoji.");

/** A display name the player may leave blank (undefined), e.g. to default it to their username. */
export const optionalDisplayNameSchema = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .pipe(displayNameSchema.optional());

/**
 * A name from somewhere the player didn't type it (Google's profile name) made fit for
 * `displayNameSchema` where possible: NFC, every character the schema refuses as hidden becomes a
 * space (keeping the joiners inside emoji sequences), and whitespace collapses. Not guaranteed to
 * pass the schema (it may be empty, or too long): callers still parse the result.
 */
export function tidyDisplayName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(EMOJI_JOINER, `$1${JOINED_EMOJI_PLACEHOLDER}`)
    .replace(HIDDEN_CHARS_GLOBAL, " ")
    .replaceAll(JOINED_EMOJI_PLACEHOLDER, "‍")
    .replace(/\s+/g, " ")
    .trim();
}

// bcrypt (used by Supabase Auth) ignores bytes past 72.
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use at most 72 characters.");
