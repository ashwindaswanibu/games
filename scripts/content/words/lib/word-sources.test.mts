import { describe, expect, it } from "vitest";
import { definitionOf, parseFrequencyGroups, parseGameList, parseWordNetData, parseWordNetIndex } from "./word-sources.mjs";

describe("12dicts", () => {
  it("reads the game list without its marks, capitals or other characters", () => {
    expect(parseGameList("aah\r\nabaci$\r\nzebra+\r\nAfrica\r\nab\r\nnew-age\r\nrésumé\r\n", 3, 9)).toEqual(["aah", "abaci", "zebra"]);
  });

  it("reads headwords by frequency group, skipping their inflections", () => {
    const text = "----- 1 -----\nbe\n    am, are\nthe\n----- 2 -----\nhouse\n    houses\n";
    expect([...parseFrequencyGroups(text)]).toEqual([["be", 1], ["the", 1], ["house", 2]]);
  });
});

describe("WordNet", () => {
  it("reads an index line: synsets in sense order and how often they were tagged", () => {
    const index = parseWordNetIndex("  1 license line\nanchor n 3 5 @ ~ #p %p + 3 2 02712226 05702197 09812410  \n", "noun");
    expect(index.get("anchor")).toEqual({ pos: "noun", tagged: 2, offsets: ["02712226", "05702197", "09812410"] });
  });

  it("reads a synset's words, usage marks and gloss", () => {
    const line = "10002403 18 n 01 bitch 0 002 @ 10003000 n 0000 ;u 07139048 n 0000 | a person (usually but not necessarily a woman) who is thoroughly disliked";
    const synset = parseWordNetData(line).get("10002403");
    expect(synset).toEqual({ words: ["bitch"], usage: ["07139048"], gloss: "a person (usually but not necessarily a woman) who is thoroughly disliked" });
  });

  it("keeps a definition's first clause, cut near its limit", () => {
    expect(definitionOf('a small boat; propelled by oars; "we rowed"')).toBe("a small boat");
    expect(definitionOf("one two three four five", 12)).toBe("one two…");
    expect(definitionOf('"just an example"')).toBe("");
  });
});
