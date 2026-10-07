import { describe, expect, it } from "vitest";
import type { HomeView } from "@/core/home-view";
import { composeHome } from "./composition";
import { dialRim, dialSector } from "./geometry";
import { DAY_INK, DAY_LSB, DAY_RSB, MONTH_ADVANCE } from "./type-metrics";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function view(date: string, month = "October", dayOfMonth = 7): Pick<HomeView, "day" | "buckets"> {
  return {
    day: { date: date as HomeView["day"]["date"], weekday: "Wednesday", month, dayOfMonth, nextWeekday: "Thursday" },
    buckets: [
      { id: "words", name: "Words", status: "open", testingOnly: false, leader: null, games: [] },
      { id: "movies", name: "Movies", status: "in_production", testingOnly: false, leader: null, games: [] },
    ],
  };
}

describe("composeHome", () => {
  it("is the same picture for the same day, and a different one the next", () => {
    expect(composeHome(view("2026-10-07"))).toEqual(composeHome(view("2026-10-07")));
    expect(composeHome(view("2026-10-08")).strip).not.toEqual(composeHome(view("2026-10-07")).strip);
  });

  it("has League Gothic metrics for every month and day", () => {
    for (const m of MONTHS) expect(MONTH_ADVANCE[m.toUpperCase()]).toBeGreaterThan(1);
    for (let d = 1; d <= 31; d++) {
      expect(DAY_INK[String(d)]).toBeGreaterThan(0.1);
      expect(DAY_LSB[String(d)]).toBeGreaterThanOrEqual(0);
      expect(DAY_RSB[String(d)]).toBeGreaterThanOrEqual(0);
    }
    expect(composeHome(view("2026-09-23", "September", 23)).type.dayInk).toBe(DAY_INK["23"]);
  });

  it("keeps the band and the strip inside their seeded ranges", () => {
    for (const date of ["2026-01-01", "2026-06-30", "2026-10-07", "2027-02-28"]) {
      const c = composeHome(view(date));
      const band = parseFloat(c.band.rotate);
      expect(band).toBeLessThanOrEqual(-1);
      expect(band).toBeGreaterThanOrEqual(-2.2);
      const left = parseFloat(c.strip.left);
      expect(left).toBeGreaterThanOrEqual(26);
      expect(left).toBeLessThanOrEqual(34);
      expect(c.vanishX).toBeGreaterThanOrEqual(0.58);
      expect(c.vanishX).toBeLessThanOrEqual(0.66);
    }
  });
});

describe("the dial", () => {
  const rim = dialRim("2026-10-07:dial");
  it("is the whole disc at midnight, nothing at the next, a sector between", () => {
    expect(dialSector(0, rim)).toMatch(/^M/);
    expect(dialSector(1, rim)).toBe("");
    const late = dialSector(23 / 24, rim);
    const early = dialSector(1 / 24, rim);
    expect(late.length).toBeLessThan(early.length);
  });
});
