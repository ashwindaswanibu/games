import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isPuzzleDate, nextRollover, parsePuzzleDate, startOfDay, today, wallClockAt, weekStart } from "./day";

const d = parsePuzzleDate;

describe("today", () => {
  it("rolls over at midnight New York time, not UTC", () => {
    // 03:59 UTC on Oct 6 is 23:59 EDT on Oct 5.
    expect(today(new Date("2026-10-06T03:59:59Z"))).toBe("2026-10-05");
    expect(today(new Date("2026-10-06T04:00:00Z"))).toBe("2026-10-06");
  });

  it("uses EST (UTC-5) in winter", () => {
    expect(today(new Date("2026-12-01T04:59:59Z"))).toBe("2026-11-30");
    expect(today(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
  });
});

describe("startOfDay", () => {
  it("handles both sides of the DST transitions", () => {
    expect(startOfDay(d("2026-03-08")).toISOString()).toBe("2026-03-08T05:00:00.000Z"); // DST starts 2am that day
    expect(startOfDay(d("2026-03-09")).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(startOfDay(d("2026-11-01")).toISOString()).toBe("2026-11-01T04:00:00.000Z"); // DST ends 2am that day
    expect(startOfDay(d("2026-11-02")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("round-trips with today()", () => {
    for (let i = 0; i < 400; i++) {
      const date = addDays(d("2026-01-01"), i);
      const start = startOfDay(date);
      expect(today(start)).toBe(date);
      expect(today(new Date(start.getTime() - 1))).toBe(addDays(date, -1));
    }
  });
});

describe("wallClockAt", () => {
  const ny = (at: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(at);

  it("reads New York's wall clock on ordinary days", () => {
    expect(ny(wallClockAt(d("2026-10-07"), 13 * 60 + 40))).toBe("13:40 EDT");
    expect(ny(wallClockAt(d("2026-01-15"), 0))).toBe("00:00 EST");
  });

  it("carries the shift on the 23- and 25-hour days", () => {
    expect(ny(wallClockAt(d("2026-03-08"), 60 + 30))).toBe("01:30 EST");
    expect(ny(wallClockAt(d("2026-03-08"), 3 * 60))).toBe("03:00 EDT");
    expect(ny(wallClockAt(d("2026-03-08"), 22 * 60 + 50))).toBe("22:50 EDT");
    expect(ny(wallClockAt(d("2026-11-01"), 60 + 30))).toBe("01:30 EDT");
    expect(ny(wallClockAt(d("2026-11-01"), 2 * 60))).toBe("02:00 EST");
    expect(ny(wallClockAt(d("2026-11-01"), 22 * 60 + 50))).toBe("22:50 EST");
  });
});

describe("nextRollover", () => {
  it("is the next New York midnight", () => {
    expect(nextRollover(new Date("2026-10-05T19:00:00Z")).toISOString()).toBe("2026-10-06T04:00:00.000Z");
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2028-03-01"), -1)).toBe("2028-02-29");
    expect(daysBetween(d("2026-10-01"), d("2026-10-05"))).toBe(4);
  });

  it("finds the Monday of the week", () => {
    expect(weekStart(d("2026-10-05"))).toBe("2026-10-05"); // Monday
    expect(weekStart(d("2026-10-11"))).toBe("2026-10-05"); // Sunday
    expect(weekStart(d("2026-10-04"))).toBe("2026-09-28");
  });

  it("validates date strings", () => {
    expect(isPuzzleDate("2026-02-29")).toBe(false);
    expect(isPuzzleDate("2026-1-05")).toBe(false);
    expect(isPuzzleDate("2028-02-29")).toBe(true);
    expect(() => parsePuzzleDate("nope")).toThrow();
  });
});
