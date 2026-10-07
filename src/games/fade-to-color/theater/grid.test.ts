import { describe, expect, it } from "vitest";
import type { FilmRef } from "@/games/_movies/schemas";
import { LEVEL_COUNT, type State, type Turn } from "../logic";
import { describeGrid, endKicker, parseGrid } from "./grid";

const film = (id: number, title: string): FilmRef => ({ id, title, year: 2000 });
const ANSWER = film(1, "Collateral");
const OPTIONS = [film(2, "Drive"), ANSWER, film(3, "Nightcrawler"), film(4, "Thief")];
const skipped: Turn = { skipped: true };
const missed: Turn = { film: film(9, "Heat"), correct: false };
const named: Turn = { film: ANSWER, correct: true };

function state(turns: Turn[], pick: "right" | "wrong" | null = null, open = pick !== null): State {
  return {
    turns,
    unlocked: [],
    options: open ? OPTIONS : [],
    pick: pick === null ? null : { film: pick === "right" ? ANSWER : OPTIONS[0]!, correct: pick === "right" },
  };
}

describe("parseGrid", () => {
  it("reads one mark per reel used, then the pick's circle", () => {
    expect(parseGrid("🟥⬛🟥🟩")).toEqual({ reels: ["missed", "skipped", "missed", "solved"], pick: null });
    expect(parseGrid("🟥⬛🟥🟡")).toEqual({ reels: ["missed", "skipped", "missed"], pick: "right" });
    expect(parseGrid("🟡")).toEqual({ reels: [], pick: "right" });
    expect(parseGrid(`${"🟥".repeat(10)}⚫`)).toEqual({ reels: Array(10).fill("missed"), pick: "wrong" });
  });

  it("still reads grids from before the stop: 🟨 was a right pick, an eleventh 🟥 a wrong one", () => {
    expect(parseGrid(`${"⬛".repeat(9)}🟥🟨`)).toEqual({ reels: [...Array(9).fill("skipped"), "missed"], pick: "right" });
    expect(parseGrid(`${"⬛".repeat(9)}🟥🟥`)).toEqual({ reels: [...Array(9).fill("skipped"), "missed"], pick: "wrong" });
  });

  it("ignores anything that isn't a mark (spaces, variation selectors)", () => {
    expect(parseGrid("🟥 ⬛️🟡\n")).toEqual({ reels: ["missed", "skipped"], pick: "right" });
  });
});

describe("describeGrid", () => {
  it("puts every result into words", () => {
    expect(describeGrid(parseGrid("🟥⬛🟩"))).toBe("Named on reel 3");
    expect(describeGrid(parseGrid("🟥⬛🟥🟡"))).toBe("Stopped on reel 4 and picked it");
    expect(describeGrid(parseGrid("⚫"))).toBe("Stopped on reel 1, wrong pick");
    expect(describeGrid(parseGrid(`${"⬛".repeat(9)}🟥🟡`))).toBe("Picked after the last reel");
    expect(describeGrid(parseGrid(`${"🟥".repeat(10)}⚫`))).toBe("Out of reels, wrong pick");
    expect(describeGrid(parseGrid("⬛".repeat(10)))).toBe("Not named in 10 reels");
  });
});

describe("endKicker", () => {
  it("names the reel the film was named on", () => {
    expect(endKicker(state([missed, skipped, named]), "won")).toBe("Named on reel 3");
  });

  it("brags a little about a right pick on the first reel", () => {
    expect(endKicker(state([], "right"), "won")).toBe("Picked by color alone");
  });

  it("names the reel the film was stopped on, or the run-out", () => {
    expect(endKicker(state([missed, skipped, missed], "right"), "won")).toBe("Picked on reel 4");
    expect(endKicker(state([...Array(LEVEL_COUNT - 1).fill(skipped), missed], "right"), "won")).toBe("Picked after the last reel");
    expect(endKicker(state([skipped, skipped, missed], "wrong"), "lost")).toBe("Stopped on reel 4 · the film was");
    expect(endKicker(state([...Array(LEVEL_COUNT - 1).fill(skipped), missed], "wrong"), "lost")).toBe("Out of reels · the film was");
  });

  it("still reads a play that gave up on the last reel", () => {
    expect(endKicker(state(Array(LEVEL_COUNT).fill(skipped)), "lost")).toBe("You gave up · the film was");
  });
});
