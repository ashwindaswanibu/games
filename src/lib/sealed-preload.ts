import { preload } from "react-dom";
import { sealedAssetUrl } from "@/core/asset-urls";

/**
 * Starts a page's first sealed pictures downloading from its HTML, before any script has run (the
 * rest follow once the page is live: `receiveSealed` in `sealed-assets.ts`). Called while rendering,
 * on the server or in the browser. The request is made as the page's own `fetch()` will make it
 * (same-origin CORS), so that fetch picks up this download instead of starting a second; keep it to
 * the one or two pictures shown first, so they don't compete with each other.
 */
export function preloadSealed(ids: readonly string[]): void {
  for (const id of ids) preload(sealedAssetUrl(id), { as: "fetch", crossOrigin: "anonymous", fetchPriority: "high" });
}
