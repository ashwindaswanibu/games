import { describe, expect, it } from "vitest";
import { degreesPuzzleSchema, degreesSolutionSchema, isConsistentSolution } from "./schema";

const puzzle = degreesPuzzleSchema.parse({ start: { id: 1, name: "Start" }, end: { id: 3, name: "End" }, par: 2 });
const link = (filmId: number, personId: number) => ({ film: { id: filmId, title: `Film ${filmId}`, year: 1999 }, person: { id: personId, name: `P${personId}` } });

describe("degrees schema", () => {
  it("accepts a well-formed puzzle and solution", () => {
    const solution = degreesSolutionSchema.parse({ path: [link(10, 2), link(11, 3)] });
    expect(isConsistentSolution(puzzle, solution)).toBe(true);
  });

  it("rejects pars outside 2–3 and identical start and end", () => {
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, par: 1 }).success).toBe(false);
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, par: 4 }).success).toBe(false);
    expect(degreesPuzzleSchema.safeParse({ ...puzzle, end: puzzle.start }).success).toBe(false);
  });

  it("flags solutions that don't fit the puzzle", () => {
    expect(isConsistentSolution(puzzle, { path: [link(10, 2), link(11, 4)] })).toBe(false); // wrong end
    expect(isConsistentSolution(puzzle, { path: [link(10, 2), link(11, 2), link(12, 3)] })).toBe(false); // longer than par
    expect(isConsistentSolution({ ...puzzle, par: 3 }, { path: [link(10, 1), link(11, 2), link(12, 3)] })).toBe(false); // revisits start
  });
});
