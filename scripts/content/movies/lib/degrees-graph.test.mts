import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import { actorPool, bestShortestPath, buildGraph, linkDistances, pickPuzzle, popularityLinkScore, type Credit, type FilmInfo, type PersonInfo } from "./degrees-graph.mjs";

/**
 * People 1–9, films 100+.
 *
 *   1 ─(100)─ 2 ─(101)─ 3 ─(102)─ 4
 *   1 ─(103, obscure)─ 5 ─(104, obscure)─ 3
 *   6 ─(105)─ 7          (a separate component)
 */
const credits: Credit[] = [
  { filmId: 100, personId: 1, billing: 0 },
  { filmId: 100, personId: 2, billing: 1 },
  { filmId: 101, personId: 2, billing: 0 },
  { filmId: 101, personId: 3, billing: 1 },
  { filmId: 102, personId: 3, billing: 0 },
  { filmId: 102, personId: 4, billing: 1 },
  { filmId: 103, personId: 1, billing: 12 },
  { filmId: 103, personId: 5, billing: 0 },
  { filmId: 104, personId: 5, billing: 0 },
  { filmId: 104, personId: 3, billing: 9 },
  { filmId: 105, personId: 6, billing: 0 },
  { filmId: 105, personId: 7, billing: 0 },
  // A duplicate credit is ignored.
  { filmId: 100, personId: 1, billing: 3 },
];
const graph = buildGraph(credits);
const films = new Map<number, FilmInfo>(
  [100, 101, 102, 103, 104, 105].map((id) => [id, { id, title: `Film ${id}`, year: 2000, popularity: id >= 103 ? 2 : 80 }]),
);
const people = new Map<number, PersonInfo>([1, 2, 3, 4, 5, 6, 7].map((id) => [id, { id, name: `Person ${id}`, popularity: id === 5 ? 1 : 60 }]));
const score = popularityLinkScore(graph, films, people);

describe("buildGraph", () => {
  it("indexes both sides and keeps the first billing of a duplicate", () => {
    expect(graph.filmsOf.get(1)).toEqual([100, 103]);
    expect(graph.castOf.get(101)).toEqual([2, 3]);
    expect(graph.billing(100, 1)).toBe(0);
    expect(graph.billing(100, 9)).toBeNull();
  });
});

describe("linkDistances", () => {
  it("counts links (person → film → co-star) up to the limit", () => {
    expect(Object.fromEntries(linkDistances(graph, 1, 3))).toEqual({ 1: 0, 2: 1, 5: 1, 3: 2, 4: 3 });
    expect(linkDistances(graph, 1, 1).has(3)).toBe(false);
    expect(linkDistances(graph, 1, 5).has(6)).toBe(false);
  });
});

describe("bestShortestPath", () => {
  it("prefers the chain through famous films and top-billed credits", () => {
    // 1→3 has two 2-link chains: via 2 (famous films) and via 5 (obscure films, low billing).
    expect(bestShortestPath(graph, 1, 3, 3, score)).toEqual([
      { filmId: 100, personId: 2 },
      { filmId: 101, personId: 3 },
    ]);
    expect(bestShortestPath(graph, 1, 4, 3, score)).toHaveLength(3);
  });

  it("returns null when the people are too far apart, unconnected or the same", () => {
    expect(bestShortestPath(graph, 1, 4, 2, score)).toBeNull();
    expect(bestShortestPath(graph, 1, 6, 3, score)).toBeNull();
    expect(bestShortestPath(graph, 1, 1, 3, score)).toBeNull();
  });
});

describe("actorPool", () => {
  it("keeps popular people with enough (leading) credits, most popular first, capped", () => {
    expect(actorPool(graph, people, { size: 10, minFilms: 2, minLeads: 1, leadBilling: 5 })).toEqual([1, 2, 3, 5]);
    // Person 5 is barely known: cut first when the pool shrinks.
    expect(actorPool(graph, people, { size: 3, minFilms: 2, minLeads: 1, leadBilling: 5 })).toEqual([1, 2, 3]);
    expect(actorPool(graph, people, { size: 10, minFilms: 2, minLeads: 2, leadBilling: 5 })).toEqual([2, 3, 5]);
  });
});

describe("pickPuzzle", () => {
  const pool = [1, 2, 3, 4, 5, 6, 7];

  it("finds a pair at the target par with an optimal chain", () => {
    for (let seed = 0; seed < 20; seed++) {
      const picked = pickPuzzle({ graph, pool, rng: createRng([seed, 1, 2, 3]), pars: [2, 3], targetPar: 3, exclude: new Set(), linkScore: score });
      expect(picked).not.toBeNull();
      expect(picked!.par).toBe(picked!.path.length);
      expect(linkDistances(graph, picked!.start, 3).get(picked!.end)).toBe(picked!.par);
      expect(picked!.path.at(-1)!.personId).toBe(picked!.end);
    }
  });

  it("is reproducible for a seed", () => {
    const run = () => pickPuzzle({ graph, pool, rng: createRng([7, 7, 7, 7]), pars: [2, 3], targetPar: 2, exclude: new Set(), linkScore: score });
    expect(run()).toEqual(run());
  });

  it("never uses excluded people and falls back to another par", () => {
    // Without 1 and 5, the only pairs ≥ 2 apart are 2–4 (2 links).
    const picked = pickPuzzle({ graph, pool, rng: createRng([1, 2, 3, 4]), pars: [2, 3], targetPar: 3, exclude: new Set([1, 5]), linkScore: score });
    expect(picked && [picked.start, picked.end].sort()).toEqual([2, 4]);
    expect(picked?.par).toBe(2);
    expect(pickPuzzle({ graph, pool: [6, 7], rng: createRng([1, 2, 3, 4]), pars: [2, 3], targetPar: 2, exclude: new Set(), linkScore: score })).toBeNull();
  });
});
