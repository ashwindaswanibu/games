import "server-only";
import { viewReferencesAsset, type AssetMime } from "@/core/assets";
import { parsePuzzleDate, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { PlayView } from "@/core/view";
import { canPlay, getGame } from "@/games/registry";
import { getPlayView } from "./plays";
import { db } from "./supabase/admin";

/** Where an asset belongs; enough to decide who may see it. */
export interface AssetLocation {
  id: string;
  gameId: string;
  puzzleDate: string;
}

export interface AssetViewer {
  id: string;
  is_admin: boolean;
}

/**
 * The asset access rule (see `src/core/assets.ts`): the viewer may see an asset exactly when its id
 * appears in their current play view of the asset's game and date. Games the viewer can't open
 * (unknown, or still in testing for a non-admin) and plays they haven't started grant nothing.
 */
export async function canViewAsset(params: {
  viewer: AssetViewer;
  asset: AssetLocation;
  loadView: (game: AnyGame, date: PuzzleDate) => Promise<PlayView | null>;
}): Promise<boolean> {
  const { viewer, asset, loadView } = params;
  const game = getGame(asset.gameId);
  if (!game || !canPlay(game, viewer.is_admin)) return false;
  const view = await loadView(game, parsePuzzleDate(asset.puzzleDate));
  return view !== null && viewReferencesAsset(view, asset.id);
}

const HEX_BYTEA = /^\\x(?:[0-9a-f]{2})*$/i;

/** PostgREST returns bytea as "\x…" hex text. */
export function decodeBytea(value: string): Buffer {
  if (!HEX_BYTEA.test(value)) throw new Error("Unexpected bytea encoding");
  return Buffer.from(value.slice(2), "hex");
}

/**
 * The asset's bytes if `viewer` may see it, else null (also for ids that don't exist, so the two
 * cases are indistinguishable to the caller). The bytes are only read after authorization.
 */
export async function loadAssetForViewer(viewer: AssetViewer, assetId: string): Promise<{ mime: AssetMime; bytes: Buffer } | null> {
  const { data: meta, error } = await db().from("puzzle_assets").select("id, game_id, puzzle_date, mime").eq("id", assetId).maybeSingle();
  if (error) throw new Error(`Failed to load asset: ${error.message}`);
  if (!meta) return null;

  const allowed = await canViewAsset({
    viewer,
    asset: { id: meta.id, gameId: meta.game_id, puzzleDate: meta.puzzle_date },
    loadView: (game, date) => getPlayView(viewer.id, game, date),
  });
  if (!allowed) return null;

  const { data, error: bytesError } = await db().from("puzzle_assets").select("bytes").eq("id", assetId).single();
  if (bytesError) throw new Error(`Failed to load asset bytes: ${bytesError.message}`);
  return { mime: meta.mime, bytes: decodeBytea(data.bytes) };
}
