/**
 * Picks a starting username and display name for a player who signs in without choosing one
 * (Google). Pure and deterministic (randomness is passed in), so it's unit tested; the database
 * decides what's taken.
 *
 * Every username produced here satisfies `usernameSchema` (`^[a-z0-9_]{3,20}$`): a base of 3–15
 * characters, plus room for a numeric suffix of up to 5 digits when the base is taken.
 */

import { DISPLAY_NAME_MAX, displayNameSchema, tidyDisplayName } from "./validation";

export const USERNAME_MAX = 20;
/** Bases stop here so a collision suffix (`2` … `99999`) always fits within USERNAME_MAX. */
export const USERNAME_BASE_MAX = 15;
const USERNAME_MIN = 3;
const FALLBACK = "player";

export interface IdentityHints {
  /** The provider's name for the person (Google's `full_name` / `name`). Preferred: see below. */
  name?: string | null;
  /** The account email. Its local-part is the fallback hint. */
  email?: string | null;
}

/**
 * Lowercase ASCII `[a-z0-9_]` from arbitrary text: accents are folded (`José` → `jose`),
 * separators become `_`, everything else is dropped, runs of `_` collapse, and edges are trimmed.
 * May return "" when nothing usable is left.
 */
export function sanitizeUsername(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // combining marks left over from decomposition
    .toLowerCase()
    .replace(/[\s.\-+'’]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Shortens a sanitized name to `max` characters without leaving a trailing underscore. */
function clip(name: string, max: number): string {
  return name.slice(0, max).replace(/_+$/, "");
}

/** The email's local-part with any `+tag` sub-address removed (`ana.b+games@x` → `ana.b`). */
function emailHandle(email: string): string {
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  return local.split("+")[0] ?? "";
}

/**
 * A valid username base (3–15 characters) for a new player. Usernames are public (the @handle and
 * `/u/<username>` URLs), and the player never chose this one, so the provider name comes first:
 * an email local-part like `first.last1987` would show every player most of their address. The
 * email is the fallback (names in scripts that don't fold to ASCII), then "player". The first
 * source giving at least 3 characters wins; if none does, the longest partial one is padded
 * (`jo` → `jo_player`).
 */
export function deriveUsernameBase(hints: IdentityHints): string {
  const candidates = [hints.name ?? "", hints.email ? emailHandle(hints.email) : ""].map((source) =>
    clip(sanitizeUsername(source), USERNAME_BASE_MAX),
  );
  const usable = candidates.find((name) => name.length >= USERNAME_MIN);
  if (usable) return usable;
  const partial = candidates.reduce((longest, name) => (name.length > longest.length ? name : longest), "");
  return partial ? clip(`${partial}_${FALLBACK}`, USERNAME_BASE_MAX) : FALLBACK;
}

/**
 * The first username not in `taken`: `base`, then `base2`, `base3`, … The answer is always within
 * `taken.size + 2` tries, so the suffix stays short; `taken` only needs the names that start with
 * `base` (see `usernameCollisionPattern`).
 */
export function pickAvailableUsername(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (candidate.length > USERNAME_MAX) throw new Error(`No free username for base "${base}"`);
    if (!taken.has(candidate)) return candidate;
  }
}

/** Lowercase letters and digits only: the shape of a random suffix (`randomSuffix` in the server). */
const SUFFIX = /^[a-z0-9]{1,6}$/;

/**
 * `base_<suffix>`: a name that can't be predicted, for when the numbered names keep losing (many
 * players with the same name, or someone claiming them on purpose). Always a valid username.
 */
export function randomizedUsername(base: string, suffix: string): string {
  if (!SUFFIX.test(suffix)) throw new Error(`Not a username suffix: "${suffix}"`);
  return `${clip(base, USERNAME_MAX - 1 - suffix.length)}_${suffix}`;
}

/**
 * POSIX regex matching `base` and every `base<digits>` a collision could produce. Safe to embed:
 * a base contains only `[a-z0-9_]`, none of which are regex metacharacters.
 */
export function usernameCollisionPattern(base: string): string {
  if (!/^[a-z0-9_]+$/.test(base)) throw new Error(`Not a username base: "${base}"`);
  return `^${base}[0-9]*$`;
}

const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);

/** `text` cut to at most `max` UTF-16 units on a grapheme boundary (an emoji is never split). */
function clipGraphemes(text: string, max: number): string {
  let out = "";
  for (const segment of graphemes(text)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

/**
 * The provider's name for the person, tidied (`tidyDisplayName`: NFC, hidden and blank-looking
 * characters become spaces, whitespace collapses) and cut to DISPLAY_NAME_MAX on a grapheme
 * boundary. Falls back to the username when nothing usable is left or the result still isn't a
 * valid display name (say, only punctuation).
 */
export function deriveDisplayName(name: string | null | undefined, username: string): string {
  const parsed = displayNameSchema.safeParse(clipGraphemes(tidyDisplayName(name ?? ""), DISPLAY_NAME_MAX));
  return parsed.success ? parsed.data : username;
}

/**
 * `name` followed by a space and `suffix`, shortening the name (never the suffix) to stay within
 * DISPLAY_NAME_MAX: for when another player already goes by `name`.
 */
export function suffixedDisplayName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  return `${clipGraphemes(name, DISPLAY_NAME_MAX - tail.length).trimEnd()}${tail}`;
}

/** `Ana Ruiz` → `Ana Ruiz 2` (see `suffixedDisplayName`). `n` of 1 is the name itself. */
export function numberedDisplayName(name: string, n: number): string {
  return n <= 1 ? name : suffixedDisplayName(name, String(n));
}

/**
 * The smallest number above every one already used with `name` (`Ana Ruiz` counts as 1, `ana ruiz
 * 7` as 7), compared case-insensitively like the database's display-name index. `existing` is any
 * list of display names; ones that aren't `name` or `name <n>` are ignored. At least 2.
 */
export function nextDisplayNumber(name: string, existing: Iterable<string>): number {
  const want = name.toLowerCase();
  let highest = 1;
  for (const other of existing) {
    const lower = other.toLowerCase();
    if (!lower.startsWith(`${want} `)) continue;
    const digits = lower.slice(want.length + 1);
    if (/^[1-9][0-9]{0,5}$/.test(digits)) highest = Math.max(highest, Number(digits));
  }
  return highest + 1;
}

/** `text` as a literal SQL LIKE pattern (`%`, `_` and `\` escaped), to search by prefix. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
