import type { NextRequest } from "next/server";
import { parseScopedSearchParams, SCOPED_PARAMS_ERROR } from "@/games/_movies/scoped-search";
import type { FilmSearchResponse } from "@/games/_movies/schemas";
import { searchFilmography } from "@/server/catalog-scoped";
import { canUseMoviesCatalog } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * Films one person is credited in, matching a search:
 * GET /api/catalog/filmography?person=12&q=heat&limit=8 → { results: FilmSearchHit[] }.
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ bucket: "catalog", signedOutMessage: "Sign in to search films.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const params = parseScopedSearchParams(request.nextUrl.searchParams, "person");
  if (!params) return jsonError(400, SCOPED_PARAMS_ERROR);

  const body: FilmSearchResponse = { results: await searchFilmography(params.person, params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
