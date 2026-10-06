import type { Clue, FilmGuess } from "./schemas";

/** match: the attribute matches; near: points the right way; miss: doesn't match; unknown: no data. */
export type ClueTone = "match" | "near" | "miss" | "unknown";

export interface ClueText {
  tone: ClueTone;
  /** A shape that carries the meaning without color. */
  glyph: string;
  /** The chip's words: short enough for one line on a phone. */
  text: string;
  /**
   * The same clue in full, for screen readers and announcements. Differs from `text` only when
   * the chip abbreviates (a long list of shared genres).
   */
  fullText: string;
}

/** Shared genres a chip names before it switches to "+N". */
export const CHIP_GENRES = 2;

/**
 * Shared genres without the ones a more specific shared genre already says: "Crime" and "Drama"
 * go when "Crime drama" is also shared. Order is kept.
 */
export function distinctGenres(genres: readonly string[]): string[] {
  const words = genres.map((g) => g.toLowerCase().split(/\s+/).filter(Boolean));
  return genres.filter(
    (_, i) => !words.some((other, j) => j !== i && other.length > words[i].length && words[i].every((w) => other.includes(w))),
  );
}

const andList = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function clue(tone: ClueTone, glyph: string, text: string, fullText = text): ClueText {
  return { tone, glyph, text, fullText };
}

/** How each clue reads. Exported for games that want the same wording elsewhere. */
export function describeClue(c: Clue): ClueText {
  switch (c.kind) {
    case "year": {
      const byDirection: Record<typeof c.direction, ClueText> = {
        later: clue("near", "↑", `After ${c.guessYear}`),
        earlier: clue("near", "↓", `Before ${c.guessYear}`),
        same: clue("match", "=", `Same year · ${c.guessYear}`, `Same year, ${c.guessYear}`),
        unknown: clue("unknown", "?", "Year unknown"),
      };
      return byDirection[c.direction];
    }
    case "decade": {
      const byMatch: Record<typeof c.match, ClueText> = {
        same: clue("match", "■", `Same decade · ${c.guessDecade}s`, `Same decade, the ${c.guessDecade}s`),
        different: clue("miss", "□", `Not the ${c.guessDecade}s`),
        unknown: clue("unknown", "?", "Decade unknown"),
      };
      return byMatch[c.match];
    }
    case "genres": {
      if (c.match !== "some") {
        return c.match === "none" ? clue("miss", "◇", "No shared genre") : clue("unknown", "?", "Genres unknown");
      }
      const genres = distinctGenres(c.shared);
      const extra = genres.length - CHIP_GENRES;
      const text = `Shares ${genres.slice(0, CHIP_GENRES).join(" · ")}${extra > 0 ? ` +${extra}` : ""}`;
      return clue("near", "◆", text, `Shares ${andList(genres)}`);
    }
    case "director": {
      const byMatch: Record<typeof c.match, ClueText> = {
        same: clue("match", "●", `Same director · ${c.shared.join(" & ")}`, `Same director, ${andList(c.shared)}`),
        different: clue("miss", "○", "Different director"),
        unknown: clue("unknown", "?", "Director unknown"),
      };
      return byMatch[c.match];
    }
  }
}

/** All of a guess's clues as one spoken sentence, e.g. "Before 1994; shares Comedy and Drama; different director." */
export function spokenClues(clues: readonly Clue[]): string {
  if (clues.length === 0) return "";
  const parts = clues.map((c, i) => {
    const text = describeClue(c).fullText;
    return i === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
  });
  return `${parts.join("; ")}.`;
}

/** One guess-log entry as a spoken sentence, e.g. "Heat isn't it. Before 1995; different director." */
export function spokenGuess(entry: FilmGuess | { skipped: true }): string {
  if ("skipped" in entry) return "Skipped.";
  if (entry.correct) return `${entry.film.title} is right.`;
  return [`${entry.film.title} isn't it.`, spokenClues(entry.clues)].filter(Boolean).join(" ");
}
