import { describe, expect, it } from "vitest";
import { fourProblems, type FourFilm } from "./decoys.mjs";

const film = (id: number, title: string, extra: Partial<FourFilm> = {}): FourFilm => ({
  id,
  title,
  year: 2015,
  genres: ["Action"],
  directors: [`Director ${id}`],
  popularity: 50,
  series: [],
  isAdult: false,
  ...extra,
});
const live = () => "live";

describe("fourProblems", () => {
  const four = [film(1, "Furious 7", { series: ["Q1576873"] }), film(2, "Mad Max: Fury Road"), film(3, "John Wick"), film(4, "Baby Driver")];

  it("passes a four that follows the rules", () => {
    expect(fourProblems(four, 1, live)).toEqual([]);
  });

  it("finds two films of one Wikidata series, though their titles share no words", () => {
    const withSequel = [...four.slice(0, 3), film(5, "Fast Five", { series: ["Q1576873"] })];
    expect(fourProblems(withSequel, 1, live)).toEqual(["Furious 7 and Fast Five are one series or by one director"]);
  });

  it("finds a film hidden as adult, a look-alike of another kind and a shared director", () => {
    const bad = [four[0]!, film(2, "Hidden", { isAdult: true }), film(3, "Cartoon"), film(4, "Same Hand", { directors: ["Director 1"] })];
    expect(fourProblems(bad, 1, (f) => (f.title === "Cartoon" ? "animated" : "live"))).toEqual([
      "Hidden is hidden as adult",
      "Cartoon is animated, the answer live",
      "Furious 7 and Same Hand are one series or by one director",
    ]);
  });

  it("flags a four that lost its answer", () => {
    expect(fourProblems(four.slice(1), 1, live)).toEqual(["the answer isn't among the four"]);
  });
});
