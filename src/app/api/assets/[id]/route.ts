import type { NextRequest } from "next/server";
import { assetIdSchema } from "@/core/assets";
import { loadAssetForViewer } from "@/server/assets";
import { guardRequest, jsonError } from "@/server/http";

/**
 * A puzzle image. Served only to a signed-in player whose current play view of the asset's game
 * and date contains the asset id (see `src/core/assets.ts`), within the per-player asset rate
 * limit. Unknown and forbidden ids both get a 404 so ids can't be probed.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/assets/[id]">) {
  const guard = await guardRequest({ bucket: "assets", signedOutMessage: "Sign in to view this image." });
  if (!guard.ok) return guard.response;
  const { profile } = guard;

  const { id } = await ctx.params;
  const parsed = assetIdSchema.safeParse(id);
  if (!parsed.success) return jsonError(404, "Not found.");

  const asset = await loadAssetForViewer(profile, parsed.data.toLowerCase());
  if (!asset) return jsonError(404, "Not found.");

  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(asset.bytes.length),
      // Per-player authorization: browsers may keep it (ids are immutable), shared caches may not.
      "Cache-Control": "private, max-age=604800, immutable",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
