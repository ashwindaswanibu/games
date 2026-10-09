import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { portraitsResponseSchema } from "@/games/_movies/schemas";
import { canUseMoviesCatalog } from "@/server/catalog";
import { guardRequest, jsonError } from "@/server/http";
import { loadPortraits, MAX_PORTRAIT_IDS } from "@/server/portraits";

/**
 * Which of some people have a face, where it loads from, and its photo's credit:
 * GET /api/catalog/portraits?ids=12,34 → { portraits: Portrait[] }. Signed-in players who can open
 * a Movies game, rate limited. The faces themselves load from /api/catalog/portraits/<id>.
 */
export async function GET(request: NextRequest) {
  const guard = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to see portraits.", allowed: canUseMoviesCatalog });
  if (!guard.ok) return guard.response;

  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw.split(",").filter(Boolean).map(Number);
  if (ids.length === 0 || ids.length > MAX_PORTRAIT_IDS || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return jsonError(400, `ids must be 1–${MAX_PORTRAIT_IDS} person ids, comma-separated.`);
  }
  const body: z.infer<typeof portraitsResponseSchema> = { portraits: await loadPortraits(ids) };
  return Response.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
}
