import { describe, expect, it } from "vitest";
import { buildCoStarGraph, chainTo, searchFrom, shortestChain } from "./path";

// Films 10–14; people 1–7.
//   1 —10— 2 —11— 3 —12— 4        and a shortcut 1 —13— 5 —14— 4 (two links shorter)
//   6 —14  (6 also in film 14)     7 has no credits.
const credits = [
  { filmId: 10, personId: 1 },
  { filmId: 10, personId: 2 },
  { filmId: 11, personId: 2 },
  { filmId: 11, personId: 3 },
  { filmId: 12, personId: 3 },
  { filmId: 12, personId: 4 },
  { filmId: 13, personId: 1 },
  { filmId: 13, personId: 5 },
  { filmId: 14, personId: 5 },
  { filmId: 14, personId: 4 },
  { filmId: 14, personId: 6 },
];

describe("co-star graph", () => {
  it("finds distances in links", () => {
    const search = searchFrom(buildCoStarGraph(credits), 1, 5);
    expect(Object.fromEntries(search.distance)).toEqual({ 1: 0, 2: 1, 5: 1, 3: 2, 4: 2, 6: 2 });
  });

  it("returns a shortest chain as film → person links", () => {
    expect(shortestChain(buildCoStarGraph(credits), 1, 4, 5)).toEqual([
      { filmId: 13, personId: 5 },
      { filmId: 14, personId: 4 },
    ]);
  });

  it("stops at maxDepth and returns null for unreachable people", () => {
    const graph = buildCoStarGraph(credits);
    expect(shortestChain(graph, 1, 4, 1)).toBeNull();
    expect(shortestChain(graph, 1, 7, 5)).toBeNull();
    expect(chainTo(searchFrom(graph, 1, 0), 1)).toEqual([]);
  });

  it("prefers better-known films among equally short chains", () => {
    // Two one-link routes from 1 to 2: films 10 and 20. Rank 20 higher.
    const twoRoutes = [...credits, { filmId: 20, personId: 1 }, { filmId: 20, personId: 2 }];
    const byDefault = shortestChain(buildCoStarGraph(twoRoutes), 1, 2, 3);
    const ranked = shortestChain(buildCoStarGraph(twoRoutes, { film: (id) => (id === 20 ? 99 : 0) }), 1, 2, 3);
    expect(byDefault).toEqual([{ filmId: 10, personId: 2 }]);
    expect(ranked).toEqual([{ filmId: 20, personId: 2 }]);
  });

  it("ignores duplicate credits", () => {
    const graph = buildCoStarGraph([...credits, { filmId: 10, personId: 1 }]);
    expect(graph.filmsOf.get(1)).toEqual([10, 13]);
  });
});
