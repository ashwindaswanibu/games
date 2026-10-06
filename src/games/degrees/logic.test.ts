import { describe, expect, it } from "vitest";
import type { FinishedOutcome } from "@/core/game";
import {
  chainPersonIds,
  chainScore,
  currentActor,
  degrees,
  degreesMoveSchema,
  degreesResolvedMoveSchema,
  maxLinks,
  type DegreesPuzzle,
  type DegreesResolvedMove,
  type DegreesSolution,
  type DegreesState,
} from "./logic";
import { degreesPuzzleSchema, degreesSolutionSchema, isConsistentSolution } from "./schema";

const pacino = { id: 1, name: "Al Pacino" };
const deNiro = { id: 2, name: "Robert De Niro" };
const foster = { id: 3, name: "Jodie Foster" };
const hopkins = { id: 4, name: "Anthony Hopkins" };
const keitel = { id: 5, name: "Harvey Keitel" };
const kilmer = { id: 6, name: "Val Kilmer" };

const heat = { id: 10, title: "Heat", year: 1995 };
const taxiDriver = { id: 11, title: "Taxi Driver", year: 1976 };
const lambs = { id: 12, title: "The Silence of the Lambs", year: 1991 };

const puzzle: DegreesPuzzle = { start: pacino, end: hopkins, par: 3 };
const solution: DegreesSolution = {
  path: [
    { film: heat, person: deNiro },
    { film: taxiDriver, person: foster },
    { film: lambs, person: hopkins },
  ],
};

const link = (fromPersonId: number, film: typeof heat, person: { id: number; name: string }): DegreesResolvedMove => ({
  type: "link",
  fromPersonId,
  film,
  person,
});

/** Applies moves in order, failing the test on any rejection. */
function play(...moves: DegreesResolvedMove[]): DegreesState {
  let state = degrees.initialState(puzzle);
  for (const move of moves) {
    const result = degrees.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(`move rejected: ${result.error}`);
    state = result.state;
  }
  return state;
}

function reject(state: DegreesState, move: DegreesResolvedMove): string {
  const result = degrees.applyMove({ puzzle, solution, state, move });
  if (result.ok) throw new Error("expected the move to be rejected");
  return result.error;
}

const finish = (state: DegreesState, outcome: FinishedOutcome) => ({
  score: degrees.score({ puzzle, solution, state, outcome, elapsedMs: 0 }),
  share: degrees.shareGrid({ puzzle, state, outcome }),
});

describe("schemas", () => {
  it("accepts the stored puzzle and solution, and the fixture flag", () => {
    expect(degreesPuzzleSchema.parse(puzzle)).toEqual(puzzle);
    expect(degreesPuzzleSchema.parse({ ...puzzle, fixture: true }).fixture).toBe(true);
    expect(degreesSolutionSchema.parse(solution)).toEqual(solution);
    expect(isConsistentSolution(puzzle, solution)).toBe(true);
  });

  it("refuses a puzzle whose ends are the same person, or whose par is out of range", () => {
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, end: pacino }).success).toBe(false);
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, par: 1 }).success).toBe(false);
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, par: 4 }).success).toBe(false);
  });

  it("accepts only id-only moves from the browser", () => {
    expect(degreesMoveSchema.safeParse({ type: "link", filmId: 10, personId: 2 }).success).toBe(true);
    expect(degreesMoveSchema.safeParse({ type: "undo" }).success).toBe(true);
    expect(degreesMoveSchema.safeParse({ type: "give-up" }).success).toBe(true);
    // Titles and names come from the catalog, never from the browser.
    expect(degreesMoveSchema.safeParse({ type: "link", filmId: 10, personId: 2, title: "Heat" }).success).toBe(false);
    expect(degreesMoveSchema.safeParse({ type: "link", filmId: 0, personId: 2 }).success).toBe(false);
    expect(degreesMoveSchema.safeParse({ type: "link", filmId: 1.5, personId: 2 }).success).toBe(false);
    expect(degreesMoveSchema.safeParse({ type: "link", filmId: 10 }).success).toBe(false);
    expect(degreesMoveSchema.safeParse({ type: "skip" }).success).toBe(false);
  });

  it("checks resolved links carry the catalog's film and person", () => {
    expect(degreesResolvedMoveSchema.safeParse(link(1, heat, deNiro)).success).toBe(true);
    expect(degreesResolvedMoveSchema.safeParse({ type: "link", fromPersonId: 1, film: heat }).success).toBe(false);
  });
});

describe("applyMove", () => {
  it("starts from the start actor with an empty chain", () => {
    const state = degrees.initialState(puzzle);
    expect(state).toEqual({ links: [], gaveUp: false });
    expect(currentActor(puzzle, state)).toEqual(pacino);
    expect(degrees.outcome({ puzzle, solution, state })).toBe("in_progress");
  });

  it("adds links and moves the current actor along the chain", () => {
    const state = play(link(1, heat, deNiro), link(2, taxiDriver, foster));
    expect(state.links).toEqual([
      { film: heat, person: deNiro },
      { film: taxiDriver, person: foster },
    ]);
    expect(currentActor(puzzle, state)).toEqual(foster);
    expect(chainPersonIds(puzzle, state)).toEqual([1, 2, 3]);
    expect(degrees.outcome({ puzzle, solution, state })).toBe("in_progress");
  });

  it("wins on reaching the end actor", () => {
    const state = play(link(1, heat, deNiro), link(2, taxiDriver, foster), link(3, lambs, hopkins));
    expect(degrees.outcome({ puzzle, solution, state })).toBe("won");
  });

  it("refuses a link that starts from someone other than the current actor", () => {
    const state = play(link(1, heat, deNiro));
    expect(reject(state, link(1, heat, kilmer))).toMatch(/changed in another tab/);
  });

  it("refuses anyone already in the chain, including the start actor", () => {
    const state = play(link(1, heat, deNiro));
    expect(reject(state, link(2, heat, pacino))).toBe("Al Pacino is already in your chain. Pick someone new.");
    expect(reject(state, link(2, heat, deNiro))).toMatch(/Robert De Niro is already in your chain/);
  });

  it("undoes the last link for free, and refuses to undo an empty chain", () => {
    expect(reject(degrees.initialState(puzzle), { type: "undo" })).toBe("There's no link to undo yet.");
    const state = play(link(1, heat, deNiro), link(2, taxiDriver, keitel), { type: "undo" });
    expect(state.links).toEqual([{ film: heat, person: deNiro }]);
    expect(currentActor(puzzle, state)).toEqual(deNiro);
  });

  it("lets a removed co-star be picked again after an undo", () => {
    const state = play(link(1, heat, deNiro), { type: "undo" }, link(1, heat, deNiro));
    expect(state.links).toHaveLength(1);
  });

  it("allows par + 4 links, and the last one must reach the end actor", () => {
    expect(maxLinks(puzzle)).toBe(7);
    // A wandering chain of 6 links (none of them the end actor).
    const wander = [deNiro, keitel, kilmer, foster, { id: 7, name: "Extra A" }, { id: 8, name: "Extra B" }];
    let from = pacino.id;
    const moves = wander.map((person) => {
      const move = link(from, heat, person);
      from = person.id;
      return move;
    });
    const state = play(...moves);
    expect(state.links).toHaveLength(6);
    expect(reject(state, link(8, lambs, { id: 9, name: "Extra C" }))).toBe(
      "That's your last link, so it has to reach Anthony Hopkins. Undo a link to try another route.",
    );
    const won = play(...moves, link(8, lambs, hopkins));
    expect(won.links).toHaveLength(7);
    expect(degrees.outcome({ puzzle, solution, state: won })).toBe("won");
  });

  it("refuses a link once the chain is full (a guard; the last-link rule normally prevents it)", () => {
    const full: DegreesState = {
      gaveUp: false,
      links: Array.from({ length: 7 }, (_, i) => ({ film: heat, person: { id: 100 + i, name: `P${i}` } })),
    };
    expect(reject(full, link(106, heat, hopkins))).toBe("You've used all 7 links. Undo one to try another route.");
  });

  it("gives up at any time, even before the first link", () => {
    const state = play({ type: "give-up" });
    expect(state.gaveUp).toBe(true);
    expect(degrees.outcome({ puzzle, solution, state })).toBe("lost");
  });

  it("refuses every move after the game is over", () => {
    const won = play(link(1, heat, deNiro), link(2, taxiDriver, foster), link(3, lambs, hopkins));
    const gaveUp = play(link(1, heat, deNiro), { type: "give-up" });
    for (const state of [won, gaveUp]) {
      expect(reject(state, { type: "undo" })).toBe("Today's game is already over.");
      expect(reject(state, { type: "give-up" })).toBe("Today's game is already over.");
    }
    expect(reject(gaveUp, link(2, taxiDriver, foster))).toBe("Today's game is already over.");
  });
});

describe("score, share grid and reveal", () => {
  it("scores 100 at par and 15 less per extra link, floored at 40", () => {
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => chainScore(n, 3))).toEqual([100, 100, 85, 70, 55, 40, 40]);
  });

  it("reports a par finish", () => {
    const state = play(link(1, heat, deNiro), link(2, taxiDriver, foster), link(3, lambs, hopkins));
    expect(finish(state, "won")).toEqual({ score: { score: 100, label: "3 links · par 3" }, share: "🎞🎞🎞⭐" });
  });

  it("reports a longer chain", () => {
    const state = play(
      link(1, heat, kilmer),
      { type: "undo" },
      link(1, heat, deNiro),
      link(2, taxiDriver, keitel),
      link(5, taxiDriver, foster),
      link(3, lambs, hopkins),
    );
    expect(finish(state, "won")).toEqual({ score: { score: 85, label: "4 links · par 3" }, share: "🎞🎞🎞🎞⭐" });
  });

  it("scores 0 for giving up", () => {
    expect(finish(play({ type: "give-up" }), "lost")).toEqual({ score: { score: 0, label: "Gave up" }, share: "🏳️" });
    expect(finish(play(link(1, heat, deNiro), { type: "give-up" }), "lost").share).toBe("🎞🏳️");
  });

  it("reveals one shortest chain", () => {
    expect(degrees.reveal?.({ puzzle, solution })).toEqual(solution);
  });

  it("keeps the puzzle and initial state free of the solution", () => {
    const visible = JSON.stringify({ puzzle, state: degrees.initialState(puzzle) });
    for (const step of solution.path.slice(0, -1)) {
      expect(visible).not.toContain(step.film.title);
      expect(visible).not.toContain(step.person.name);
    }
  });
});
