import { describe, expect, it } from "vitest";
import { boolCell, CATALOG_QUERIES, CsvParser, csvRows, intCell, parseCsv, qidOf } from "./qlever.mjs";

describe("CSV", () => {
  it("parses quoted fields with commas, quotes and newlines, LF or CRLF", () => {
    expect(parseCsv('film,alias\r\nQ1,"Crouching Tiger, Hidden Dragon"\r\nQ2,"The ""Best"" Film"\nQ3,"two\nlines"\nQ4,\n')).toEqual([
      ["film", "alias"],
      ["Q1", "Crouching Tiger, Hidden Dragon"],
      ["Q2", 'The "Best" Film'],
      ["Q3", "two\nlines"],
      ["Q4", ""],
    ]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\n\n")).toEqual([["a", "b"]]);
  });

  it("gives the same records however the input is chunked", () => {
    const text = 'item,en\nQ1,"Amélie, ""la"" fabuleuse"\r\nQ2,plain\nQ3,"x\r\ny"\n';
    const whole = parseCsv(text);
    for (let size = 1; size <= 7; size++) {
      const out: string[][] = [];
      const parser = new CsvParser((record) => out.push(record));
      for (let i = 0; i < text.length; i += size) parser.push(text.slice(i, i + size));
      parser.end();
      expect(out).toEqual(whole);
    }
  });

  it("refuses unterminated quotes", () => {
    expect(() => parseCsv('a,"b')).toThrow(/quoted/);
  });

  it("checks the header and the field count", () => {
    const rows: Record<string, string>[] = [];
    const onRecord = csvRows(["item", "year"], (row) => rows.push(row));
    onRecord(["item", "year"]);
    onRecord(["http://www.wikidata.org/entity/Q1", "1999"]);
    expect(rows).toEqual([{ item: "http://www.wikidata.org/entity/Q1", year: "1999" }]);
    expect(() => onRecord(["only one"])).toThrow(/fields/);
    expect(() => csvRows(["item", "year"], () => undefined)(["item", "date"])).toThrow(/header/);
  });
});

describe("values", () => {
  it("reads entity ids and integers", () => {
    expect(qidOf("http://www.wikidata.org/entity/Q47703")).toBe("Q47703");
    expect(qidOf("http://www.wikidata.org/.well-known/genid/0027dc71")).toBeNull();
    expect(qidOf("http://www.wikidata.org/entity/P31")).toBeNull();
    expect(intCell("132")).toBe(132);
    expect(intCell("")).toBeNull();
    expect(intCell("1.5")).toBeNull();
    expect(intCell(undefined)).toBeNull();
  });

  it("reads booleans as QLever writes them, and nothing else", () => {
    expect(boolCell("true")).toBe(true);
    expect(boolCell("false")).toBe(false);
    expect(boolCell("1")).toBeNull();
    expect(boolCell("TRUE")).toBeNull();
    expect(boolCell("")).toBeNull();
    expect(boolCell(undefined)).toBeNull();
  });

  it("selects exactly the columns each query declares", () => {
    for (const query of Object.values(CATALOG_QUERIES)) {
      const select = /SELECT(?: DISTINCT)? ([\s\S]+?) WHERE/.exec(query.sparql)![1]!;
      const variables = [...select.matchAll(/\?(\w+)\)?(?:\s|$)/g)].map((m) => m[1]);
      // `(MIN(YEAR(?date)) AS ?year)` selects ?year, not ?date.
      expect(variables.filter((v) => !/^date$/.test(v!))).toEqual([...query.columns]);
    }
  });
});
