import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyGame } from "@/core/game";

const A = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  /** Game id → what loading its puzzle does. */
  puzzles: new Map<string, () => unknown>(),
  /** Everyone's plays today. */
  dayPlays: [] as unknown[],
  reads: [] as string[],
}));

vi.mock("./asset-seal", () => ({ assetKey: (id: string) => `key-${id}`, sealedAssets: () => ({ preload: [], keys: {} }) }));
vi.mock("./plays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plays")>();
  return {
    loadDayPlays: async () => {
      mocks.reads.push("plays");
      return mocks.dayPlays;
    },
    loadPlayers: async () => {
      mocks.reads.push("players");
      return [
        { id: "viewer", username: "viewer", display_name: "Viewer" },
        { id: "ana", username: "ana", display_name: "Ana Lima" },
        { id: "ben", username: "ben", display_name: "Ben" },
      ];
    },
    friendsResultsFrom: actual.friendsResultsFrom,
    toView: actual.toView,
  };
});
vi.mock("./supabase/admin", () => ({ db: () => ({}) }));
vi.mock("@/games/server-registry", () => ({ getGameServer: () => undefined }));
vi.mock("./puzzles", () => {
  class PuzzleUnavailableError extends Error {}
  return {
    PuzzleUnavailableError,
    getOrCreatePuzzle: async (game: AnyGame) => {
      const load = mocks.puzzles.get(game.id);
      if (!load) throw new PuzzleUnavailableError(game.id);
      return { puzzle: load(), solution: {} };
    },
  };
});

const { getHome } = await import("./home");

const viewer = { id: "viewer", username: "viewer", is_admin: true };

beforeEach(() => {
  mocks.dayPlays = [];
  mocks.reads = [];
  mocks.puzzles = new Map<string, () => unknown>([
    ["fade-to-color", () => ({ first: { id: A, width: 600, height: 200 } })],
    ["degrees", () => ({ start: { id: 1, name: "A" }, end: { id: 2, name: "B" }, par: 3 })],
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("getHome: one bad game never takes down Today", () => {
  it("drops the tile of a game whose puzzle can't be read, says why in the log, and keeps the rest", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.puzzles.set("degrees", () => {
      throw new Error("stored puzzle no longer matches its schema");
    });
    const home = await getHome(viewer);
    expect(home.tiles.map((t) => t.id)).toEqual(["fade-to-color"]);
    expect(home.max).toBe(100);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain("degrees");
  });

  it("leaves out a game with no puzzle today without logging an error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const home = await getHome(viewer);
    expect(home.tiles.map((t) => t.id)).toEqual(["fade-to-color", "degrees"]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("still opens with every game failing: an empty day, not an error page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const id of ["fade-to-color", "degrees", "lexicon"]) {
      mocks.puzzles.set(id, () => {
        throw new Error("database unavailable");
      });
    }
    const home = await getHome(viewer);
    expect(home.tiles).toEqual([]);
    expect(home.sealed.preload).toEqual([]);
  });
});

describe("getHome reads the day once", () => {
  const play = (user_id: string, game_id: string, status: string, score: number | null) => ({
    user_id,
    game_id,
    puzzle_date: "2026-10-13",
    state: { links: [], gaveUp: status === "lost", hints: [], undos: 0 },
    status,
    score,
    result_label: score === null ? null : `${score}`,
    share_grid: score === null ? null : "🎞",
    version: 3,
    started_at: "2026-10-13T12:00:00Z",
    finished_at: score === null ? null : "2026-10-13T12:05:00Z",
    updated_at: "2026-10-13T12:05:00Z",
  });

  it("takes the viewer's play, the count and friends' results from one read of everyone's plays", async () => {
    mocks.dayPlays = [play("viewer", "degrees", "lost", 0), play("ana", "degrees", "won", 90), play("ben", "degrees", "in_progress", null), play("ben", "fade-to-color", "won", 70)];
    const home = await getHome(viewer);
    expect(mocks.reads.sort()).toEqual(["players", "plays"]);
    const degrees = home.tiles.find((t) => t.id === "degrees")!;
    expect(degrees.state).toBe("finished");
    expect(degrees.friends).toEqual({ finished: 1, marks: [{ name: "ANA", score: 90 }] });
    const film = home.tiles.find((t) => t.id === "fade-to-color")!;
    // Not finished by the viewer: a count, no names.
    expect(film.state).toBe("unplayed");
    expect(film.friends).toEqual({ finished: 1, marks: null });
  });
});
