/**
 * DEV FIXTURE barcodes for Color Barcode. A real barcode needs the film itself
 * (`scripts/content/movies/barcodes.mts`); until we have the videos, each day gets a real catalog
 * film as the answer and a procedurally generated stand-in barcode with a plausible color arc:
 * studio cards, scenes cut from a genre-led palette, day and night, a dark turn before the climax,
 * then the end credits. The puzzle is flagged `fixture: true`, which the board shows.
 *
 *   npm run content:fixtures -- --game color-barcode
 */
import type { FilmRecord } from "@/server/game-services";
import type { Rng } from "@/core/random";
import { toFilmDetails } from "@/games/_movies/server";
import { rgbToHex, type HexColor } from "@/games/color-barcode/barcode";
import { colorBarcode, MAX_GUESSES } from "@/games/color-barcode/logic";
import { defineFixtureGenerator, type FixtureContext } from "../lib/fixtures.mjs";
import { selectAllPages } from "../movies/lib/pipeline.mjs";

/** Stripes per fixture barcode; the real pipeline defaults to the same. */
const STRIPES = 360;
/** How many of the most popular films to choose answers from. */
const CANDIDATES = 250;

// ---------------------------------------------------------------------------------------------
// A genre-led look: hue families (degrees) plus saturation and lightness ranges (HSL, 0–1).
// ---------------------------------------------------------------------------------------------

interface Look {
  hues: readonly number[];
  sat: readonly [number, number];
  light: readonly [number, number];
}

// Averaged frames are far less saturated than any single shot, so these ranges sit low.
const LOOKS: readonly { match: RegExp; look: Look }[] = [
  { match: /horror|slasher/, look: { hues: [195, 350, 95], sat: [0.08, 0.3], light: [0.05, 0.26] } },
  { match: /science fiction|cyberpunk|space/, look: { hues: [190, 212, 26], sat: [0.2, 0.48], light: [0.08, 0.4] } },
  { match: /western/, look: { hues: [30, 38, 22, 205], sat: [0.24, 0.5], light: [0.24, 0.56] } },
  { match: /war/, look: { hues: [72, 44, 30], sat: [0.08, 0.24], light: [0.14, 0.4] } },
  { match: /noir|crime|thriller|mystery|heist|gangster/, look: { hues: [212, 40, 188], sat: [0.08, 0.3], light: [0.07, 0.32] } },
  { match: /romance|romantic|musical/, look: { hues: [16, 342, 44, 160], sat: [0.24, 0.48], light: [0.28, 0.6] } },
  { match: /animat|family|children|comedy/, look: { hues: [200, 46, 120, 328, 10], sat: [0.32, 0.62], light: [0.32, 0.64] } },
  { match: /fantasy|adventure|epic/, look: { hues: [108, 44, 200, 28], sat: [0.2, 0.46], light: [0.18, 0.52] } },
  { match: /action|superhero|martial/, look: { hues: [24, 196], sat: [0.22, 0.48], light: [0.14, 0.44] } },
];
const DEFAULT_LOOK: Look = { hues: [30, 210, 20, 180], sat: [0.1, 0.34], light: [0.18, 0.5] };

/** The film's look: the looks of its first two recognised genres, blended. */
function lookFor(genres: readonly string[]): Look {
  const looks = genres
    .flatMap((genre) => LOOKS.filter(({ match }) => match.test(genre.toLowerCase())).map(({ look }) => look))
    .slice(0, 2);
  if (looks.length === 0) return DEFAULT_LOOK;
  const avg = (pick: (look: Look) => number) => looks.reduce((sum, look) => sum + pick(look), 0) / looks.length;
  return {
    hues: [...new Set(looks.flatMap((look) => look.hues))],
    sat: [avg((l) => l.sat[0]), avg((l) => l.sat[1])],
    light: [avg((l) => l.light[0]), avg((l) => l.light[1])],
  };
}

// ---------------------------------------------------------------------------------------------
// The arc
// ---------------------------------------------------------------------------------------------

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const between = (rng: Rng, [lo, hi]: readonly [number, number]) => lo + rng.next() * (hi - lo);
/** A smooth bump centred on `at` with half-width `width` (0 outside it). */
const bump = (t: number, at: number, width: number) => (Math.abs(t - at) >= width ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (t - at)) / width));

function hsl(h: number, s: number, l: number): HexColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const light = clamp01(l);
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return rgbToHex(f(0), f(8), f(4));
}

interface Grade {
  hue: number;
  sat: number;
  light: number;
}

const vary = (rng: Rng, grade: Grade, hue: number, sat: number, light: number): Grade => ({
  hue: grade.hue + (rng.next() - 0.5) * hue,
  sat: grade.sat * (1 + (rng.next() - 0.5) * sat),
  light: grade.light * (1 + (rng.next() - 0.5) * light),
});

/**
 * A stand-in barcode for a film with these genres, deterministic for a given rng state. Built the
 * way films are: sequences (a location and its grade), cut into scenes, cut into shots, with the
 * grade drifting slowly over the whole film.
 */
function generateBarcode(rng: Rng, genres: readonly string[], count: number): HexColor[] {
  const look = lookFor(genres);
  const stripes: HexColor[] = [];
  const push = (g: Grade) => stripes.push(hsl(g.hue, g.sat, g.light));

  // Studio cards: near-black with a short colored logo.
  const opening = rng.int(Math.round(count * 0.012), Math.round(count * 0.025));
  const logoAt = rng.int(1, Math.max(1, opening - 3));
  const logo: Grade = { hue: rng.pick([215, 45, 200]), sat: 0.45, light: 0.26 };
  for (let i = 0; i < opening; i++) push(i >= logoAt && i < logoAt + 2 ? vary(rng, logo, 4, 0.1, 0.2) : { hue: 0, sat: 0, light: 0.015 + rng.next() * 0.02 });

  // End credits: the last 4–7%, near-black.
  const credits = rng.int(Math.round(count * 0.04), Math.round(count * 0.07));
  const body = count - opening - credits;
  // The film's signature accent (fire, neon, a red dress): mostly at the climax.
  const accent: Grade = { hue: rng.pick([8, 18, 28, 48, 165]), sat: 0.5, light: 0.33 };
  // The grade drifts slowly over the film.
  const phase = [rng.next() * Math.PI * 2, rng.next() * Math.PI * 2];
  const drift = (t: number) => 1 + 0.14 * Math.sin(2 * Math.PI * 1.3 * t + phase[0]) + 0.08 * Math.sin(2 * Math.PI * 3.1 * t + phase[1]);

  let i = 0;
  while (i < body) {
    const t = i / body;
    const sequenceLength = Math.min(body - i, Math.max(6, Math.round(body * (0.04 + rng.next() * 0.1))));
    // The arc: a dark turn around 70%, a hotter climax near 88%.
    const arc = (1 - 0.42 * bump(t, 0.7, 0.1)) * drift(t);
    const night = rng.next() < 0.18 + 0.3 * bump(t, 0.7, 0.12);
    const day: Grade = { hue: rng.pick(look.hues) + (rng.next() - 0.5) * 20, sat: between(rng, look.sat), light: between(rng, look.light) * arc };
    const location: Grade = night ? { hue: 218 + (rng.next() - 0.5) * 30, sat: day.sat * 0.6, light: day.light * 0.42 } : day;

    for (let k = 0; k < sequenceLength; ) {
      const sceneLength = Math.min(sequenceLength - k, rng.int(3, 18));
      const climax = bump((i + k) / body, 0.88, 0.05);
      const scene = vary(rng, rng.next() < 0.03 + 0.5 * climax ? accent : location, 16, 0.4, 0.5);
      let shot = scene;
      for (let s = 0; s < sceneLength; s++) {
        // A new set-up every few stripes: mostly a change of light, a little of color.
        if (s === 0 || rng.next() < 0.4) shot = vary(rng, scene, 8, 0.25, 0.45);
        push(vary(rng, shot, 3, 0.08, 0.1));
      }
      k += sceneLength;
    }
    i += sequenceLength;
  }

  for (let k = 0; k < credits; k++) push({ hue: 0, sat: 0, light: 0.012 + rng.next() * 0.03 });
  return stripes;
}

// ---------------------------------------------------------------------------------------------

/** Answer ids already used by this game's puzzles on other days, so a week doesn't repeat a film. */
async function usedAnswers(ctx: FixtureContext): Promise<Set<number>> {
  const data = await selectAllPages((from, to) =>
    ctx.db.from("puzzles").select("puzzle_date, solution").eq("game_id", colorBarcode.id).neq("puzzle_date", ctx.date).order("puzzle_date").range(from, to),
  );
  const ids = new Set<number>();
  for (const row of data) {
    const parsed = colorBarcode.solutionSchema.safeParse(row.solution);
    if (parsed.success) ids.add(parsed.data.answer.id);
  }
  return ids;
}

export default defineFixtureGenerator({
  game: colorBarcode,
  async generate(ctx) {
    const films = (await ctx.topFilms({ limit: CANDIDATES, requireDirectors: true })).filter(
      (film): film is FilmRecord & { year: number } => film.year !== null,
    );
    if (films.length === 0) throw new Error("No catalog films with a release year and a director to choose from.");
    const used = await usedAnswers(ctx);
    const fresh = films.filter((film) => !used.has(film.id));
    const answer = ctx.rng.pick(fresh.length > 0 ? fresh : films);
    return {
      puzzle: { fixture: true, maxGuesses: MAX_GUESSES, stripes: generateBarcode(ctx.rng, answer.genres, STRIPES) },
      solution: { answer: { ...toFilmDetails(answer), year: answer.year } },
    };
  },
});
