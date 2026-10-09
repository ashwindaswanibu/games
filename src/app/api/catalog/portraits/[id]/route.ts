import { portraitBytes } from "@/server/portraits";

/**
 * One person's face, WebP: GET /api/catalog/portraits/12?v=3fa9c1d07e2b. A face says no more than
 * the name beside it, so no sign-in and no proxy: with the current version in the URL, browsers and
 * the CDN keep it for good (a new photo gets a new version, so a new URL). Without it, or with an
 * old one, it's still served, but only cached briefly.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/catalog/portraits/[id]">) {
  const { id } = await params;
  const personId = Number(id);
  if (!/^[1-9][0-9]{0,9}$/.test(id) || !Number.isSafeInteger(personId)) return new Response("Not found", { status: 404 });

  const portrait = await portraitBytes(personId);
  if (!portrait) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
  }
  const current = new URL(request.url).searchParams.get("v") === portrait.version;
  return new Response(new Uint8Array(portrait.bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": current ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
