import { addDays, puzzleDateAt, startOfDay, wallClockAt, type PuzzleDate } from "./day";
import type { HomeClock, HomeCue } from "./home-view";

/**
 * New York's daylight, for the home's three lights: paper from civil dawn, warmer paper from noon,
 * the dark room from civil dusk. Pure and deterministic (no clock reads: every instant is an input).
 *
 * Sunrise and sunset use NOAA's solar calculator (the "General Solar Position" equations behind
 * https://gml.noaa.gov/grad/solcalc/), accurate to about a minute at New York's latitude. They are
 * computed as UTC instants, so daylight saving time never enters the arithmetic; noon is 12:00 on
 * New York's wall clock, derived from `startOfDay` (DST-safe).
 */

export interface Place {
  /** Degrees north. */
  latitude: number;
  /** Degrees east (New York is negative). */
  longitude: number;
}

/** City Hall, the reference point for "New York" sun tables. */
export const NEW_YORK: Place = { latitude: 40.7128, longitude: -74.006 };

/** Civil twilight, approximated as a fixed half hour either side of the sun's rim crossing the horizon. */
export const TWILIGHT_MS = 30 * 60 * 1000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UNIX_EPOCH_JD = 2440587.5;
const J2000_JD = 2451545;
/** Sun's rim on the horizon, with standard refraction: 90° + 50′. */
const SUNRISE_ZENITH_DEG = 90.833;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface SunTimes {
  sunrise: Date;
  solarNoon: Date;
  sunset: Date;
}

/** Equation of time (minutes) and solar declination (degrees) at an instant (NOAA). */
function solarPosition(instantMs: number): { eqTimeMin: number; declinationDeg: number } {
  const jc = (instantMs / DAY_MS + UNIX_EPOCH_JD - J2000_JD) / 36525;
  const meanLong = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const center =
    Math.sin(rad(meanAnom)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * jc) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = meanLong + center - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declinationDeg = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTimeMin =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * ecc * Math.sin(rad(meanAnom)) +
        4 * ecc * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * ecc * ecc * Math.sin(2 * rad(meanAnom)),
    );
  return { eqTimeMin, declinationDeg };
}

/** Solar noon nearest `approxMs`, in ms since the epoch. */
function solarNoonNear(approxMs: number, place: Place): number {
  const utcMidnight = Math.floor(approxMs / DAY_MS) * DAY_MS;
  // Two passes: evaluate the equation of time at the first estimate of noon, then at noon itself.
  let noon = utcMidnight + (720 - 4 * place.longitude) * MINUTE_MS;
  for (let i = 0; i < 2; i++) noon = utcMidnight + (720 - 4 * place.longitude - solarPosition(noon).eqTimeMin) * MINUTE_MS;
  return noon;
}

/** Hour angle (degrees) of sunrise/sunset at an instant, or null when the sun doesn't cross the horizon. */
function sunriseHourAngle(instantMs: number, place: Place): number | null {
  const { declinationDeg } = solarPosition(instantMs);
  const cosHa =
    Math.cos(rad(SUNRISE_ZENITH_DEG)) / (Math.cos(rad(place.latitude)) * Math.cos(rad(declinationDeg))) -
    Math.tan(rad(place.latitude)) * Math.tan(rad(declinationDeg));
  return cosHa < -1 || cosHa > 1 ? null : deg(Math.acos(cosHa));
}

/** Sunrise or sunset (`sign` −1 / +1) for the solar day around `noonMs`, refined at the event itself. */
function horizonCrossing(noonMs: number, sign: -1 | 1, place: Place): number {
  let at = noonMs;
  for (let i = 0; i < 3; i++) {
    const ha = sunriseHourAngle(at, place);
    if (ha === null) throw new Error(`The sun does not ${sign < 0 ? "rise" : "set"} at latitude ${place.latitude} on this day`);
    // 4 minutes of time per degree of hour angle. Each pass evaluates the declination at the
    // previous estimate of the event rather than at noon (it moves ~0.4° a day near the equinoxes).
    at = noonMs + sign * ha * 4 * MINUTE_MS;
  }
  return at;
}

/** Sunrise, solar noon and sunset in `place` on the New York game day `date`. */
export function sunTimes(date: PuzzleDate, place: Place = NEW_YORK): SunTimes {
  // New York's solar noon falls between 16:40 and 17:10 UTC on its own calendar day.
  const dayMiddle = startOfDay(date).getTime() + 12 * HOUR_MS;
  const noon = solarNoonNear(dayMiddle, place);
  return {
    sunrise: new Date(horizonCrossing(noon, -1, place)),
    solarNoon: new Date(noon),
    sunset: new Date(horizonCrossing(noon, 1, place)),
  };
}

/** 12:00 on New York's wall clock (DST changes happen at 2 AM, so noon carries the day's shift). */
export function wallClockNoon(date: PuzzleDate): Date {
  return wallClockAt(date, 12 * 60);
}

/** The three cue boundaries for `date`: civil dawn, noon, civil dusk. */
export function cueBoundaries(date: PuzzleDate): { dawn: Date; noon: Date; dusk: Date } {
  const { sunrise, sunset } = sunTimes(date);
  return {
    dawn: new Date(sunrise.getTime() - TWILIGHT_MS),
    noon: wallClockNoon(date),
    dusk: new Date(sunset.getTime() + TWILIGHT_MS),
  };
}

/** The home's clock for the game day containing `now`. */
export function homeClock(now: Date): HomeClock {
  const date = puzzleDateAt(now);
  const { dawn, noon, dusk } = cueBoundaries(date);
  return {
    dayStartsAt: startOfDay(date).toISOString(),
    rollsOverAt: startOfDay(addDays(date, 1)).toISOString(),
    dawnAt: dawn.toISOString(),
    noonAt: noon.toISOString(),
    duskAt: dusk.toISOString(),
    timeZone: "America/New_York",
  };
}

type CueClock = Pick<HomeClock, "dawnAt" | "noonAt" | "duskAt">;

/**
 * The room's light at `instant` (ms since the epoch or a Date) on the day `clock` describes: night
 * before civil dawn, morning until noon, afternoon until civil dusk, night after. Use it on the
 * server (the first paint) and on the client with a skew-corrected instant.
 */
export function cueAt(instant: Date | number, clock: CueClock): HomeCue {
  const t = typeof instant === "number" ? instant : instant.getTime();
  if (t < Date.parse(clock.dawnAt) || t >= Date.parse(clock.duskAt)) return "night";
  return t < Date.parse(clock.noonAt) ? "morning" : "afternoon";
}

/**
 * The next cue boundary after `instant` on `clock`'s day (dawn, noon or dusk), or null when the
 * next change of light is the next day's dawn (the page refreshes at midnight and gets a new clock).
 */
export function nextCueChange(instant: Date | number, clock: CueClock): { at: Date; cue: HomeCue } | null {
  const t = typeof instant === "number" ? instant : instant.getTime();
  const boundaries: [string, HomeCue][] = [
    [clock.dawnAt, "morning"],
    [clock.noonAt, "afternoon"],
    [clock.duskAt, "night"],
  ];
  for (const [iso, cue] of boundaries) {
    const at = Date.parse(iso);
    if (at > t) return { at: new Date(at), cue };
  }
  return null;
}
