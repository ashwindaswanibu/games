import { describe, expect, it } from "vitest";
import { matchWikidataItems } from "./catalog-build.mjs";

describe("matchWikidataItems", () => {
  it("pairs each film with one item and each item with one film, best known first", () => {
    const matched = matchWikidataItems([
      // Two items claim the same IMDb film: the one with more Wikipedia editions wins.
      { qid: "Q1", tconst: 10, links: 50, votes: 900 },
      { qid: "Q2", tconst: 10, links: 3, votes: 900 },
      // One item lists two IMDb films: the film with more votes gets it.
      { qid: "Q3", tconst: 20, links: 20, votes: 100 },
      { qid: "Q3", tconst: 21, links: 20, votes: 5000 },
    ]);
    expect(matched).toEqual(
      new Map([
        [10, "Q1"],
        [21, "Q3"],
      ]),
    );
  });

  it("keeps a pairing the catalog already stores", () => {
    const pairs = [
      { qid: "Q1", tconst: 10, links: 50, votes: 900 },
      { qid: "Q2", tconst: 10, links: 3, votes: 900 },
    ];
    expect(matchWikidataItems(pairs, [{ qid: "Q2", tconst: 10 }])).toEqual(new Map([[10, "Q2"]]));
    // A stored pairing the sources no longer support is ignored.
    expect(matchWikidataItems(pairs, [{ qid: "Q9", tconst: 10 }])).toEqual(new Map([[10, "Q1"]]));
  });
});
