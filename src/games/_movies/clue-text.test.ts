import { describe, expect, it } from "vitest";
import { describeClue, distinctGenres, spokenClues, spokenGuess } from "./clue-text";
import { computeClues } from "./hints";

describe("describeClue", () => {
  it("words each clue and pairs it with a non-color glyph", () => {
    const heat = {
      year: 1995,
      genres: ["Crime", "Thriller"],
      directors: ["Michael Mann"],
    };
    const collateral = {
      year: 2004,
      genres: ["Thriller"],
      directors: ["Michael Mann"],
    };
    expect(computeClues(heat, collateral, ["year", "decade", "genres", "director"]).map(describeClue)).toEqual([
      { tone: "near", glyph: "↑", text: "After 1995", fullText: "After 1995" },
      {
        tone: "miss",
        glyph: "□",
        text: "Not the 1990s",
        fullText: "Not the 1990s",
      },
      {
        tone: "near",
        glyph: "◆",
        text: "Shares Thriller",
        fullText: "Shares Thriller",
      },
      {
        tone: "match",
        glyph: "●",
        text: "Same director · Michael Mann",
        fullText: "Same director, Michael Mann",
      },
    ]);
  });

  it("says when it doesn't know", () => {
    const blank = { year: null, genres: [], directors: [] };
    const texts = computeClues(blank, blank, ["year", "decade", "genres", "director"]).map(describeClue);
    expect(texts.every((t) => t.tone === "unknown" && t.glyph === "?")).toBe(true);
  });

  it("gives every tone a distinct glyph per clue kind", () => {
    expect(describeClue({ kind: "year", guessYear: 2000, direction: "earlier" }).glyph).toBe("↓");
    expect(describeClue({ kind: "year", guessYear: 2000, direction: "same" }).tone).toBe("match");
    expect(describeClue({ kind: "director", shared: [], match: "different" })).toEqual({
      tone: "miss",
      glyph: "○",
      text: "Different director",
      fullText: "Different director",
    });
  });
});

describe("shared genres", () => {
  it("drops a genre that a more specific shared genre already names", () => {
    expect(distinctGenres(["Epic", "Crime", "Drama", "Crime drama", "Historical", "Historical drama"])).toEqual([
      "Epic",
      "Crime drama",
      "Historical drama",
    ]);
    expect(distinctGenres(["comedy", "black comedy", "crime film"])).toEqual(["black comedy", "crime film"]);
    expect(distinctGenres(["Drama", "drama"])).toEqual(["Drama", "drama"]);
  });

  it("says 'Shares', names two genres on the chip and keeps the full list for screen readers", () => {
    const chip = describeClue({
      kind: "genres",
      match: "some",
      shared: ["Epic", "Crime", "Drama", "Crime drama", "Historical", "Historical drama"],
    });
    expect(chip.text).toBe("Shares Epic · Crime drama +1");
    expect(chip.fullText).toBe("Shares Epic, Crime drama and Historical drama");
    expect(
      describeClue({
        kind: "genres",
        match: "some",
        shared: ["Comedy", "Drama"],
      }).text,
    ).toBe("Shares Comedy · Drama");
  });
});

describe("spoken text", () => {
  it("reads every clue of a miss as one sentence", () => {
    const heat = {
      year: 1995,
      genres: ["Crime", "Thriller"],
      directors: ["Michael Mann"],
    };
    const fargo = {
      year: 1996,
      genres: ["Crime", "Comedy"],
      directors: ["Joel Coen", "Ethan Coen"],
    };
    const clues = computeClues(heat, fargo, ["year", "genres", "director"]);
    expect(spokenClues(clues)).toBe("After 1995; shares Crime; different director.");
    expect(
      spokenGuess({
        film: { id: 1, title: "Heat", year: 1995 },
        correct: false,
        clues,
      }),
    ).toBe("Heat isn't it. After 1995; shares Crime; different director.");
    expect(
      spokenGuess({
        film: { id: 2, title: "Fargo", year: 1996 },
        correct: true,
        clues: [],
      }),
    ).toBe("Fargo is right.");
    expect(spokenGuess({ skipped: true })).toBe("Skipped.");
  });
});
