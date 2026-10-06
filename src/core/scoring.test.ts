import { describe, expect, it } from "vitest";
import { attemptsScore, clampScore, isValidScore, linearScore } from "./scoring";

describe("scoring", () => {
  it("interpolates linearly in either direction", () => {
    expect(linearScore(1, 1, 7)).toBe(100);
    expect(linearScore(7, 1, 7)).toBe(0);
    expect(linearScore(4, 1, 7)).toBe(50);
    expect(linearScore(80, 100, 0)).toBe(80);
    expect(linearScore(99, 1, 7)).toBe(0);
  });

  it("scores attempts with a floor for any solve", () => {
    expect(attemptsScore(1, 7, true)).toBe(100);
    expect(attemptsScore(7, 7, true)).toBe(40);
    expect(attemptsScore(7, 7, false)).toBe(0);
  });

  it("clamps and validates", () => {
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-3)).toBe(0);
    expect(() => clampScore(Number.NaN)).toThrow();
    expect(isValidScore(50)).toBe(true);
    expect(isValidScore(50.5)).toBe(false);
    expect(isValidScore(101)).toBe(false);
  });
});
