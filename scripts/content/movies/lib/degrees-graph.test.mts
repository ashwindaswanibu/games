import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import {
  actorPool,
  bestShortestPath,
  buildGraph,
  linkDistances,
  pickPuzzle,
  popularityLinkScore,
  reparDecision,
  type Credit,
  type FilmInfo,
  type PersonInfo,
  isNonFictionFilm,
} from "./degrees-graph.mjs";

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
  [100, 101, 102, 103, 104, 105].map((id) => [id, { id, title: `Film ${id}`, year: 2000, popularity: id >= 103 ? 2 : 80, nonFiction: false }]),
);
const people = new Map<number, PersonInfo>(
  [1, 2, 3, 4, 5, 6, 7].map((id) => [id, { id, name: `Person ${id}`, popularity: id === 5 ? 1 : 60, isActor: true, isHuman: true }]),
);
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
  const options = { size: 10, minFilms: 2, minLeads: 1, leadBilling: 5 };

  it("keeps popular people with enough (leading) credits, most popular first, capped", () => {
    expect(actorPool(graph, people, films, options)).toEqual([1, 2, 3, 5]);
    // Person 5 is barely known: cut first when the pool shrinks.
    expect(actorPool(graph, people, films, { ...options, size: 3 })).toEqual([1, 2, 3]);
    expect(actorPool(graph, people, films, { ...options, minLeads: 2 })).toEqual([2, 3, 5]);
  });

  it("leaves out people who aren't actors (they stay in the graph as links)", () => {
    const withSinger = new Map(people);
    withSinger.set(2, { ...people.get(2)!, popularity: 300, isActor: false });
    expect(actorPool(graph, withSinger, films, options)).toEqual([1, 3, 5]);
    expect(bestShortestPath(graph, 1, 3, 3, popularityLinkScore(graph, films, withSinger))?.[0]?.personId).toBe(2);
  });

  it("leaves out groups and animals (not humans on Wikidata), but not people without a Wikidata item", () => {
    const withGroup = new Map(people);
    withGroup.set(2, { ...people.get(2)!, isHuman: false });
    withGroup.set(3, { ...people.get(3)!, isHuman: null });
    expect(actorPool(graph, withGroup, films, options)).toEqual([1, 3, 5]);
  });

  it("doesn't count documentary or concert-film credits towards the minimums", () => {
    // Person 3: films 101, 102 and 104. With 102 a concert film, two films are left (still enough);
    // with 101 a documentary too, one is left (and person 2, in 100 and 101, drops as well).
    const concert = new Map(films);
    concert.set(102, { ...films.get(102)!, nonFiction: true });
    expect(actorPool(graph, people, concert, options)).toEqual([1, 2, 3, 5]);
    concert.set(101, { ...films.get(101)!, nonFiction: true });
    expect(actorPool(graph, people, concert, options)).toEqual([1, 5]);
    // A documentary 103 leaves person 5 (103, 104) and person 1 (100, 103) one film each.
    const documentary = new Map(films);
    documentary.set(103, { ...films.get(103)!, nonFiction: true });
    expect(actorPool(graph, people, documentary, options)).toEqual([2, 3]);
    // A credit in a non-fiction film is still a link.
    expect(linkDistances(graph, 1, 1).get(5)).toBe(1);
  });
});

describe("isNonFictionFilm", () => {
  it("recognises documentaries and concert films by genre", () => {
    expect(isNonFictionFilm(["Documentary"])).toBe(true);
    expect(isNonFictionFilm(["Drama", "Music documentary"])).toBe(true);
    expect(isNonFictionFilm(["Nature documentary"])).toBe(true);
    expect(isNonFictionFilm(["Documentary television"])).toBe(true);
    expect(isNonFictionFilm(["Concert"])).toBe(true);
    expect(isNonFictionFilm(["concert"])).toBe(true);
  });

  it("leaves fiction alone, including fiction in documentary form", () => {
    expect(isNonFictionFilm([])).toBe(false);
    expect(isNonFictionFilm(["Drama", "Musical"])).toBe(false);
    expect(isNonFictionFilm(["Mockumentary"])).toBe(false);
    expect(isNonFictionFilm(["Pseudo-documentary"])).toBe(false);
    expect(isNonFictionFilm(["Docudrama", "Docufiction"])).toBe(false);
    expect(isNonFictionFilm(["Music"])).toBe(false);
  });
});

describe("reparDecision", () => {
  const day = { par: 3, shortest: 3, intact: true, played: false, fixture: false };

  it("never touches a played day, whatever the graph says now", () => {
    for (const shortest of [1, 2, 3, null]) expect(reparDecision({ ...day, shortest, played: true }, 2, 3)).toEqual({ action: "skip", reason: "played" });
  });

  it("leaves DEV FIXTURE days to the fixture tooling", () => {
    expect(reparDecision({ ...day, shortest: 1, fixture: true }, 2, 3)).toEqual({ action: "skip", reason: "fixture" });
  });

  it("keeps a day whose par is still the shortest chain", () => {
    expect(reparDecision(day, 2, 3)).toEqual({ action: "keep" });
    expect(reparDecision({ ...day, par: 2, shortest: 2 }, 2, 3)).toEqual({ action: "keep" });
  });

  it("lowers par (same start and end) when the shorter chain is still long enough", () => {
    expect(reparDecision({ ...day, shortest: 2 }, 2, 3)).toEqual({ action: "repar", par: 2 });
  });

  it("gives a day a new solution at the same par when its stored chain lost a credit", () => {
    expect(reparDecision({ ...day, par: 2, shortest: 2, intact: false }, 2, 3)).toEqual({ action: "repar", par: 2 });
  });

  it("raises par (same start and end) when the stored chain lost a credit and a longer one is allowed", () => {
    // Eva Green → Cary Grant went through Terror in the Aisles, where Cary Grant is archive footage.
    expect(reparDecision({ ...day, par: 2, shortest: 3 }, 2, 3)).toEqual({ action: "repar", par: 3 });
  });

  it("regenerates the day when start and end are now closer than any allowed par", () => {
    expect(reparDecision({ ...day, shortest: 1 }, 2, 3)).toEqual({ action: "regenerate" });
    expect(reparDecision({ ...day, par: 2, shortest: 1 }, 2, 3)).toEqual({ action: "regenerate" });
    expect(reparDecision({ ...day, shortest: 0 }, 2, 3)).toEqual({ action: "regenerate" });
  });

  it("regenerates the day when start and end are now further apart than any allowed par", () => {
    expect(reparDecision({ ...day, shortest: null }, 2, 3)).toEqual({ action: "regenerate" });
    expect(reparDecision({ ...day, shortest: 4 }, 2, 3)).toEqual({ action: "regenerate" });
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
