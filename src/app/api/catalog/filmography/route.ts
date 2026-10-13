import type { NextRequest } from "next/server";
import { parseScopedListParams, parseScopedSearchParams, SCOPED_PARAMS_ERROR } from "@/games/_movies/scoped-search";
import type { FilmographyList, FilmSearchResponse } from "@/games/_movies/schemas";
import { filmographyList, searchFilmography } from "@/server/catalog-scoped";
import { canUseMoviesCatalog } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * Films one person is credited in, matching a search:
 * GET /api/catalog/filmography?person=12&q=heat&limit=8 → { results: FilmSearchHit[] }.
 * Or all of them, to search in the browser as the player types (the search above is then asked
 * only for its typo matches): GET /api/catalog/filmography?person=12 → FilmographyList. The whole
 * list is public catalog data that changes about once a day, so the browser keeps it for a day.
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to search films.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const search = request.nextUrl.searchParams;
  if (!search.has("q")) {
    const person = parseScopedListParams(search, "person");
    if (person === null) return jsonError(400, SCOPED_PARAMS_ERROR);
    const body: FilmographyList = { films: await filmographyList(person) };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=86400" } });
  }

  const params = parseScopedSearchParams(search, "person");
  if (!params) return jsonError(400, SCOPED_PARAMS_ERROR);

  const body: FilmSearchResponse = { results: await searchFilmography(params.person, params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
