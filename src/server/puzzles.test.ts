import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, today } from "@/core/day";
import type { AnyGame } from "@/core/game";

const mocks = vi.hoisted(() => ({
  /** What the next select of a stored puzzle answers. */
  stored: { data: { payload: { min: 1, max: 9, maxGuesses: 3 }, solution: { secret: 4 } } as unknown, error: null as null | { message: string } },
  selects: 0,
}));

vi.mock("./env", () => ({ serverEnv: () => ({ PUZZLE_SEED_SECRET: "test" }) }));
vi.mock("./supabase/admin", () => ({
  db: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        maybeSingle: async () => {
          mocks.selects++;
          await Promise.resolve();
          return mocks.stored;
        },
      };
      return query;
    },
  }),
}));

const { getOrCreatePuzzle, PuzzleUnavailableError } = await import("./puzzles");
const { numberHunt } = await import("@/games/number-hunt/logic");

/** A game with no generator, so a missing puzzle is an error, not a new puzzle. */
const curated = { ...numberHunt, id: "curated", generate: undefined } as AnyGame;

beforeEach(() => {
  mocks.selects = 0;
  mocks.stored = { data: { payload: { min: 1, max: 9, maxGuesses: 3 }, solution: { secret: 4 } }, error: null };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
});

afterEach(() => vi.useRealTimers());

describe("getOrCreatePuzzle keeps past days' puzzles in memory", () => {
  it("shares one read of a past day's between requests that ask at once", async () => {
    const date = addDays(today(), -1);
    const [a, b] = await Promise.all([getOrCreatePuzzle(curated, date), getOrCreatePuzzle(curated, date)]);
    expect(a).toEqual({ puzzle: { min: 1, max: 9, maxGuesses: 3 }, solution: { secret: 4 } });
    expect(b).toBe(a);
    expect(mocks.selects).toBe(1);
  });

  it("reads today's (and a later day's) for every request: an unplayed puzzle may still be replaced", async () => {
    await getOrCreatePuzzle(curated, today());
    await getOrCreatePuzzle(curated, today());
    await getOrCreatePuzzle(curated, addDays(today(), 1));
    expect(mocks.selects).toBe(3);
  });

  it("keeps a past day's for good", async () => {
    const date = addDays(today(), -3);
    await getOrCreatePuzzle(curated, date);
    vi.setSystemTime(Date.now() + 24 * 3600_000);
    await getOrCreatePuzzle(curated, date);
    expect(mocks.selects).toBe(1);
  });

  it("never keeps a failure: the next request asks again", async () => {
    const date = addDays(today(), -10);
    mocks.stored = { data: null, error: null };
    await expect(getOrCreatePuzzle(curated, date)).rejects.toBeInstanceOf(PuzzleUnavailableError);
    mocks.stored = { data: null, error: { message: "connection reset" } };
    await expect(getOrCreatePuzzle(curated, date)).rejects.toThrow(/connection reset/);
    mocks.stored = { data: { payload: { min: 1, max: 9, maxGuesses: 3 }, solution: { secret: 4 } }, error: null };
    await expect(getOrCreatePuzzle(curated, date)).resolves.toMatchObject({ solution: { secret: 4 } });
    expect(mocks.selects).toBe(3);
  });
});
