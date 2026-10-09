import "server-only";
import type { Portrait } from "@/games/_movies/schemas";
import { decodeBytea } from "./assets";
import { db } from "./supabase/admin";

/**
 * Faces of catalog people (`movie_person_portraits`, written by `content:movies:portraits`). A face
 * is served by its own URL with the bytes' version in it, so browsers and the CDN keep it for good
 * and a new photo gets a new URL. A face says no more than the name it sits beside, so neither the
 * bytes nor which people have one are a spoiler.
 */

export const PORTRAIT_PATH = "/api/catalog/portraits";
/** Most faces one request may ask about (a chain, its ends, a search's hits). */
export const MAX_PORTRAIT_IDS = 40;

export function portraitSrc(personId: number, version: string): string {
  return `${PORTRAIT_PATH}/${personId}?v=${version}`;
}

const cleanIds = (ids: readonly number[]) => [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, MAX_PORTRAIT_IDS);

/** The face of each of `ids` that has one, with its credit. */
export async function loadPortraits(ids: readonly number[]): Promise<Portrait[]> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return [];
  const { data, error } = await db()
    .from("movie_person_portraits")
    .select("person_id, version, source_url, author, license, license_url")
    .in("person_id", wanted);
  if (error) throw new Error(`Failed to load portraits: ${error.message}`);
  return data.map((row) => ({
    id: row.person_id,
    src: portraitSrc(row.person_id, row.version),
    credit: { author: row.author, license: row.license, licenseUrl: row.license_url, source: row.source_url },
  }));
}

/** Just the URLs of the faces `ids` have, for search hits. */
export async function portraitSrcs(ids: readonly number[]): Promise<Map<number, string>> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return new Map();
  const { data, error } = await db().from("movie_person_portraits").select("person_id, version").in("person_id", wanted);
  if (error) throw new Error(`Failed to load portraits: ${error.message}`);
  return new Map(data.map((row) => [row.person_id, portraitSrc(row.person_id, row.version)]));
}

/** One face's bytes and version, or null when the person has none. */
export async function portraitBytes(personId: number): Promise<{ bytes: Buffer; version: string } | null> {
  const { data, error } = await db().from("movie_person_portraits").select("bytes, version").eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`Failed to load portrait: ${error.message}`);
  return data ? { bytes: decodeBytea(data.bytes), version: data.version } : null;
}
