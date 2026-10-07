import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import { pickDecoys, pickOptions, sameSeries, seriesKey, shareSeries, type DecoyCandidate } from "./decoys";
import { OPTION_COUNT } from "./logic";

let nextId = 100;
const film = (
  title: string,
  year: number | null,
  genres: string[],
  popularity: number | null,
  directors: string[] = [`Director of ${title}`],
  series: string[] = [],
): DecoyCandidate => ({
  id: nextId++,
  title,
  year,
  genres,
  directors,
  popularity,
  series,
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
    ["Harry Potter and the Goblet of Fire", "harry potter"],
    ["The Exorcist", "exorcist"],
    ["Exorcist II: The Heretic", "exorcist"],
  ])("%s → %s", (title, key) => {
    expect(seriesKey(title)).toBe(key);
  });
});

describe("sameSeries", () => {
  it.each([
    ["Harry Potter and the Goblet of Fire", "Harry Potter and the Chamber of Secrets"],
    ["The Bourne Identity", "The Bourne Supremacy"],
    ["Spider-Man 3", "The Amazing Spider-Man"],
    ["Rogue One: A Star Wars Story", "Star Wars: Episode IV – A New Hope"],
    ["Mad Max: Fury Road", "Furiosa: A Mad Max Saga"],
    ["Twilight", "The Twilight Saga: New Moon"],
    ["The Exorcist", "Exorcist II: The Heretic"],
    ["The Matrix", "The Matrix Reloaded"],
    ["Alien", "Aliens"],
    ["Dune", "Dune: Part Two"],
  ])("%s and %s are one series", (a, b) => {
    expect(sameSeries(a, b)).toBe(true);
    expect(sameSeries(b, a)).toBe(true);
  });

  it.each([
    ["Dune: Part Two", "Arrival"],
    ["Heat", "Collateral"],
    ["Barbie", "Oppenheimer"],
  ])("%s and %s are not", (a, b) => {
    expect(sameSeries(a, b)).toBe(false);
  });
});

describe("shareSeries", () => {
  it("is true when two films share a Wikidata series", () => {
    expect(shareSeries(["Q1576873"], ["Q1576873"])).toBe(true);
    expect(shareSeries(["Q22092344", "Q25540859"], ["Q22092344", "Q6586871"])).toBe(true);
    expect(shareSeries(["Q22092344"], ["Q51964873"])).toBe(false);
    expect(shareSeries([], [])).toBe(false);
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
    for (let seed = 0; seed < 20; seed++) {
      const decoys = pickDecoys(dune2, near, createRng([seed, 3, 3, 3]));
      expect(decoys).toHaveLength(OPTION_COUNT - 1);
      for (const d of decoys) {
        expect(Math.abs(d.year! - dune2.year!)).toBeLessThanOrEqual(8);
        expect(d.genres.some((g) => dune2.genres.includes(g))).toBe(true);
      }
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
    const pool = [film("Saga Part 1", 2023, ["Science fiction"], 50), film("Saga Part 2", 2024, ["Science fiction"], 50), film("Northern Lights", 2022, ["Action"], 55), film("Quiet Planet", 2024, ["Epic"], 60)];
    const titles = pickDecoys(dune2, pool, rng()).map((d) => d.title);
    expect(titles.filter((t) => t.startsWith("Saga"))).toHaveLength(1);
  });

  it("keeps all four options within one window of years, with the answer anywhere in it", () => {
    // A rich catalog: five similar films a year, so the strictest bound (5 years) always holds.
    const pool = Array.from({ length: 60 }, (_, i) => film(`Space Saga No ${i} ${"xyz"[i % 3]}`, 2012 + Math.floor(i / 5), ["Science fiction", "Action"], 55));
    pool.forEach((f, i) => (f.title = `Film${i} Space`));
    const ranks = new Map<number, number>();
    for (let seed = 0; seed < 300; seed++) {
      const decoys = pickDecoys(dune2, pool.map((f) => ({ ...f, year: f.year! + 6 })), createRng([seed, 9, 9, 9]));
      const years = [dune2.year!, ...decoys.map((d) => d.year!)];
      expect(Math.max(...years) - Math.min(...years)).toBeLessThanOrEqual(5);
      const rank = years.filter((y) => y < dune2.year!).length;
      ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
    }
    // The answer is sometimes the earliest, sometimes the latest, sometimes between: its year gives nothing away.
    expect(ranks.get(0)).toBeGreaterThan(30);
    expect(ranks.get(3)).toBeGreaterThan(30);
  });

  it("never offers a film of the answer's Wikidata series, even with no word in common", () => {
    const FAST = "Q1576873"; // Fast & Furious
    const furious7 = film("Furious 7", 2015, ["Action", "Heist", "Thriller"], 60, ["James Wan"], [FAST]);
    const pool = [
      film("Fast Five", 2011, ["Action", "Heist", "Thriller"], 60, ["Justin Lin"], [FAST]),
      film("The Fate of the Furious", 2017, ["Action", "Heist", "Thriller"], 55, ["F. Gary Gray"], [FAST]),
      film("Baby Driver", 2017, ["Action", "Heist", "Crime"], 50),
      film("The Italian Job", 2014, ["Action", "Heist"], 55),
      film("Mad Max: Fury Road", 2015, ["Action", "Thriller"], 70),
      film("John Wick", 2014, ["Action", "Thriller"], 60),
    ];
    // Without the series, Fast Five shares no words with Furious 7 and would be the best look-alike.
    expect(sameSeries("Furious 7", "Fast Five")).toBe(false);
    for (let seed = 0; seed < 40; seed++) {
      const titles = pickDecoys(furious7, pool, createRng([seed, 5, 5, 5])).map((d) => d.title);
      expect(titles).not.toContain("Fast Five");
      expect(titles).not.toContain("The Fate of the Furious");
    }
  });

  it("doesn't pick two decoys from one Wikidata series", () => {
    const BOND = "Q2484680";
    const pool = [
      film("Skyfall", 2012, ["Science fiction"], 55, ["Sam Mendes"], [BOND]),
      film("Casino Royale", 2023, ["Science fiction"], 55, ["Martin Campbell"], [BOND]),
      film("Northern Lights", 2022, ["Action"], 55),
      film("Quiet Planet", 2024, ["Epic"], 60),
    ];
    const titles = pickDecoys(dune2, pool, rng()).map((d) => d.title);
    expect(titles.filter((t) => t === "Skyfall" || t === "Casino Royale")).toHaveLength(1);
  });

  it("is deterministic for a given seed", () => {
    expect(pickDecoys(dune2, near, rng())).toEqual(pickDecoys(dune2, near, rng()));
  });

  it("widens its bounds when the strict ones leave too few", () => {
    const pool = [film("Harbor Lights", 1990, ["Drama"], 50), film("Grey Morning", 1985, ["Comedy"], 40), film("Winter Fields", 1980, ["Western"], 90)];
    expect(pickDecoys(dune2, pool, rng())).toHaveLength(3);
  });

  it("refuses when there aren't enough films at all", () => {
    expect(() => pickDecoys(dune2, [film("Only One", 2024, ["Action"], 50)], rng())).toThrow(/look-alike/);
  });
});

describe("pickOptions", () => {
  it("returns the answer and three decoys as film refs, shuffled", () => {
    const names = ["Orbit", "Nebula", "Comet", "Quasar", "Pulsar", "Zenith", "Vortex", "Aurora", "Eclipse", "Meteor", "Horizon", "Solstice"];
    const pool = names.map((name, i) => film(name, 2020 + (i % 5), ["Science fiction", "Action"], 50 + i));
    const options = pickOptions(dune2, pool, rng());
    expect(options).toHaveLength(OPTION_COUNT);
    expect(options.filter((o) => o.id === dune2.id)).toHaveLength(1);
    expect(Object.keys(options[0]!).sort()).toEqual(["id", "title", "year"]);
    const positions = new Set(Array.from({ length: 30 }, (_, s) => pickOptions(dune2, pool, createRng([s, 1, 1, 1])).findIndex((o) => o.id === dune2.id)));
    expect(positions.size).toBeGreaterThan(1);
  });
});
