import { describe, expect, it, vi } from "vitest";
import type { PuzzleDate } from "@/core/day";
import type { MoveResponse, PlayView } from "@/core/view";
import type { StartResponse } from "./actions";
import { createPlaySession } from "./session";

function view(version: number, state: unknown = { guesses: [] }, status: PlayView["status"] = "in_progress"): PlayView {
  return { gameId: "lexicon", date: "2026-10-13" as PuzzleDate, version, status, puzzle: { letters: "abc" }, state, result: null, reveal: null, sealed: { preload: [], keys: {} } };
}

/** A promise settled from outside, to hold the server's answer until the test lets it go. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A session over controllable server calls; `screen` is what the page would be showing. */
function setup(options: { startingView?: PlayView | null } = {}) {
  const startAnswer = deferred<StartResponse>();
  const startGame = vi.fn(() => startAnswer.promise);
  const submitMove = vi.fn(async (version: number): Promise<MoveResponse> => ({ ok: true, view: view(version + 1, { guesses: ["x"] }) }));
  const screen = { view: null as PlayView | null, pending: false, notice: null as string | null };
  const session = createPlaySession({
    initialView: null,
    startingView: options.startingView === undefined ? view(0) : options.startingView,
    startGame,
    submitMove,
    show(change) {
      Object.assign(screen, change);
    },
  });
  return { session, screen, startAnswer, startGame, submitMove };
}

describe("instant Start", () => {
  it("shows the starting board at once, before the server answers", async () => {
    const { session, screen, startAnswer } = setup();
    const started = session.start();
    expect(screen.view).toEqual(view(0));
    expect(screen.pending).toBe(false);
    startAnswer.resolve({ ok: true, view: view(0) });
    expect(await started).toEqual({ ok: true });
    expect(screen.view).toEqual(view(0));
  });

  it("goes back to the start screen with the reason when the server refuses", async () => {
    const { session, screen, startAnswer } = setup();
    const started = session.start();
    startAnswer.resolve({ ok: false, message: "A new day has started — refresh for today's puzzles." });
    expect(await started).toEqual({ ok: false, message: "A new day has started — refresh for today's puzzles." });
    expect(screen.view).toBeNull();
    expect(screen.notice).toBe("A new day has started — refresh for today's puzzles.");
  });

  it("goes back to the start screen when the server can't be reached", async () => {
    const { session, screen, startAnswer } = setup();
    const started = session.start();
    startAnswer.reject(new Error("offline"));
    expect(await started).toMatchObject({ ok: false });
    expect(screen.view).toBeNull();
    expect(screen.notice).toMatch(/Couldn't start/);
  });

  it("takes the server's play when one already existed (another tab or device)", async () => {
    const { session, screen, startAnswer } = setup();
    const started = session.start();
    const elsewhere = view(2, { guesses: ["apple", "melon"] });
    startAnswer.resolve({ ok: true, view: elsewhere });
    await started;
    expect(screen.view).toBe(elsewhere);
  });

  it("can start again after a refused start", async () => {
    const { session, screen, startAnswer, startGame } = setup();
    const first = session.start();
    startAnswer.resolve({ ok: false, message: "Slow down a little and try again." });
    await first;
    startGame.mockResolvedValueOnce({ ok: true, view: view(0) });
    expect(await session.start()).toEqual({ ok: true });
    expect(screen.view).toEqual(view(0));
    expect(screen.notice).toBeNull();
  });
});

describe("a move made while Start is still on its way", () => {
  it("waits for the server's answer, then goes against the play it confirmed", async () => {
    const { session, screen, startAnswer, submitMove } = setup();
    const started = session.start();
    const moved = session.move({ type: "guess", word: "apple" });
    await Promise.resolve();
    expect(submitMove).not.toHaveBeenCalled();
    expect(screen.pending).toBe(true);
    startAnswer.resolve({ ok: true, view: view(0) });
    await started;
    expect(await moved).toEqual({ ok: true });
    expect(submitMove).toHaveBeenCalledWith(0, { type: "guess", word: "apple" });
    expect(screen.view?.version).toBe(1);
    expect(screen.pending).toBe(false);
  });

  it("goes through when the database hands the same play back with its keys in another order", async () => {
    // jsonb stores an object's keys sorted by length, so the confirmed state comes back reordered.
    const { session, screen, startAnswer, submitMove } = setup({ startingView: view(0, { guesses: [], gaveUp: false }) });
    const started = session.start();
    const moved = session.move({ type: "guess", word: "apple" });
    startAnswer.resolve({ ok: true, view: view(0, { gaveUp: false, guesses: [] }) });
    await started;
    expect(await moved).toEqual({ ok: true });
    expect(submitMove).toHaveBeenCalledWith(0, { type: "guess", word: "apple" });
    expect(screen.notice).toBeNull();
  });

  it("is never sent when the start is refused, and the start screen is back", async () => {
    const { session, screen, startAnswer, submitMove } = setup();
    const started = session.start();
    const moved = session.move({ type: "guess", word: "apple" });
    startAnswer.resolve({ ok: false, message: "Slow down a little and try again." });
    await started;
    expect(await moved).toEqual({ ok: false, message: "Slow down a little and try again." });
    expect(submitMove).not.toHaveBeenCalled();
    expect(screen.view).toBeNull();
    expect(screen.pending).toBe(false);
  });

  it("is dropped when the server already had a different play, which is shown instead", async () => {
    const { session, screen, startAnswer, submitMove } = setup();
    const started = session.start();
    const moved = session.move({ type: "guess", word: "apple" });
    const elsewhere = view(2, { guesses: ["apple", "melon"] });
    startAnswer.resolve({ ok: true, view: elsewhere });
    await started;
    expect(await moved).toEqual({ ok: false, message: "Updated from another session." });
    expect(submitMove).not.toHaveBeenCalled();
    expect(screen.view).toBe(elsewhere);
    expect(screen.notice).toBe("Updated from another session.");
  });
});

describe("Start without a starting view", () => {
  it("waits for the server, as before", async () => {
    const { session, screen, startAnswer } = setup({ startingView: null });
    const started = session.start();
    expect(screen.view).toBeNull();
    expect(screen.pending).toBe(true);
    startAnswer.resolve({ ok: true, view: view(0) });
    await started;
    expect(screen.view).toEqual(view(0));
    expect(screen.pending).toBe(false);
  });
});
