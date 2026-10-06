import type { NextRequest } from "next/server";
import { CATALOG_PARAMS_ERROR, parseCatalogSearchParams, type PersonSearchResponse } from "@/games/_movies/schemas";
import { canUseMoviesCatalog, searchPeople } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * Person autocomplete: GET /api/catalog/people?q=pacino&limit=8 → { results: PersonSearchHit[] }.
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to search people.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const params = parseCatalogSearchParams(request.nextUrl.searchParams);
  if (!params) return jsonError(400, CATALOG_PARAMS_ERROR);

  const body: PersonSearchResponse = { results: await searchPeople(params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
