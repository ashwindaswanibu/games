import "server-only";
import type { AssetRef } from "@/core/assets";
import { formatPuzzleDate, nextRollover, startOfDay, today, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { PlayView } from "@/core/view";
import type { HomeModel, HomeTile, TileMaterial, TileResult } from "@/components/home-field/model";
import type { DegreesPuzzle, DegreesSolution } from "@/games/degrees/schema";
import { movesUsed, type DegreesState } from "@/games/degrees/logic";
import { LEVEL_COUNT } from "@/games/fade-to-color/logic";
import { describeGrid, parseGrid } from "@/games/fade-to-color/theater/grid";
import { gapOf, type LexiconPuzzle, type LexiconReveal, type LexiconState } from "@/games/lexicon/logic";
import { getBucket } from "@/games/buckets";
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

/**
 * The games the home features, in order: the ones that are ready. Others play from their pages
 * (Frame by Frame waits off the home until its frames are worked on).
 */
const HOME_GAME_IDS = ["fade-to-color", "degrees", "lexicon"];

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
          title: game.name,
          titleParts: tile.titleParts ?? [{ text: game.name }],
          tagline: game.tagline,
          sub: tile.sub,
          cta: state === "playing" ? { label: tile.progress, continuing: true } : { label: tile.start, continuing: false },
          accent: tile.light.accent,
          onAccent: tile.light.on,
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
    dateShort: formatPuzzleDate(date).toUpperCase(),
    rolloverAt: nextRollover().toISOString(),
    dayStartsAt: startOfDay(date).toISOString(),
    won,
    max: tiles.length * 100,
    tiles,
    categories: [...new Set(tiles.map((t) => t.group))].map((id) => {
      const bucket = getBucket(id as AnyGame["bucket"]);
      return { id: bucket.id, name: bucket.name, tagline: bucket.tagline };
    }),
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
  /** The wordmark's parts, as the game's own header sets them (the plain name if absent). */
  titleParts?: { text: string; italic?: boolean }[];
  /** The game's own first button ("Roll film"), for a game not yet started. */
  start: string;
  /** Where a started play is, in the game's words ("Reel 4"), for its button. */
  progress: string;
  /** The game's light, "r g b" (null: the browser samples it from the picture), and text on it. */
  light: { accent: string | null; on: string };
  material: TileMaterial;
  result: TileResult | null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

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
      const reel = Math.min(LEVEL_COUNT, (s?.turns.length ?? 0) + 1);
      const playing = view?.status === "in_progress";
      return {
        sub: "TEN REELS",
        titleParts: [{ text: "Movie" }, { text: "Barcode", italic: true }],
        start: "Roll film",
        progress: `Reel ${reel}`,
        light: { accent: null, on: "#0b0b0c" },
        // The reel's edge print, as the game prints it (theater.tsx).
        material: { kind: "light", image: view && view.status !== "in_progress" ? p.first : shown, edge: playing ? `REEL ${pad2(reel)} ◂ ${LEVEL_COUNT}` : `LEADER ◂ ${LEVEL_COUNT}` },
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
      const moves = s ? movesUsed(s) : 0;
      const line = s?.gaveUp ? "Gave up" : moves <= p.par ? `At par · ${moves} moves` : `${moves} moves · par ${p.par}`;
      return {
        sub: `PAR ${p.par}`,
        titleParts: [{ text: "Degrees" }, { text: "of", italic: true }, { text: "Separation" }],
        start: "Start linking",
        progress: `Move ${(s ? movesUsed(s) : 0) + 1}`,
        light: { accent: "236 178 92", on: "#0b0b0c" },
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
        sub: "SIX FRAMES",
        start: "Play",
        progress: `Frame ${seen.length}`,
        light: { accent: "239 233 223", on: "#050506" },
        material: { kind: "frames", image: seen.at(-1)!, total: 6, shown: seen.length },
        result: reveal
          ? { title: reveal.film.title, line: won ? `Named on frame ${seen.length}` : "Not named in six frames", score, image: seen.at(-1)!, chain: null, frames: seen }
          : null,
      };
    }
    case "lexicon": {
      const p = puzzle as LexiconPuzzle;
      const s = view?.state as LexiconState | undefined;
      const reveal = view?.reveal as LexiconReveal | null | undefined;
      const guesses = s?.guesses.length ?? 0;
      // The viewer's own guesses: the gap they've closed to and a ribbon at each page they tried.
      const gap = s ? gapOf(p, s) : { low: -1, high: p.total };
      const ribbons = (s?.guesses ?? []).filter((g) => g.side !== "found").map((g) => ({ page: g.page, edge: g.page === gap.low || g.page === gap.high }));
      return {
        sub: "NINE LETTERS",
        start: "Start guessing",
        progress: `Guess ${guesses + 1}`,
        light: { accent: "190 48 34", on: "#f6ecdc" },
        material: { kind: "letters", letters: p.letters, length: p.length, total: p.total, gap: { low: gap.low, high: gap.high }, ribbons },
        result: reveal
          ? { title: reveal.answer, line: view?.status === "won" ? `Found on guess ${guesses}` : "Gave up", score, image: null, chain: null, frames: null }
          : null,
      };
    }
    default:
      return {
        sub: "",
        start: "Play",
        progress: "Continue",
        light: { accent: "239 233 223", on: "#050506" },
        material: { kind: "word", headline: game.name },
        result: view?.result ? { title: game.name, line: view.result.label, score, image: null, chain: null, frames: null } : null,
      };
  }
}
