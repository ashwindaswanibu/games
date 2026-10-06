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
