import { describe, expect, it } from "vitest";
import { walledNote } from "./format";

describe("walledNote", () => {
  it("says nothing when nothing is walled", () => {
    expect(walledNote([], 1)).toBeNull();
    expect(walledNote([], 3)).toBeNull();
  });

  it("keeps the one-game line while one game is live", () => {
    expect(walledNote(["Number Hunt"], 1)).toBe("Today's points show once you finish a game.");
  });

  it("names the one game still walled when others are live", () => {
    expect(walledNote(["Degrees"], 2)).toBe("Today's Degrees points show once you finish it.");
  });

  it("speaks per game when several are walled", () => {
    expect(walledNote(["Number Hunt", "Degrees"], 2)).toBe("Today's points for each game show once you finish it.");
  });
});
