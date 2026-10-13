import type { NextRequest } from "next/server";
import { parseScopedListParams, parseScopedSearchParams, SCOPED_PARAMS_ERROR } from "@/games/_movies/scoped-search";
import type { CastList, PersonSearchResponse } from "@/games/_movies/schemas";
import { castList, searchCast } from "@/server/catalog-scoped";
import { canUseMoviesCatalog } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";

/**
 * People credited in one film, matching a search:
 * GET /api/catalog/cast?film=34&q=de+niro&limit=8 → { results: PersonSearchHit[] }.
 * Or all of them with their faces, to search in the browser as the player types:
 * GET /api/catalog/cast?film=34 → CastList, kept by the browser for a day (public catalog data).
 * Signed-in players who can open a Movies game, rate limited.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to search people.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const search = request.nextUrl.searchParams;
  if (!search.has("q")) {
    const film = parseScopedListParams(search, "film");
    if (film === null) return jsonError(400, SCOPED_PARAMS_ERROR);
    const body: CastList = { people: await castList(film) };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=86400" } });
  }

  const params = parseScopedSearchParams(search, "film");
  if (!params) return jsonError(400, SCOPED_PARAMS_ERROR);

  const body: PersonSearchResponse = { results: await searchCast(params.film, params.q, params.limit) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
