import { describe, expect, it } from "vitest";
import { medianDailyViews, mergeQueries, viewsByTitle } from "./fame.mjs";

describe("medianDailyViews", () => {
  it("takes the median of the days that have a count", () => {
    expect(medianDailyViews({ a: 10, b: 30, c: 20 })).toBe(20);
    expect(medianDailyViews({ a: 10, b: 30, c: null, d: 20, e: 40 })).toBe(25);
    // A day of news barely moves it.
    expect(medianDailyViews({ a: 100, b: 110, c: 90, d: 50_000 })).toBe(105);
  });

  it("is 0 without counts", () => {
    expect(medianDailyViews({})).toBe(0);
    expect(medianDailyViews({ a: null })).toBe(0);
    expect(medianDailyViews(undefined)).toBe(0);
  });
});

describe("viewsByTitle", () => {
  it("follows normalisations and redirects back to the asked titles", () => {
    const views = viewsByTitle(["Riz_Ahmed", "Old Name", "Nobody"], {
      normalized: [{ from: "Riz_Ahmed", to: "Riz Ahmed" }],
      redirects: [{ from: "Old Name", to: "New Name" }],
      pages: [
        { title: "Riz Ahmed", pageviews: { "2026-10-01": 3000, "2026-10-02": 4000, "2026-10-03": 3500 } },
        { title: "New Name", pageviews: { "2026-10-01": 12 } },
        { title: "Nobody", missing: true },
      ],
    });
    expect(Object.fromEntries(views)).toEqual({ Riz_Ahmed: 3500, "Old Name": 12, Nobody: 0 });
  });
});

describe("mergeQueries", () => {
  it("keeps each page's counted part across the parts of an answer", () => {
    const merged = mergeQueries([
      { normalized: [{ from: "Riz_Ahmed", to: "Riz Ahmed" }], pages: [{ title: "Riz Ahmed", pageviews: { a: 10 } }, { title: "Kathy Bates" }] },
      { pages: [{ title: "Riz Ahmed" }, { title: "Kathy Bates", pageviews: { a: 20 } }] },
    ]);
    expect(Object.fromEntries(viewsByTitle(["Riz_Ahmed", "Kathy Bates"], merged))).toEqual({ Riz_Ahmed: 10, "Kathy Bates": 20 });
  });
});
