import "server-only";
import type { AssetRef } from "@/core/assets";
import { formatPuzzleDate, nextRollover, startOfDay, today, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { PlayView } from "@/core/view";
import type { HomeModel, HomeTile, TileMaterial, TileResult } from "@/components/home-field/model";
import type { DegreesPuzzle, DegreesSolution } from "@/games/degrees/schema";
import type { DegreesState } from "@/games/degrees/logic";
import { describeGrid, parseGrid } from "@/games/fade-to-color/theater/grid";
import { canPlay, getGame, visibleGames } from "@/games/registry";
import { assetKey } from "./asset-seal";
import type { ProfileRow } from "./database.types";
import { finishedCounts, getFriendsResults, loadPlaysForDay, toView } from "./plays";
import { getOrCreatePuzzle, PuzzleUnavailableError } from "./puzzles";

/**
 * The home's model (src/components/home-field/model.ts): today's games the viewer can play, each
 * as its material, its state, the result once finished, and the other players who finished it.
 *
 * Spoiler wall: a tile shows only what the viewer's own view of the game would (the puzzle's
 * opening picture, what they've earned, the reveal once they've finished), so its pictures' keys
 * are exactly those (src/core/assets.ts). Other players are a count until the viewer finishes;
 * then names and scores (`getFriendsResults` decides).
 */

/** The games the home features, in order: the ones that are ready. Others play from their pages. */
const HOME_GAME_IDS = ["fade-to-color", "degrees", "frame-by-frame"];

export async function getHome(profile: Pick<ProfileRow, "id" | "username" | "is_admin">): Promise<HomeModel> {
  const date = today();
  const featured = HOME_GAME_IDS.map(getGame).filter((g): g is AnyGame => g !== undefined && canPlay(g, profile.is_admin));
  // A player without the featured games (they're still in testing) gets the games they can play.
  const games = featured.length > 0 ? featured : visibleGames(profile.is_admin);
  const [plays, counts] = await Promise.all([loadPlaysForDay(profile.id, date), finishedCounts(date)]);

  const keys: Record<string, string> = {};
  const show = (ref: AssetRef | null | undefined) => {
    if (ref) keys[ref.id.toLowerCase()] = assetKey(ref.id);
    return ref ?? null;
  };

  const tiles = (
    await Promise.all(
      games.map(async (game): Promise<HomeTile | null> => {
        let loaded;
        try {
          loaded = await getOrCreatePuzzle(game, date);
        } catch (error) {
          if (error instanceof PuzzleUnavailableError) return null; // not scheduled today: no tile
          throw error;
        }
        const row = plays.get(game.id);
        const view = row ? toView(game, row, loaded) : null;
        const state = !view ? "unplayed" : view.status === "in_progress" ? "playing" : "finished";
        const others = Math.max(0, (counts.get(game.id) ?? 0) - (state === "finished" ? 1 : 0));
        const friends = state === "finished" ? await friendMarks(profile.id, game, date) : null;
        const tile = describe(game, loaded.puzzle, view, show);
        return {
          id: game.id,
          group: game.bucket,
          name: game.name.toUpperCase(),
          sub: tile.sub,
          href: `/play/${game.id}`,
          state,
          material: tile.material,
          result: state === "finished" ? tile.result : null,
          friends: { finished: others, marks: friends },
          label: `${game.name}: ${state === "finished" ? `${tile.result?.line ?? "done"}, ${view?.result?.score ?? 0} points` : state === "playing" ? "in progress" : "not played yet"}`,
        };
      }),
    )
  ).filter((t): t is HomeTile => t !== null);

  const won = tiles.reduce((sum, t) => sum + (t.result?.score ?? 0), 0);
  return {
    date,
    dateLabel: formatPuzzleDate(date, { weekday: "long", day: "numeric", month: "long" }).replace(",", " ·").toUpperCase(),
    rolloverAt: nextRollover().toISOString(),
    dayStartsAt: startOfDay(date).toISOString(),
    won,
    max: tiles.length * 100,
    tiles,
    sealed: { preload: Object.keys(keys), keys },
    user: { username: profile.username, isAdmin: profile.is_admin },
  };
}

async function friendMarks(viewerId: string, game: AnyGame, date: PuzzleDate) {
  const results = (await getFriendsResults(viewerId, game, date)) ?? [];
  return results
    .filter((r) => r.profile.id !== viewerId && r.status !== "not_started" && r.status !== "in_progress" && r.score !== null)
    .map((r) => ({ name: r.profile.display_name.split(" ")[0]!.toUpperCase(), score: r.score! }));
}

type Show = (ref: AssetRef | null | undefined) => AssetRef | null;
interface Described {
  sub: string;
  material: TileMaterial;
  result: TileResult | null;
}

/** Each game's tile: its material from today's puzzle and the viewer's play, and its result. */
function describe(game: AnyGame, puzzle: unknown, view: PlayView | null, show: Show): Described {
  const score = view?.result?.score ?? 0;
  switch (game.id) {
    case "fade-to-color": {
      const p = puzzle as { first: AssetRef };
      const s = view?.state as { turns: unknown[]; unlocked: AssetRef[] } | undefined;
      const reveal = view?.reveal as { film: { title: string } } | null | undefined;
      // The latest reel the viewer has seen: the strip of light, or where they are.
      const shown = show(s?.unlocked.at(-1) ?? p.first)!;
      show(p.first);
      const reel = Math.min(10, (s?.turns.length ?? 0) + 1);
      return {
        sub: view ? (view.status === "in_progress" ? `REEL ${reel} OF 10` : "TEN REELS") : "TEN REELS · 100",
        material: { kind: "light", image: view && view.status !== "in_progress" ? p.first : shown },
        result: reveal ? { title: reveal.film.title, line: view?.result ? describeGrid(parseGrid(view.result.shareGrid)) : "", score, image: p.first, chain: null, frames: null } : null,
      };
    }
    case "degrees": {
      const p = puzzle as DegreesPuzzle;
      const s = view?.state as DegreesState | undefined;
      const links = s?.links ?? [];
      const reveal = view?.reveal as DegreesSolution | null | undefined;
      // The viewer's chain if they reached the end, else the shortest one (once the play is over).
      const finishedChain = links.length > 0 && links.at(-1)!.person.id === p.end.id ? links : (reveal?.path ?? []);
      const line = s?.gaveUp ? "Gave up" : links.length <= p.par ? `At par · ${links.length} links` : `${links.length} links · par ${p.par}`;
      return {
        sub: view?.status === "in_progress" ? `${links.length} ${links.length === 1 ? "LINK" : "LINKS"} SO FAR · PAR ${p.par}` : `PAR ${p.par} · 100`,
        material: { kind: "thread", from: p.start.name, to: p.end.name, knots: p.par, drawn: links.length },
        result: view && view.status !== "in_progress"
          ? { title: "", line, score, image: null, chain: { people: [p.start.name, ...finishedChain.map((l) => l.person.name)], films: finishedChain.map((l) => l.film.title) }, frames: null }
          : null,
      };
    }
    case "frame-by-frame": {
      const p = puzzle as { first: AssetRef };
      const s = view?.state as { turns: unknown[]; unlocked: AssetRef[] } | undefined;
      const reveal = view?.reveal as { film: { title: string }; frames: AssetRef[] } | null | undefined;
      const seen = [p.first, ...(s?.unlocked ?? [])];
      for (const f of seen) show(f);
      const won = view?.status === "won";
      return {
        sub: view?.status === "in_progress" ? `FRAME ${seen.length} OF 6` : "SIX FRAMES · 100",
        material: { kind: "frames", image: seen.at(-1)!, total: 6, shown: seen.length },
        result: reveal
          ? { title: reveal.film.title, line: won ? `Named on frame ${seen.length}` : "Not named in six frames", score, image: seen.at(-1)!, chain: null, frames: seen }
          : null,
      };
    }
    default:
      return {
        sub: game.tagline.toUpperCase(),
        material: { kind: "word", headline: game.name },
        result: view?.result ? { title: game.name, line: view.result.label, score, image: null, chain: null, frames: null } : null,
      };
  }
}
