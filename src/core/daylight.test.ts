import { describe, expect, it } from "vitest";
import { addDays, parsePuzzleDate, puzzleDateAt, startOfDay } from "./day";
import { cueAt, cueBoundaries, homeClock, nextCueChange, sunTimes, TWILIGHT_MS, wallClockNoon } from "./daylight";

const nyClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
/** "06:59 EDT": New York wall-clock time and zone at an instant. */
const ny = (instant: Date) => nyClock.format(instant);
/** Minutes after New York midnight on `date`, by the wall clock. */
function wallMinutes(instant: Date): number {
  const [h, m] = ny(instant).split(" ")[0].split(":").map(Number);
  return h * 60 + m;
}

/** Within `tolerance` minutes of `hh:mm` on the New York wall clock. */
function expectNear(instant: Date, hhmm: string, tolerance = 2) {
  const [h, m] = hhmm.split(":").map(Number);
  expect(Math.abs(wallMinutes(instant) - (h * 60 + m))).toBeLessThanOrEqual(tolerance);
}

const d = parsePuzzleDate;

describe("sunTimes (New York, NOAA)", () => {
  // Reference values: NOAA Solar Calculator / USNO for 40.7128 N, 74.006 W.
  it.each([
    ["2026-10-07", "06:59", "12:44", "18:28", "EDT"],
    ["2026-12-21", "07:17", "11:54", "16:32", "EST"],
    ["2026-06-21", "05:25", "12:58", "20:31", "EDT"],
    ["2026-03-20", "06:59", "13:03", "19:08", "EDT"],
    ["2026-01-01", "07:20", "12:00", "16:39", "EST"],
  ])("%s: sunrise %s, solar noon %s, sunset %s %s", (date, rise, noon, set, zone) => {
    const sun = sunTimes(d(date));
    expectNear(sun.sunrise, rise);
    expectNear(sun.solarNoon, noon);
    expectNear(sun.sunset, set);
    for (const instant of [sun.sunrise, sun.solarNoon, sun.sunset]) {
      expect(puzzleDateAt(instant)).toBe(date);
      expect(ny(instant)).toContain(zone);
    }
  });

  it("is right on both daylight-saving days (the clock moves at 2 AM, before sunrise)", () => {
    // Spring forward: sunrise is an hour later on the clock than the day before.
    const before = sunTimes(d("2026-03-07"));
    const spring = sunTimes(d("2026-03-08"));
    expect(ny(before.sunrise)).toContain("EST");
    expect(ny(spring.sunrise)).toContain("EDT");
    expect(wallMinutes(spring.sunrise) - wallMinutes(before.sunrise)).toBeGreaterThan(55);
    expect(wallMinutes(spring.sunrise) - wallMinutes(before.sunrise)).toBeLessThan(60);
    expectNear(spring.sunrise, "07:19");
    expectNear(spring.sunset, "18:55");

    // Fall back: sunrise is an hour earlier on the clock than the day before.
    const saturday = sunTimes(d("2026-10-31"));
    const fall = sunTimes(d("2026-11-01"));
    expect(ny(saturday.sunrise)).toContain("EDT");
    expect(ny(fall.sunrise)).toContain("EST");
    expect(wallMinutes(saturday.sunrise) - wallMinutes(fall.sunrise)).toBeGreaterThan(57);
    expect(wallMinutes(saturday.sunrise) - wallMinutes(fall.sunrise)).toBeLessThan(61);
    expectNear(fall.sunrise, "06:26");
    expectNear(fall.sunset, "16:52");
  });

  it("moves smoothly from day to day over a whole year (no jumps but DST's hour)", () => {
    let prev = sunTimes(d("2026-01-01"));
    for (let i = 1; i <= 365; i++) {
      const sun = sunTimes(addDays(d("2026-01-01"), i));
      const step = (a: Date, b: Date) => Math.abs(b.getTime() - a.getTime() - 24 * 3600_000) / 60_000;
      // A day later, give or take three minutes (real instants, so DST doesn't show here).
      expect(step(prev.sunrise, sun.sunrise)).toBeLessThan(3);
      expect(step(prev.sunset, sun.sunset)).toBeLessThan(3);
      expect(sun.sunrise.getTime()).toBeLessThan(sun.solarNoon.getTime());
      expect(sun.solarNoon.getTime()).toBeLessThan(sun.sunset.getTime());
      prev = sun;
    }
  });
});

describe("cue boundaries", () => {
  it("are civil dawn (sunrise − 30 min), 12:00 and civil dusk (sunset + 30 min)", () => {
    const date = d("2026-10-07");
    const sun = sunTimes(date);
    const { dawn, noon, dusk } = cueBoundaries(date);
    expect(sun.sunrise.getTime() - dawn.getTime()).toBe(TWILIGHT_MS);
    expect(dusk.getTime() - sun.sunset.getTime()).toBe(TWILIGHT_MS);
    expect(ny(noon)).toBe("12:00 EDT");
    expectNear(dawn, "06:29");
    expectNear(dusk, "18:58");
  });

  it("puts noon at 12:00 on the wall clock on 23- and 25-hour days", () => {
    expect(ny(wallClockNoon(d("2026-03-08")))).toBe("12:00 EDT");
    expect(ny(wallClockNoon(d("2026-11-01")))).toBe("12:00 EST");
    expect(ny(wallClockNoon(d("2026-07-04")))).toBe("12:00 EDT");
    expect(ny(wallClockNoon(d("2026-01-15")))).toBe("12:00 EST");
  });

  it("follow the season: dusk near 17:00 in December, 21:00 in June", () => {
    expectNear(cueBoundaries(d("2026-12-21")).dusk, "17:02");
    expectNear(cueBoundaries(d("2026-06-21")).dusk, "21:01");
  });
});

describe("homeClock", () => {
  it("describes the game day that contains `now`", () => {
    const now = new Date("2026-10-07T17:40:00Z"); // 13:40 EDT
    const clock = homeClock(now);
    expect(clock.timeZone).toBe("America/New_York");
    expect(clock.dayStartsAt).toBe(startOfDay(d("2026-10-07")).toISOString());
    expect(clock.rollsOverAt).toBe(startOfDay(d("2026-10-08")).toISOString());
    expect(clock.noonAt).toBe("2026-10-07T16:00:00.000Z");
    const { dawn, dusk } = cueBoundaries(d("2026-10-07"));
    expect(clock.dawnAt).toBe(dawn.toISOString());
    expect(clock.duskAt).toBe(dusk.toISOString());
  });

  it("just after New York midnight belongs to the new day (still the previous UTC date)", () => {
    const clock = homeClock(new Date("2026-10-08T04:05:00Z")); // 00:05 EDT on the 8th
    expect(clock.dayStartsAt).toBe(startOfDay(d("2026-10-08")).toISOString());
  });
});

describe("cueAt / nextCueChange", () => {
  const clock = homeClock(new Date("2026-10-07T16:00:00Z"));
  const at = (iso: string) => new Date(iso);

  it("is night before dawn, morning until noon, afternoon until dusk, night after", () => {
    expect(cueAt(at("2026-10-07T04:00:00Z"), clock)).toBe("night"); // 00:00 EDT
    expect(cueAt(Date.parse(clock.dawnAt) - 1, clock)).toBe("night");
    expect(cueAt(Date.parse(clock.dawnAt), clock)).toBe("morning");
    expect(cueAt(at("2026-10-07T12:40:00Z"), clock)).toBe("morning"); // 08:40 EDT (scenario A)
    expect(cueAt(Date.parse(clock.noonAt), clock)).toBe("afternoon");
    expect(cueAt(at("2026-10-07T17:40:00Z"), clock)).toBe("afternoon"); // 13:40 EDT (scenario B)
    expect(cueAt(Date.parse(clock.duskAt), clock)).toBe("night");
    expect(cueAt(at("2026-10-08T02:50:00Z"), clock)).toBe("night"); // 22:50 EDT (scenario C)
  });

  it("names the next boundary, or null after dusk", () => {
    expect(nextCueChange(at("2026-10-07T05:00:00Z"), clock)).toEqual({ at: new Date(clock.dawnAt), cue: "morning" });
    expect(nextCueChange(Date.parse(clock.dawnAt), clock)).toEqual({ at: new Date(clock.noonAt), cue: "afternoon" });
    expect(nextCueChange(at("2026-10-07T17:40:00Z"), clock)).toEqual({ at: new Date(clock.duskAt), cue: "night" });
    expect(nextCueChange(Date.parse(clock.duskAt), clock)).toBeNull();
  });
});
