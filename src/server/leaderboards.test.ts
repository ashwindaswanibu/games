import { describe, expect, it } from "vitest";
import type { PuzzleDate } from "@/core/day";
import { hideUnfinishedToday } from "./leaderboards";

const today = "2026-10-06" as PuzzleDate;
const plays = [
  { game_id: "number-hunt", puzzle_date: "2026-10-06", score: 80 },
  { game_id: "degrees", puzzle_date: "2026-10-06", score: 60 },
  { game_id: "number-hunt", puzzle_date: "2026-10-05", score: 40 },
];

describe("hideUnfinishedToday", () => {
  it("hides another player's results for today until the viewer has finished that game", () => {
    expect(hideUnfinishedToday(plays, today, new Set()).map((p) => p.puzzle_date)).toEqual(["2026-10-05"]);
  });

  it("shows today's result for exactly the games the viewer has finished", () => {
    expect(hideUnfinishedToday(plays, today, new Set(["number-hunt"]))).toEqual([plays[0], plays[2]]);
  });

  it("never hides earlier days", () => {
    expect(hideUnfinishedToday(plays, "2026-10-07" as PuzzleDate, new Set())).toEqual(plays);
  });

  it("treats anything after today as today (hidden unless finished)", () => {
    expect(hideUnfinishedToday(plays, "2026-10-04" as PuzzleDate, new Set(["number-hunt"]))).toEqual([]);
  });
});
