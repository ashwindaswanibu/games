import { FILM_INDEX_PARTS } from "@/games/_movies/film-index";
import { db } from "@/server/supabase/admin";

/**
 * The film list for search in the browser (`src/games/_movies/film-index.ts`), one part of
 * `FILM_INDEX_PARTS`: GET /api/catalog/films/index?part=0. Titles, years, directors and fame of
 * every film anyone can search for, nothing about any puzzle, so no sign-in and no proxy: browsers
 * and the CDN keep each part for a day (stale for a week while it refreshes), so a player downloads
 * the list about once a day and a CDN miss costs one query.
 */
export async function GET(request: Request) {
  const part = Number(new URL(request.url).searchParams.get("part"));
  if (!Number.isInteger(part) || part < 0 || part >= FILM_INDEX_PARTS) {
    return Response.json({ error: `part must be 0–${FILM_INDEX_PARTS - 1}.` }, { status: 400 });
  }
  const { data, error } = await db().rpc("catalog_film_index", { p_part: part, p_parts: FILM_INDEX_PARTS });
  if (error) throw new Error(`Film index failed: ${error.message}`);
  return new Response(data, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
