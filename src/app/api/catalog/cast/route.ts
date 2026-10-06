import type { NextRequest } from "next/server";
import { parseScopedSearchParams, SCOPED_PARAMS_ERROR } from "@/games/_movies/scoped-search";
import type { PersonSearchResponse } from "@/games/_movies/schemas";
import { searchCast } from "@/server/catalog-scoped";
import { canUseMoviesCatalog } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * People credited in one film, matching a search:
 * GET /api/catalog/cast?film=34&q=de+niro&limit=8 → { results: PersonSearchHit[] }.
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ bucket: "catalog", signedOutMessage: "Sign in to search people.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const params = parseScopedSearchParams(request.nextUrl.searchParams, "film");
  if (!params) return jsonError(400, SCOPED_PARAMS_ERROR);

  const body: PersonSearchResponse = { results: await searchCast(params.film, params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
