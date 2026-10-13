import { beforeEach, describe, expect, it, vi } from "vitest";
import { today } from "@/core/day";
import type { MoveResponse, PlayView } from "@/core/view";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  withinLimit: true,
  moveResponse: null as unknown as MoveResponse,
  applied: [] as unknown[],
}));

// Today's tiles are loaded ahead in full (kept up to five minutes); only a revalidation drops those
// copies, so starting or finishing a game must revalidate rather than refresh().
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => mocks.calls.push(`revalidatePath:${path}`),
  refresh: () => mocks.calls.push("refresh"),
}));
vi.mock("@/server/auth", () => ({
  requireUser: async () => ({ id: "me" }),
  requireProfile: async () => ({ id: "me", is_admin: true }),
}));
vi.mock("@/server/rate-limit", () => ({ takeRateLimit: async () => mocks.withinLimit }));
vi.mock("@/server/puzzles", () => ({ PuzzleUnavailableError: class extends Error {} }));
vi.mock("@/server/plays", () => ({
  startPlay: async () => view("in_progress"),
  readPlay: async (userId: string) => {
    mocks.calls.push(`readPlay:${userId}`);
    return { row: null, loaded: null };
  },
  applyMove: async (params: unknown) => {
    mocks.applied.push(params);
    return mocks.moveResponse;
  },
}));

const { startGame, submitMove } = await import("./actions");

function view(status: PlayView["status"]): PlayView {
  return { gameId: "lexicon", date: today(), version: 1, status, puzzle: {}, state: {}, result: null, reveal: null, sealed: { preload: [], keys: {} } };
}

beforeEach(() => {
  mocks.calls = [];
  mocks.applied = [];
  mocks.withinLimit = true;
});

describe("play actions keep Today fresh", () => {
  it("starting a game drops the browser's loaded-ahead Today", async () => {
    expect(await startGame("lexicon", today())).toMatchObject({ ok: true });
    expect(mocks.calls).toEqual(["revalidatePath:/"]);
  });

  it("finishing a game drops it too", async () => {
    mocks.moveResponse = { ok: true, view: view("won") };
    await submitMove("lexicon", today(), 1, { guess: "x" });
    expect(mocks.calls).toEqual(["readPlay:me", "revalidatePath:/"]);
  });

  it("so does a refused move that hands back a play finished elsewhere", async () => {
    mocks.moveResponse = { ok: false, reason: "finished", message: "", view: view("lost") };
    await submitMove("lexicon", today(), 1, { guess: "x" });
    expect(mocks.calls).toEqual(["readPlay:me", "revalidatePath:/"]);
  });

  it("a move that leaves the play going keeps every copy", async () => {
    mocks.moveResponse = { ok: true, view: view("in_progress") };
    await submitMove("lexicon", today(), 1, { guess: "x" });
    expect(mocks.calls).toEqual(["readPlay:me"]);
  });

  it("a move reads the play with the checks and hands it on, so it isn't read twice", async () => {
    mocks.moveResponse = { ok: true, view: view("in_progress") };
    await submitMove("lexicon", today(), 1, { guess: "x" });
    expect(mocks.applied).toEqual([expect.objectContaining({ userId: "me", read: { row: null, loaded: null } })]);
  });

  it("a refused start changes nothing", async () => {
    mocks.withinLimit = false;
    expect(await startGame("lexicon", today())).toMatchObject({ ok: false });
    expect(mocks.calls).toEqual([]);
  });
});
