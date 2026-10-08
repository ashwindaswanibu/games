import { assetIdSchema } from "@/core/assets";
import { sealAsset } from "@/server/asset-seal";
import { decodeBytea } from "@/server/assets";
import { db } from "@/server/supabase/admin";

/**
 * A puzzle image, sealed (see `src/core/assets.ts`): anyone may fetch it and every cache may keep
 * it, because only a key from a play view opens it. So no sign-in, no rate limit and no proxy (see
 * `src/proxy.ts`): a CDN hit never reaches this code, and a miss is one read. The sealed bytes of an
 * id never change in meaning (ids are immutable), so a year's caching is safe.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/assets/[id]/sealed">) {
  const { id } = await ctx.params;
  const parsed = assetIdSchema.safeParse(id);
  if (!parsed.success) return notFound();
  const assetId = parsed.data.toLowerCase();

  const { data, error } = await db().from("puzzle_assets").select("bytes, mime").eq("id", assetId).maybeSingle();
  if (error) throw new Error(`Failed to load asset: ${error.message}`);
  if (!data) return notFound();

  const sealed = sealAsset(assetId, decodeBytea(data.bytes));
  return new Response(new Uint8Array(sealed), {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Asset-Type": data.mime,
      "Content-Length": String(sealed.length),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

/** Unknown ids: briefly cacheable, so repeats of the same miss don't each cost a read. */
function notFound() {
  return new Response(JSON.stringify({ error: "Not found." }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
