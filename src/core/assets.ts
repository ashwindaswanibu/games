import { z } from "zod";

/**
 * Puzzle assets are images stored server-side (`puzzle_assets`) and served by
 * `GET /api/assets/[id]`. A game refers to an asset by its id, usually through an `AssetRef`
 * placed in its puzzle, solution, state or reveal.
 *
 * The access rule is deliberately game-agnostic: **an asset is served to a player exactly when its
 * id appears in that player's current play view** (puzzle, state or reveal) for the asset's game
 * and date. So a game controls visibility simply by where it puts ids:
 *   - shown from the start      → in the puzzle
 *   - unlocked during play      → in the solution, copied into the state by `applyMove` when earned
 *   - shown once the play ends  → in the solution, surfaced through `reveal`
 * An id that is only in the solution can never be fetched.
 *
 * Images also travel **sealed** (`GET /api/assets/[id]/sealed`): AES-GCM ciphertext anyone may
 * fetch and every cache may keep, under a key only the server can derive. A play view lists every
 * image id of its puzzle in `sealed.preload`, so the browser downloads them all as the game opens,
 * and carries in `sealed.keys` the key of exactly the ids the rule above would serve. Earning a
 * level then shows it at once: its key comes back with the move. `GET /api/assets/[id]` stays the
 * fallback for browsers without WebCrypto (plain-http pages).
 */

export const ASSET_MIMES = ["image/webp", "image/jpeg", "image/png", "image/avif"] as const;
export type AssetMime = (typeof ASSET_MIMES)[number];

export const assetIdSchema = z.uuid();

/** How games reference an image. Width/height let the UI reserve the right box before it loads. */
export const assetRefSchema = z.object({
  id: assetIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`;
}

/** The encrypted copy of an asset; anyone may fetch it, only a key from a play view opens it. */
export function sealedAssetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}/sealed`;
}

/** A play view's sealed images (see the module comment). Keys are base64url AES-256 keys. */
export interface SealedAssets {
  /** Every image id of the puzzle, for downloading sealed ahead of time. */
  preload: string[];
  /** Asset id → key, for the ids the view shows. */
  keys: Record<string, string>;
}

/** How a sealed asset is laid out: a random 12-byte AES-GCM nonce, then the ciphertext and its 16-byte tag. */
export const SEALED_NONCE_BYTES = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Views are small JSON documents; this only guards against pathological nesting.
const MAX_DEPTH = 32;

/** Every uuid-shaped string anywhere inside a JSON-like value, lowercased. */
export function referencedAssetIds(value: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error("Value is nested too deeply to scan for asset ids");
    if (typeof node === "string") {
      if (UUID.test(node)) found.add(node.toLowerCase());
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
    } else if (node !== null && typeof node === "object") {
      for (const item of Object.values(node)) walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return found;
}

/** The parts of a play view the player can see. `result` holds no asset ids by construction. */
export interface VisibleView {
  puzzle: unknown;
  state: unknown;
  reveal: unknown;
}

/** The asset access rule (see the module comment). */
export function viewReferencesAsset(view: VisibleView, assetId: string): boolean {
  const id = assetId.toLowerCase();
  return [view.puzzle, view.state, view.reveal].some((part) => referencedAssetIds(part).has(id));
}
