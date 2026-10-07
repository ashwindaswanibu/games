import { describe, expect, it } from "vitest";
import { catalogSearchKey, catalogSplitKey, matchClass, nameMatchClass, parseScopedSearchParams, rankByQuery, searchKeys } from "./scoped-search";

describe("catalogSearchKey", () => {
  it("lowercases, strips accents and collapses punctuation like the SQL key", () => {
    expect(catalogSearchKey("  Léon: The Professional ")).toBe("leon the professional");
    expect(catalogSearchKey("Ocean's Eleven")).toBe("oceans eleven");
    expect(catalogSearchKey("Emmanuelle Béart")).toBe("emmanuelle beart");
    expect(catalogSearchKey("Mission: Impossible – Fallout")).toBe("mission impossible fallout");
  });

  it("rewrites what SQL's unaccent rewrites beyond accents", () => {
    // Each expected key is what `catalog_search_key` returns in Postgres.
    expect(catalogSearchKey("Bølgen")).toBe("bolgen");
    expect(catalogSearchKey("Æon Flux")).toBe("aeon flux");
    expect(catalogSearchKey("Hababam Sınıfı")).toBe("hababam sinifi");
    expect(catalogSearchKey("Kanał")).toBe("kanal");
    expect(catalogSearchKey("Dýrið")).toBe("dyrid");
    expect(catalogSearchKey("À ma sœur !")).toBe("a ma soeur");
    expect(catalogSearchKey("8½")).toBe("8 1 2");
    expect(catalogSearchKey("The Lion King 1½")).toBe("the lion king 1 1 2");
    expect(catalogSearchKey("Men in Black³")).toBe("men in black");
  });

  it("keeps an apostrophe's word whole, whichever apostrophe it is", () => {
    // "don" must find Don as an exact title, and Don't Look Up only as a longer word's start.
    expect(catalogSearchKey("Don't Look Up")).toBe("dont look up");
    expect(catalogSearchKey("Don’t Look Up")).toBe("dont look up");
    expect(catalogSearchKey("dont look up")).toBe("dont look up");
    expect(catalogSearchKey("Schindler's List")).toBe("schindlers list");
    expect(catalogSearchKey("Peter O'Toole")).toBe("peter otoole");
    expect(catalogSearchKey("Lupita Nyong‘o")).toBe("lupita nyongo");
    // Leading, trailing and quoting apostrophes vanish without joining words.
    expect(catalogSearchKey("'Round Midnight")).toBe("round midnight");
    expect(catalogSearchKey("Singin' in the Rain")).toBe("singin in the rain");
    expect(catalogSearchKey("Rock 'n' Roll High School")).toBe("rock n roll high school");
    // Everything SQL's unaccent turns into an apostrophe: ‛ ′ ＇ and the modifier letters ʹ ʻ ʼ ʽ ˈ, and ŉ ("'n").
    expect(catalogSearchKey("Hawaiʻi Five‛O ′ʹʼʽˈ＇x")).toBe("hawaii fiveo x");
    expect(catalogSearchKey("Rock ŉ Roll")).toBe("rock n roll");
  });
});

describe("catalogSplitKey", () => {
  it("is the search key with apostrophes as spaces, whichever apostrophe it is", () => {
    // Each expected key is what `catalog_split_key` returns in Postgres.
    expect(catalogSplitKey("Don't Look Up")).toBe("don t look up");
    expect(catalogSplitKey("Don’t Look Up")).toBe("don t look up");
    expect(catalogSplitKey("Peter O'Toole")).toBe("peter o toole");
    expect(catalogSplitKey("L'Avventura")).toBe("l avventura");
    expect(catalogSplitKey("Hawaiʻi Five‛O ′ʹʼʽˈ＇x")).toBe("hawai i five o x");
    expect(catalogSplitKey("Rock ŉ Roll")).toBe("rock n roll");
    // Without an apostrophe inside a word, both keys are the same.
    expect(catalogSplitKey("'Round Midnight")).toBe(catalogSearchKey("'Round Midnight"));
    expect(catalogSplitKey("  Léon: The Professional ")).toBe("leon the professional");
    expect(catalogSplitKey("Bølgen")).toBe("bolgen");
  });
});

describe("matchClass", () => {
  it("classifies exact, whole-word starts, mid-word starts, later words and substrings", () => {
    expect(matchClass("heat", "heat")).toBe(0);
    expect(matchClass("stree", "stree 2")).toBe(1);
    expect(matchClass("stree", "street kings")).toBe(2);
    expect(matchClass("godf", "godfather")).toBe(2);
    expect(matchClass("the", "the godfather")).toBe(1);
    expect(matchClass("guide", "the hitchhikers guide to the galaxy")).toBe(3);
    expect(matchClass("stree", "the wolf of wall street")).toBe(4);
    expect(matchClass("father", "the godfather")).toBe(5);
    expect(matchClass("alien", "the godfather")).toBeNull();
    expect(matchClass("", "heat")).toBeNull();
  });

  it("counts a match right after a leading the, a or an as a start", () => {
    expect(matchClass("dark", "the dark knight")).toBe(1);
    expect(matchClass("godfather", "the godfather")).toBe(1);
    expect(matchClass("godf", "the godfather")).toBe(2);
    expect(matchClass("streetcar", "a streetcar named desire")).toBe(1);
    expect(matchClass("american were", "an american werewolf in london")).toBe(2);
    // Only a leading article: "of" isn't one, and "the" inside a name is a later word.
    expect(matchClass("wolf", "of wolf and man")).toBe(3);
    expect(matchClass("king", "the lion king")).toBe(3);
  });

  it("ignores spaces: exact at any length, starts from 3 characters", () => {
    expect(matchClass("xmen", "x men")).toBe(0);
    expect(matchClass("walle", "wall e")).toBe(0);
    expect(matchClass("shahrukh", "shah rukh khan")).toBe(1);
    expect(matchClass("shahru", "shah rukh khan")).toBe(2);
    expect(matchClass("shah rukhkhan", "shah rukh khan")).toBe(0);
    expect(matchClass("it", "i t")).toBe(0);
    // Two characters only match the spaced key, so "it" doesn't find "I, Tonya".
    expect(matchClass("it", "i tonya")).toBeNull();
    expect(matchClass("it", "its a wonderful life")).toBe(2);
    expect(matchClass("ito", "i tonya")).toBe(2);
  });

  it("needs 3 characters for a later word or a substring", () => {
    expect(matchClass("ha", "tom hanks")).toBeNull();
    expect(matchClass("han", "tom hanks")).toBe(4);
    expect(matchClass("hanks", "tom hanks")).toBe(3);
    expect(matchClass("ank", "tom hanks")).toBe(5);
  });
});

describe("nameMatchClass", () => {
  const match = (query: string, name: string) => nameMatchClass(searchKeys(query), searchKeys(name));

  it("finds a word after an apostrophe as a later word, by the split key", () => {
    expect(match("hara", "Maureen O'Hara")).toBe(3);
    expect(match("toole", "Peter O'Toole")).toBe(3);
    expect(match("souza", "Genelia D'Souza")).toBe(3);
    expect(match("avventura", "L'Avventura")).toBe(3);
    expect(match("conn", "Jerry O'Connell")).toBe(4);
    // The query's own split key: "o hara", or "o'hara" against a name written "O Hara".
    expect(match("o hara", "Maureen O'Hara")).toBe(3);
    expect(match("o'hara", "Maureen O Hara")).toBe(3);
    // The search key still matches the joined word.
    expect(match("ohara", "Maureen O'Hara")).toBe(3);
    expect(match("o'neal", "Ryan O'Neal")).toBe(3);
    expect(match("ara", "Maureen O'Hara")).toBe(5);
  });

  it("never makes a start whole at an apostrophe: the search key's word is longer", () => {
    expect(match("don", "Don't Look Up")).toBe(2);
    expect(match("ocean", "Ocean's Eleven")).toBe(2);
    expect(match("it", "It's a Wonderful Life")).toBe(2);
    expect(match("don t", "Don't Look Up")).toBe(1);
    expect(match("dont look up", "Don't Look Up")).toBe(0);
    expect(match("don t look up", "Don't Look Up")).toBe(0);
    expect(match("don’t look up", "Don't Look Up")).toBe(0);
  });

  it("lets a later word end at an apostrophe, as a later whole word", () => {
    expect(match("cuckoo", "One Flew Over the Cuckoo's Nest")).toBe(3);
    expect(match("cuckoos", "One Flew Over the Cuckoo's Nest")).toBe(3);
    expect(match("don", "Boys Don't Cry")).toBe(3);
  });

  it("is matchClass for names and queries without an apostrophe", () => {
    expect(match("stree", "Stree 2")).toBe(1);
    expect(match("stree", "The Wolf of Wall Street")).toBe(4);
    expect(match("alien", "The Godfather")).toBeNull();
  });
});

describe("rankByQuery", () => {
  const films = [
    { id: 1, title: "The Godfather Part II", popularity: 86 },
    { id: 2, title: "The Godfather", popularity: 132 },
    { id: 3, title: "Godfather", popularity: 1 },
    { id: 4, title: "Heat", popularity: 60 },
    { id: 5, title: "Mr. Godfathers", popularity: 999 },
    { id: 6, title: "Sons of the Godfather", popularity: 10 },
  ];
  const rank = (query: string, limit = 8) =>
    rankByQuery(films, query, { text: (f) => f.title, popularity: (f) => f.popularity, limit }).map((f) => f.id);

  it("ranks names that start with the query (after an article too) with the exact name, by popularity and bonus", () => {
    // ln(133) + ln 3 and ln(87) + ln 3 beat ln(2) + ln 30; the later whole word stays below the
    // exact name; the later word that only starts with the query comes last, however popular.
    expect(rank("godfather")).toEqual([2, 1, 3, 6, 5]);
  });

  it("ignores case, punctuation and spaces", () => {
    expect(rank("MR. GODFATHERS")).toEqual([5]);
    // Spaces are ignored for the whole name, not inside later words.
    expect(rank("god-father")).toEqual([2, 1, 3]);
  });

  it("applies the limit", () => {
    expect(rank("godfather", 2)).toEqual([2, 1]);
  });

  it("puts a whole-word start above a mid-word start unless that one has three times the fame", () => {
    const streets = [
      { id: 1, title: "Stree 2", popularity: 20 },
      { id: 2, title: "Street Kings", popularity: 50 },
      { id: 3, title: "Street Fighter", popularity: 200 },
      { id: 4, title: "The Wolf of Wall Street", popularity: 5000 },
    ];
    const ranked = rankByQuery(streets, "stree", { text: (f) => f.title, popularity: (f) => f.popularity, limit: 8 }).map((f) => f.id);
    // ln(21) + ln 3 > ln(51); ln(201) > ln(21) + ln 3; a partial later word comes after every start.
    expect(ranked).toEqual([3, 1, 2, 4]);
  });

  const people = [
    { id: 1, name: "Deepika", popularity: 0 },
    { id: 2, name: "Deepika Padukone", popularity: 89 },
    { id: 3, name: "Deepika Amin", popularity: 14 },
    { id: 4, name: "Shah Rukh Khan", popularity: 136 },
    { id: 5, name: "Salman Khan", popularity: 104 },
    { id: 6, name: "Khan", popularity: 2 },
    { id: 7, name: "Aamir Khanna", popularity: 3 },
  ];
  const rankPeople = (query: string) =>
    rankByQuery(people, query, { text: (p) => p.name, popularity: (p) => p.popularity, limit: 8 }).map((p) => p.id);

  it("ranks by popularity: an exact name wins unless a whole-word start has ten times the popularity", () => {
    // ln(1 + 89) + ln 3 > ln(1 + 0) + ln 30, and so is ln(1 + 14) + ln 3.
    expect(rankPeople("deepika")).toEqual([2, 3, 1]);
    expect(rankPeople("shahrukh")).toEqual([4]);
  });

  it("keeps later whole words below the exact name, and partial later words after them", () => {
    expect(rankPeople("khan")).toEqual([6, 4, 5, 7]);
  });

  it("finds a name by either key: an exact title first, a surname after O' as a later word", () => {
    const names = [
      { id: 1, name: "Don", popularity: 40 },
      { id: 2, name: "Don't Look Up", popularity: 600 },
      { id: 3, name: "Setsuko Hara", popularity: 30 },
      { id: 4, name: "Maureen O'Hara", popularity: 59 },
      { id: 5, name: "Catherine O’Hara", popularity: 72 },
      { id: 6, name: "Pat O Hara", popularity: 1 },
    ];
    const rankNames = (query: string) =>
      rankByQuery(names, query, { text: (n) => n.name, popularity: (n) => n.popularity, limit: 8 }).map((n) => n.id);
    // ln(41) + ln 30 > ln(601): Don't Look Up starts with the longer word "dont". As a whole-word
    // start ("don t") it would have ln(601) + ln 3 and come first.
    expect(rankNames("don")).toEqual([1, 2]);
    expect(rankNames("don't look up")).toEqual([2]);
    expect(rankNames("hara")).toEqual([5, 4, 3, 6]);
    expect(rankNames("o'hara")).toEqual([5, 4, 6]);
    // As typed, "o hara" is also a substring of "setsuko hara" (both keys alike, as before).
    expect(rankNames("o hara")).toEqual([5, 4, 6, 3]);
    expect(rankNames("ohara")).toEqual([5, 4]);
  });
});

describe("parseScopedSearchParams", () => {
  const parse = (query: string, scope: "person" | "film" = "person") => parseScopedSearchParams(new URLSearchParams(query), scope);

  it("parses a scope id, query and limit", () => {
    expect(parse("person=12&q=heat&limit=5")).toEqual({ person: 12, q: "heat", limit: 5 });
    expect(parse("film=7&q=  de niro ", "film")).toEqual({ film: 7, q: "de niro", limit: 8 });
    expect(parse("person=12&q=heat&limit=")).toEqual({ person: 12, q: "heat", limit: 8 });
  });

  it("refuses missing, malformed or repeated values", () => {
    for (const bad of [
      "q=heat",
      "person=&q=heat",
      "person=0&q=heat",
      "person=-3&q=heat",
      "person=1.5&q=heat",
      "person=1e3&q=heat",
      "person=0x10&q=heat",
      "person=12",
      "person=12&q=h",
      "person=12&q=heat&limit=21",
      "person=12&person=13&q=heat",
      "person=12&q=heat&q=alien",
      "person=99999999999&q=heat",
    ]) {
      expect(parse(bad), bad).toBeNull();
    }
    expect(parse("person=12&q=heat", "film")).toBeNull();
  });
});
