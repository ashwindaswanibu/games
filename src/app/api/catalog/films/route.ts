import type { NextRequest } from "next/server";
import { CATALOG_PARAMS_ERROR, parseCatalogSearchParams, type FilmSearchResponse } from "@/games/_movies/schemas";
import { canUseMoviesCatalog, searchFilms } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * Film autocomplete: GET /api/catalog/films?q=godfa&limit=8 → { results: FilmSearchHit[] }.
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to search films.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const params = parseCatalogSearchParams(request.nextUrl.searchParams);
  if (!params) return jsonError(400, CATALOG_PARAMS_ERROR);

  const body: FilmSearchResponse = { results: await searchFilms(params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
