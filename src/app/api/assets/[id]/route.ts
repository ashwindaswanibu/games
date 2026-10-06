import type { NextRequest } from "next/server";
import { assetIdSchema } from "@/core/assets";
import { authorizeAsset, loadAssetBytes } from "@/server/assets";
import { guardRequest, jsonError } from "@/server/http";

const CACHE_HEADERS = {
  // Per-player authorization: browsers may keep it (ids are immutable), shared caches may not.
  "Cache-Control": "private, max-age=604800, immutable",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** True when `If-None-Match` names `etag` (or is `*`); weak and strong forms compare equal. */
function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((tag) => {
    const t = tag.trim().replace(/^W\//, "");
    return t === "*" || t === etag;
  });
}

/**
 * A puzzle image. Served only to a signed-in player whose current play view of the asset's game
 * and date contains the asset id (see `src/core/assets.ts`), within the per-player asset rate
 * limits. Unknown and forbidden ids both get a 404 so ids can't be probed. Asset ids are immutable,
 * so the id is the ETag: a revalidation is still authorized but costs no image bytes (304).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/assets/[id]">) {
  const guard = await guardRequest({ buckets: ["assets", "assetsDaily"], signedOutMessage: "Sign in to view this image." });
  if (!guard.ok) return guard.response;
  const { profile } = guard;

  const { id } = await ctx.params;
  const parsed = assetIdSchema.safeParse(id);
  if (!parsed.success) return jsonError(404, "Not found.");

  const asset = await authorizeAsset(profile, parsed.data.toLowerCase());
  if (!asset) return jsonError(404, "Not found.");

  const etag = `"${asset.id}"`;
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ...CACHE_HEADERS, ETag: etag } });
  }

  const bytes = await loadAssetBytes(asset.id);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...CACHE_HEADERS,
      ETag: etag,
      "Content-Type": asset.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
    },
  });
}
