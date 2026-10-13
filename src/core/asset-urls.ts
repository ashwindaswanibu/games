/**
 * Where puzzle images are fetched from, and the shapes the browser handles them by (see `assets.ts`
 * for the access rule and the schemas). Kept apart from the schemas so a page that only shows
 * images (the home, the sealed-image store) doesn't ship the validation library with them.
 */

/** How games reference an image (`assetRefSchema` checks one). Width/height let the UI reserve the right box before it loads. */
export interface AssetRef {
  id: string;
  width: number;
  height: number;
}

export function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`;
}

/** The encrypted copy of an asset; anyone may fetch it, only a key from a play view opens it. */
export function sealedAssetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}/sealed`;
}

/** A play view's sealed images (see `assets.ts`). Keys are base64url AES-256 keys. */
export interface SealedAssets {
  /** Every image id of the puzzle, for downloading sealed ahead of time. */
  preload: string[];
  /** Asset id → key, for the ids the view shows. */
  keys: Record<string, string>;
}

/** How a sealed asset is laid out: a random 12-byte AES-GCM nonce, then the ciphertext and its 16-byte tag. */
export const SEALED_NONCE_BYTES = 12;
