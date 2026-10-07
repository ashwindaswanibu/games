import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import { pickDecoys, pickOptions, seriesKey, type DecoyCandidate } from "./decoys";
import { OPTION_COUNT } from "./logic";

let nextId = 100;
const film = (title: string, year: number | null, genres: string[], popularity: number | null, directors: string[] = [`Director of ${title}`]): DecoyCandidate => ({
  id: nextId++,
  title,
  year,
  genres,
  directors,
  popularity,
});

const dune2 = film("Dune: Part Two", 2024, ["Science fiction", "Action", "Adventure", "Epic"], 58, ["Denis Villeneuve"]);
const rng = () => createRng([1, 2, 3, 4]);

describe("seriesKey", () => {
  it.each([
    ["Dune: Part Two", "dune"],
    ["Dune", "dune"],
    ["Toy Story 3", "toy story"],
    ["Rocky IV", "rocky"],
    ["Kill Bill: Vol. 1", "kill bill"],
    ["Mad Max: Fury Road", "mad max"],
    ["Amélie", "amelie"],
    ["Star Wars – Episode IV", "star wars"],
  ])("%s → %s", (title, key) => {
    expect(seriesKey(title)).toBe(key);
  });
});

describe("pickDecoys", () => {
  const near = [
    film("Arrival", 2016, ["Science fiction", "Drama", "Mystery"], 66, ["Denis Villeneuve"]),
    film("Dune", 2021, ["Science fiction", "Adventure", "Epic"], 70),
    film("Furiosa: A Mad Max Saga", 2024, ["Action", "Adventure", "Science fiction"], 52),
    film("Oppenheimer", 2023, ["Drama", "Historical", "Epic"], 75),
    film("The Creator", 2023, ["Science fiction", "Action"], 40),
    film("Rebel Moon", 2023, ["Science fiction", "Action", "Adventure", "Epic"], 45),
    film("Godzilla x Kong", 2024, ["Action", "Science fiction", "Adventure", "Monster"], 50),
    film("Barbie", 2023, ["Comedy", "Fantasy"], 70),
    film("Avatar: The Way of Water", 2022, ["Science fiction", "Adventure", "Epic", "Action"], 80),
    film("Ancient Epic", 1959, ["Epic", "Adventure"], 60),
    film("Obscure Space Film", 2023, ["Science fiction", "Action"], 12),
    film("No Year", null, ["Science fiction", "Action"], 60),
  ];

  it("picks three look-alikes: same kind of film, era and fame", () => {
    const decoys = pickDecoys(dune2, near, rng());
    expect(decoys).toHaveLength(OPTION_COUNT - 1);
    for (const d of decoys) {
      expect(Math.abs(d.year! - dune2.year!)).toBeLessThanOrEqual(5);
      expect(d.genres.some((g) => dune2.genres.includes(g))).toBe(true);
    }
  });

  it("never offers the same series, the same director, a namesake or a film without a year", () => {
    for (let seed = 0; seed < 40; seed++) {
      const titles = pickDecoys(dune2, near, createRng([seed, 7, 7, 7])).map((d) => d.title);
      expect(titles).not.toContain("Dune"); // the same series
      expect(titles).not.toContain("Arrival"); // the same director
      expect(titles).not.toContain("No Year");
      expect(titles).not.toContain("Ancient Epic"); // 65 years apart, while closer films exist
      expect(titles).not.toContain("Obscure Space Film"); // far less famous
    }
  });

  it("doesn't pick two decoys from one series", () => {
    const pool = [film("Saga Part 1", 2023, ["Science fiction"], 50), film("Saga Part 2", 2024, ["Science fiction"], 50), film("Other A", 2022, ["Action"], 55), film("Other B", 2024, ["Epic"], 60)];
    const titles = pickDecoys(dune2, pool, rng()).map((d) => d.title);
    expect(titles.filter((t) => t.startsWith("Saga"))).toHaveLength(1);
  });

  it("is deterministic for a given seed", () => {
    expect(pickDecoys(dune2, near, rng())).toEqual(pickDecoys(dune2, near, rng()));
  });

  it("widens its bounds when the strict ones leave too few", () => {
    const pool = [film("Old A", 1990, ["Drama"], 50), film("Old B", 1985, ["Comedy"], 40), film("Old C", 1980, ["Western"], 90)];
    expect(pickDecoys(dune2, pool, rng())).toHaveLength(3);
  });

  it("refuses when there aren't enough films at all", () => {
    expect(() => pickDecoys(dune2, [film("Only One", 2024, ["Action"], 50)], rng())).toThrow(/look-alike/);
  });
});

describe("pickOptions", () => {
  it("returns the answer and three decoys as film refs, shuffled", () => {
    const pool = Array.from({ length: 12 }, (_, i) => film(`Space Film ${String.fromCharCode(65 + i)}`, 2020 + (i % 5), ["Science fiction", "Action"], 50 + i));
    const options = pickOptions(dune2, pool, rng());
    expect(options).toHaveLength(OPTION_COUNT);
    expect(options.filter((o) => o.id === dune2.id)).toHaveLength(1);
    expect(Object.keys(options[0]!).sort()).toEqual(["id", "title", "year"]);
    const positions = new Set(Array.from({ length: 30 }, (_, s) => pickOptions(dune2, pool, createRng([s, 1, 1, 1])).findIndex((o) => o.id === dune2.id)));
    expect(positions.size).toBeGreaterThan(1);
  });
});
