import { describe, expect, it } from "vitest";
import { parsePuzzleDate } from "@/core/day";
import { BUCKET_IDS, GAME_ID_PATTERN, type AnyGame } from "@/core/game";
import { createRng } from "@/core/random";
import { BUCKETS, groupByBucket } from "./buckets";
import { FULL_SCREEN_IDS, GAMES } from "./registry";
import { GAME_SERVERS } from "./server-registry";

// Each game has its own play route, so the browser loads only that game's UI (see play-screen.tsx).
// Pages import React client components; read them from source instead of importing them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
// Play routes live in two route groups: inside the app's chrome, or full screen (`(immersive)`).
const playDirs = ["../app/(app)/play/", "../app/(immersive)/play/"].map((dir) => new URL(dir, import.meta.url));
const routesIn = (dir: URL) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
const playRoutes = playDirs.flatMap(routesIn);
const immersiveRoutes = routesIn(playDirs[1]);
const pagePath = (id: string) => playDirs.map((dir) => new URL(`${id}/page.tsx`, dir)).find(existsSync);
const pageSource = (id: string) => readFileSync(pagePath(id)!, "utf8");

describe("game registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(GAME_ID_PATTERN);
  });

  it("has one play route for every game and nothing extra", () => {
    // Sorting keeps duplicates, so a game routed in both groups (a build error) fails here too.
    expect([...playRoutes].sort()).toEqual(GAMES.map((g) => g.id).sort());
  });

  it.each(GAMES.map((g) => [g.id] as const))("%s's play route renders its own UI and no other game's", (id) => {
    expect(pagePath(id)).toBeDefined();
    const source = pageSource(id);
    expect(source).toContain(`const GAME_ID = "${id}";`);
    const imported = [...source.matchAll(/from "@\/games\/([a-z0-9-]+)\//g)].map((m) => m[1]);
    expect(imported).toEqual([id]);
  });

  it("puts every game in a known bucket", () => {
    expect(BUCKETS.map((b) => b.id)).toEqual([...BUCKET_IDS]);
    for (const game of GAMES) expect(BUCKET_IDS).toContain(game.bucket);
    expect(groupByBucket(GAMES).flatMap((g) => g.games)).toHaveLength(GAMES.length);
  });

  it("lists exactly the full-screen play routes in FULL_SCREEN_IDS", () => {
    expect([...FULL_SCREEN_IDS].sort()).toEqual([...immersiveRoutes].sort());
  });

  it("has a server module exactly for the games that resolve moves", () => {
    const serverIds = GAME_SERVERS.map((s) => s.gameId);
    expect(new Set(serverIds).size).toBe(serverIds.length);
    const resolving = GAMES.filter((g) => g.resolvedMoveSchema).map((g) => g.id);
    expect([...serverIds].sort()).toEqual(resolving.sort());
  });

  describe.each(GAMES.filter((g) => g.generate).map((g) => [g.id, g] as const))("%s generator", (_id, game) => {
    const date = parsePuzzleDate("2026-10-05");

    it("is deterministic and produces schema-valid output", () => {
      const a = game.generate!({ date, rng: createRng([1, 2, 3, 4]) });
      const b = game.generate!({ date, rng: createRng([1, 2, 3, 4]) });
      expect(a).toEqual(b);
      expect(game.puzzleSchema.safeParse(a.puzzle).success).toBe(true);
      expect(game.solutionSchema.safeParse(a.solution).success).toBe(true);
    });

    it("survives JSON round-tripping (puzzles and state are stored as jsonb)", () => {
      const { puzzle } = game.generate!({ date, rng: createRng([4, 3, 2, 1]) });
      expect(JSON.parse(JSON.stringify(puzzle))).toEqual(puzzle);
      const state = game.initialState(puzzle);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });
  });

  describe.each(GAMES.map((g) => [g.id, g] as const))("%s on the home", (_id, game) => {
    it("says how the home draws it", () => {
      expect(game.home).toBeDefined();
      const form = game.home!.form;
      switch (form.kind) {
        case "slots":
        case "frames":
          expect(Number.isInteger(form.count) && form.count > 0).toBe(true);
          break;
        case "row":
          expect(form.count === null || (Number.isInteger(form.count) && form.count > 0)).toBe(true);
          break;
        case "chain":
          expect(Object.keys(form)).toEqual(["kind"]); // par is today's, filled in by the server
          break;
      }
    });

    it("has one slot per attempt: the form's count is the maximum in its own lost label (\"X/7\")", () => {
      const form = game.home!.form;
      if (form.kind === "chain" || (form.kind === "row" && form.count === null)) return; // no fixed maximum
      expect(lostLabel(game)).toBe(`X/${form.count}`);
    });

    it("writes a result line from marks alone, without throwing", () => {
      for (const outcome of ["won", "lost"] as const) {
        const line = game.home!.line({ outcome, label: "", marks: [], par: null });
        expect(line === null || (typeof line === "string" && line.length > 0)).toBe(true);
      }
    });
  });
});

/**
 * The label a game gives a play lost before any attempt: its native result with the maximum
 * attempts ("X/7"). Generated games use a real puzzle; curated games' scoring of an empty play
 * needs no puzzle (each game's own tests play real losses to the end, too).
 */
function lostLabel(game: AnyGame): string {
  const date = parsePuzzleDate("2026-10-05");
  const generated = game.generate?.({ date, rng: createRng([7, 7, 7, 7]) });
  const puzzle = generated?.puzzle;
  const state = game.initialState(puzzle);
  return game.score({ puzzle, solution: generated?.solution, state, outcome: "lost", elapsedMs: 0 }).label;
}
