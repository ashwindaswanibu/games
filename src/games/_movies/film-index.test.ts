import { describe, expect, it } from "vitest";
import { addFilmIndexPart, emptyFilmIndex, nameKeys, searchFilmIndex, type FilmIndexPart } from "./film-index";
import { catalogNumberKey, catalogSearchKey, catalogSplitKey } from "./search-key";

// [id, year, directors, fame, [display title, other names…]], fame as SQL stores it (ln of votes).
const PART: FilmIndexPart = [
  [1, 2006, ["Farhan Akhtar"], 10.5, ["Don"]],
  [2, 2021, ["Adam McKay"], 13.1, ["Don't Look Up"]],
  [3, 2001, ["Richard Kelly"], 13.5, ["Donnie Darko"]],
  [4, 1972, ["Francis Ford Coppola"], 14.6, ["The Godfather", "Godfather"]],
  [5, 1974, ["Francis Ford Coppola"], 14.0, ["The Godfather Part II", "Godfather Part 2"]],
  [6, 2000, ["Bryan Singer"], 13.3, ["X-Men"]],
  [7, 2001, ["Karan Johar"], 11.0, ["Kabhi Khushi Kabhie Gham...", "K3G"]],
  [8, 2008, ["Christopher Nolan"], 14.9, ["The Dark Knight"]],
  [9, 2010, ["Garth Davis"], 8.0, ["A Darker Shade"]],
];

const index = emptyFilmIndex();
addFilmIndexPart(index, PART);
const titles = (query: string, limit = 8) => searchFilmIndex(index, query, limit).map((hit) => hit.title);

describe("searchFilmIndex", () => {
  it("puts an exact title first, ahead of better-known films that start with it", () => {
    expect(titles("don")).toEqual(["Don", "Donnie Darko", "Don't Look Up"]);
  });

  it("treats an apostrophe as part of its word", () => {
    expect(titles("dont look up")).toEqual(["Don't Look Up"]);
    expect(titles("don't look up")).toEqual(["Don't Look Up"]);
  });

  it("matches across spaces and punctuation from 3 characters", () => {
    expect(titles("xmen")).toEqual(["X-Men"]);
  });

  it("matches after a leading article: whole words, then partial starts, then later words", () => {
    expect(titles("dark")).toEqual(["The Dark Knight", "A Darker Shade", "Donnie Darko"]);
  });

  it("matches sequel numbers either way, and says which name matched", () => {
    const hits = searchFilmIndex(index, "godfather 2", 8);
    expect(hits[0]).toMatchObject({ id: 5, title: "The Godfather Part II" });
    expect(searchFilmIndex(index, "k3g", 8)).toEqual([{ id: 7, title: "Kabhi Khushi Kabhie Gham...", year: 2001, directors: ["Karan Johar"], aka: "K3G" }]);
  });

  it("returns nothing for an empty query, and respects the limit", () => {
    expect(titles("  ")).toEqual([]);
    expect(titles("do", 1)).toHaveLength(1);
  });
});

describe("nameKeys", () => {
  it("gives the same keys as catalogSearchKey and catalogSplitKey, plain or not", () => {
    for (const name of ["Don't Look Up", "Ocean's Eleven", "WALL·E", "Amélie", "8½", "Bølgen", "  The  Matrix!  ", "O’Hara"]) {
      expect(nameKeys(name)).toEqual({ key: catalogSearchKey(name), split: catalogSplitKey(name) });
    }
  });
});

describe("catalogNumberKey", () => {
  it("writes sequel numbering as digits, like SQL catalog_number_key", () => {
    expect(catalogNumberKey("the godfather part ii")).toBe("the godfather 2");
    expect(catalogNumberKey("kill bill vol 1")).toBe("kill bill 1");
    expect(catalogNumberKey("rocky ii")).toBe("rocky 2");
    expect(catalogNumberKey("dune part two")).toBe("dune 2");
  });

  it("leaves lone letters and plain names alone", () => {
    expect(catalogNumberKey("malcolm x")).toBe("malcolm x");
    expect(catalogNumberKey("i robot")).toBe("i robot");
    expect(catalogNumberKey("the matrix")).toBe("the matrix");
  });
});
