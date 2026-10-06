import { describe, expect, it } from "vitest";
import { parsePuzzleDate } from "@/core/day";
import { BUCKET_IDS, GAME_ID_PATTERN } from "@/core/game";
import { createRng } from "@/core/random";
import { BUCKETS, groupByBucket } from "./buckets";
import { GAMES } from "./registry";
import { GAME_SERVERS } from "./server-registry";

// Each game has its own play route, so the browser loads only that game's UI (see play-screen.tsx).
// Pages import React client components; read them from source instead of importing them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
const playDir = new URL("../app/(app)/play/", import.meta.url);
const playRoutes = readdirSync(playDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name);
const pageSource = (id: string) => readFileSync(new URL(`${id}/page.tsx`, playDir), "utf8");

describe("game registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(GAME_ID_PATTERN);
  });

  it("has a play route for every game and nothing extra", () => {
    expect([...playRoutes].sort()).toEqual(GAMES.map((g) => g.id).sort());
  });

  it.each(GAMES.map((g) => [g.id] as const))("%s's play route renders its own UI and no other game's", (id) => {
    expect(existsSync(new URL(`${id}/page.tsx`, playDir))).toBe(true);
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
});
