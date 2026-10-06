import { describe, expect, it } from "vitest";
import { parsePuzzleDate } from "@/core/day";
import { BUCKET_IDS, GAME_ID_PATTERN } from "@/core/game";
import { createRng } from "@/core/random";
import { BUCKETS, groupByBucket } from "./buckets";
import { GAMES } from "./registry";
import { GAME_SERVERS } from "./server-registry";

// The UI map imports React client components; read its keys from source instead of importing it.
import { readFileSync } from "node:fs";
const uiSource = readFileSync(new URL("./ui.ts", import.meta.url), "utf8");
const uiIds = [...uiSource.matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]);

describe("game registry", () => {
  it("has unique, well-formed ids", () => {
    const ids = GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(GAME_ID_PATTERN);
  });

  it("has a UI registered for every game and nothing extra", () => {
    expect([...uiIds].sort()).toEqual(GAMES.map((g) => g.id).sort());
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
