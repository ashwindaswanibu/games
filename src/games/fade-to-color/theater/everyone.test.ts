import { describe, expect, it } from "vitest";
import type { FriendResult } from "@/core/view";
import { everyonesPicks, initialsOf, tallyLine, tallyOf } from "./everyone";

const film = (id: number, title: string) => ({ id, title, year: 2000 });
const FOUR = [film(1, "Drive"), film(2, "Collateral"), film(3, "Nightcrawler"), film(4, "Thief")];
const ANSWER = 2;

const result = (id: string, name: string, status: FriendResult["status"], grid: string | null, pickId?: number | null): FriendResult => ({
  profile: { id, username: id, display_name: name },
  status,
  score: null,
  label: null,
  shareGrid: grid,
  ...(pickId !== undefined && { detail: { pickId } }),
});

const RESULTS = [
  result("a", "Ashwin Daswani", "won", "🟥🟩", null),
  result("p", "Priya", "won", "🟡", 2),
  result("m", "Marco", "won", "🟥⬛🟥🟡", 2),
  result("j", "Jess", "lost", "🟥⚫", 4),
  result("d", "Dev", "lost", "🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥⚫", 1),
  result("s", "Sam", "in_progress", null),
  result("x", "Xu", "not_started", null),
];

describe("tallyOf / tallyLine", () => {
  it("counts finished plays: named, picked right, got away", () => {
    expect(tallyOf(RESULTS)).toEqual({ named: 1, picked: 2, missed: 2 });
    expect(tallyLine(tallyOf(RESULTS))).toBe("1 named it · 2 picked it · 2 didn't");
  });

  it("reads old grids (🟨 was a right pick)", () => {
    expect(tallyOf([result("o", "Old", "won", "⬛⬛🟨")])).toEqual({ named: 0, picked: 1, missed: 0 });
  });

  it("leaves out what nobody did", () => {
    expect(tallyLine({ named: 4, picked: 0, missed: 1 })).toBe("4 named it · 1 didn't");
    expect(tallyLine({ named: 0, picked: 1, missed: 0 })).toBe("1 picked it");
  });
});

describe("everyonesPicks", () => {
  it("lays out the four in their shared order, the film marked, with who picked each", () => {
    const cards = everyonesPicks(FOUR, ANSWER, RESULTS, "m")!;
    expect(cards.map((c) => [c.film.title, c.answer, c.pickers.map((p) => `${p.initials}${p.you ? "*" : ""}`)])).toEqual([
      ["Drive", false, ["D"]],
      ["Collateral", true, ["P", "M*"]],
      ["Nightcrawler", false, []],
      ["Thief", false, ["J"]],
    ]);
  });

  it("is nothing when nobody picked", () => {
    expect(everyonesPicks(FOUR, ANSWER, [RESULTS[0]!, RESULTS[5]!], "a")).toBeNull();
  });

  it("ignores a pick outside the four and details without a pick", () => {
    const odd = [result("q", "Q", "won", "🟡", 99), { ...result("r", "R", "won", "🟩"), detail: { pickId: "2" } }];
    expect(everyonesPicks(FOUR, ANSWER, odd, "q")).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes the first and last words' first letters", () => {
    expect(initialsOf(["Ashwin Daswani", "Dev", "  mary   jane watson "])).toEqual(["AD", "D", "MW"]);
  });

  it("tells apart names that would read the same", () => {
    expect(initialsOf(["Sam", "Sara", "Dev"])).toEqual(["SAM", "SAR", "D"]);
    expect(initialsOf(["Ana Diaz", "Ali Dar"])).toEqual(["AND", "ALD"]);
  });

  it("stops when there's nothing more to tell", () => {
    expect(initialsOf(["Jo", "Jo"])).toEqual(["JO", "JO"]);
    expect(initialsOf([""])).toEqual(["?"]);
  });
});
