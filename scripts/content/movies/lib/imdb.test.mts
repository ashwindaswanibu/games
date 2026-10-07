import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  forEachGzipLine,
  formatNconst,
  formatTconst,
  IntTable,
  lineTconst,
  parseCrewLine,
  parseNameLine,
  parseNconst,
  parsePrincipalLine,
  parseRatingLine,
  parseTconst,
  parseTitleLine,
  tsvFields,
} from "./imdb.mjs";

describe("ids", () => {
  it("round-trips canonical ids only", () => {
    expect(parseTconst("tt0068646")).toBe(68646);
    expect(formatTconst(68646)).toBe("tt0068646");
    expect(parseTconst("tt12345678")).toBe(12345678);
    expect(formatTconst(12345678)).toBe("tt12345678");
    expect(parseNconst("nm0000138")).toBe(138);
    expect(formatNconst(138)).toBe("nm0000138");
    // Not canonical: too short, unpadded, wrong prefix, or a padded 8-digit spelling.
    for (const bad of ["tt123", "tt68646", "nm0068646", "tt00068646", "", null, undefined]) expect(parseTconst(bad)).toBeNull();
    expect(parseNconst("tt0000138")).toBeNull();
  });
});

describe("lines", () => {
  it("reads IMDb's \\N as null", () => {
    expect(tsvFields("a\t\\N\tc")).toEqual(["a", null, "c"]);
  });

  it("parses ratings", () => {
    expect(parseRatingLine("tt0068646\t9.2\t2154321")).toEqual({ tconst: 68646, votes: 2154321 });
    expect(parseRatingLine("tconst\taverageRating\tnumVotes")).toBeNull();
  });

  it("parses titles", () => {
    expect(parseTitleLine("tt0248126\tmovie\tKabhi Khushi Kabhie Gham...\tKabhi Khushi Kabhie Gham...\t0\t2001\t\\N\t210\tDrama,Family,Musical")).toEqual({
      tconst: 248126,
      type: "movie",
      primaryTitle: "Kabhi Khushi Kabhie Gham...",
      originalTitle: "Kabhi Khushi Kabhie Gham...",
      isAdult: false,
      startYear: 2001,
      runtimeMinutes: 210,
      genres: ["Drama", "Family", "Musical"],
    });
    const unknown = parseTitleLine("tt9999999\tvideo\tX\t\\N\t1\t\\N\t\\N\t\\N\t\\N");
    expect(unknown).toMatchObject({ originalTitle: "X", isAdult: true, startYear: null, runtimeMinutes: null, genres: [] });
    expect(parseTitleLine("tt9999999\tmovie")).toBeNull();
    expect(lineTconst("tt0248126\tmovie\t…")).toBe(248126);
    expect(lineTconst("tconst\ttitleType")).toBeNull();
  });

  it("parses principals, crew and names", () => {
    expect(parsePrincipalLine("tt0068646\t1\tnm0000008\tactor\t\\N\t[\"Don Vito Corleone\"]")).toEqual({ tconst: 68646, ordering: 1, nconst: 8, category: "actor" });
    expect(parsePrincipalLine("tt0068646\tx\tnm0000008\tactor\t\\N\t\\N")).toBeNull();
    expect(parseCrewLine("tt0133093\tnm0905154,nm0905152,nm0905154\tnm0905152")).toEqual({ tconst: 133093, directors: [905154, 905152] });
    expect(parseCrewLine("tt0133093\t\\N\t\\N")).toEqual({ tconst: 133093, directors: [] });
    expect(parseNameLine("nm0451321\tShah Rukh Khan\t1965\t\\N\tactor,producer\ttt0112870")).toEqual({ nconst: 451321, name: "Shah Rukh Khan" });
  });
});

describe("IntTable", () => {
  it("looks up keys from unsorted input; a repeated key keeps its last value", () => {
    const table = IntTable.fromArrays([30, 10, 20, 10], [3, 1, 2, 9]);
    expect(table.size).toBe(3);
    expect(table.get(10)).toBe(9);
    expect(table.get(20)).toBe(2);
    expect(table.get(30)).toBe(3);
    expect(table.get(15)).toBeUndefined();
    expect([...table.entries()]).toEqual([
      [10, 9],
      [20, 2],
      [30, 3],
    ]);
  });
});

describe("forEachGzipLine", () => {
  const dir = mkdtemp(join(tmpdir(), "imdb-test-"));
  afterAll(async () => rm(await dir, { recursive: true, force: true }));

  it("streams every line after the header, across chunk boundaries and CRLF", async () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => `tt${String(i).padStart(7, "0")}\tTitle ${i} — ünïcödé`);
    const path = join(await dir, "test.tsv.gz");
    await writeFile(path, gzipSync(`header\tline\r\n${lines.join("\n")}`));
    const seen: string[] = [];
    expect(await forEachGzipLine(path, (line) => seen.push(line))).toBe(lines.length);
    expect(seen).toEqual(lines);
  });
});
