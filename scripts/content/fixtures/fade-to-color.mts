/**
 * DEV FIXTURE puzzles for Fade to Color: a real catalog film as the answer, and ten levels rendered
 * by the real level renderer (`scripts/content/movies/lib/barcode-render.mts`) from a procedurally
 * generated stand-in "film": a sequence of shots (sky, horizon, sun or moon, silhouettes) in a
 * palette that suits the answer's genres, with studio cards and fades to black, night scenes, and
 * letterbox bars on scope films. So fixtures exercise mattes, dark-frame skipping, the squeezed
 * barcode and the edges-first strips, offline. Every level carries the "DEV FIXTURE" tag and the
 * puzzle sets `fixture: true`.
 *
 *   npm run content:fixtures -- --game fade-to-color
 *
 * Fixture levels are 1200 × 400 (half the real size) to keep a week of fixtures quick to make.
 */
import sharp from "sharp";
import type { Rng } from "@/core/random";
import { toFilmDetails } from "@/games/_movies/server";
import { fadeToColor, MAX_GUESSES, type LevelRef, type Puzzle, type Solution } from "@/games/fade-to-color/logic";
import { createImage, PACES, type RgbImage } from "../movies/lib/barcode-levels.mjs";
import { renderLevels, type FrameSource } from "../movies/lib/barcode-render.mjs";
import { finalPickOptions } from "../movies/lib/decoys.mjs";
import { selectAllPages } from "../movies/lib/pipeline.mjs";
import { defineFixtureGenerator, type FixtureContext } from "../lib/fixtures.mjs";
import { fixtureSvg } from "../lib/images.mjs";

const WIDTH = 1200;
const HEIGHT = 400;
/** Frames in the stand-in film (a real gallery has 5,000–25,000). */
const FRAMES = 1500;
/** How many of the most popular films to choose answers from. */
const CANDIDATES = 250;

// ---------------------------------------------------------------------------------------------
// A genre-led palette: hue families (degrees) plus saturation and lightness ranges (HSL, 0–1).
// ---------------------------------------------------------------------------------------------

interface Look {
  hues: readonly number[];
  sat: readonly [number, number];
  light: readonly [number, number];
}

const LOOKS: readonly { match: RegExp; look: Look }[] = [
  { match: /horror|slasher/, look: { hues: [195, 350, 95], sat: [0.15, 0.45], light: [0.12, 0.4] } },
  { match: /science fiction|cyberpunk|space/, look: { hues: [190, 212, 26], sat: [0.35, 0.7], light: [0.2, 0.55] } },
  { match: /western/, look: { hues: [30, 38, 22, 205], sat: [0.4, 0.7], light: [0.35, 0.65] } },
  { match: /war/, look: { hues: [72, 44, 30], sat: [0.15, 0.35], light: [0.25, 0.5] } },
  { match: /noir|crime|thriller|mystery|heist|gangster/, look: { hues: [212, 40, 188], sat: [0.15, 0.45], light: [0.15, 0.45] } },
  { match: /romance|romantic|musical/, look: { hues: [16, 342, 44, 160], sat: [0.4, 0.7], light: [0.4, 0.7] } },
  { match: /animat|family|children|comedy/, look: { hues: [200, 46, 120, 328, 10], sat: [0.5, 0.85], light: [0.4, 0.7] } },
  { match: /fantasy|adventure|epic/, look: { hues: [108, 44, 200, 28], sat: [0.35, 0.65], light: [0.3, 0.6] } },
  { match: /action|superhero|martial/, look: { hues: [24, 196], sat: [0.35, 0.65], light: [0.25, 0.55] } },
];
const DEFAULT_LOOK: Look = { hues: [30, 210, 20, 180], sat: [0.2, 0.5], light: [0.3, 0.6] };

function lookFor(genres: readonly string[]): Look {
  const looks = genres.flatMap((genre) => LOOKS.filter(({ match }) => match.test(genre.toLowerCase())).map(({ look }) => look)).slice(0, 2);
  if (looks.length === 0) return DEFAULT_LOOK;
  const avg = (pick: (look: Look) => number) => looks.reduce((sum, look) => sum + pick(look), 0) / looks.length;
  return {
    hues: [...new Set(looks.flatMap((look) => look.hues))],
    sat: [avg((l) => l.sat[0]), avg((l) => l.sat[1])],
    light: [avg((l) => l.light[0]), avg((l) => l.light[1])],
  };
}

type Rgb = [number, number, number];

function hsl(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

const between = (rng: Rng, lo: number, hi: number) => lo + rng.next() * (hi - lo);

// ---------------------------------------------------------------------------------------------
// The stand-in film: shots, each a small resolution-independent scene that pans slightly
// ---------------------------------------------------------------------------------------------

interface Shape {
  kind: "disc" | "block";
  /** Centre / left, top, size: fractions of the picture. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: Rgb;
}

interface Shot {
  first: number;
  last: number;
  /** Fade to black (studio cards, credits): the whole frame is near black. */
  black: boolean;
  sky: Rgb;
  haze: Rgb;
  ground: Rgb;
  horizon: number;
  shapes: Shape[];
  /** Horizontal camera move over the shot, as a fraction of the width. */
  pan: number;
}

function planShots(rng: Rng, look: Look, frames: number): Shot[] {
  const shots: Shot[] = [];
  const opening = Math.round(frames * 0.03);
  const credits = Math.round(frames * 0.06);
  const black = (first: number, last: number): Shot => ({ first, last, black: true, sky: [0, 0, 0], haze: [0, 0, 0], ground: [0, 0, 0], horizon: 0.5, shapes: [], pan: 0 });
  shots.push(black(1, opening));
  let n = opening + 1;
  while (n <= frames - credits) {
    const length = Math.min(frames - credits - n + 1, rng.int(8, 40));
    const t = n / frames;
    // A dark turn about 70% of the way in, and a fade to black now and then.
    const night = rng.next() < 0.15 + 0.35 * Math.max(0, 1 - Math.abs(t - 0.7) / 0.1);
    if (rng.next() < 0.04) {
      shots.push(black(n, n + length - 1));
      n += length;
      continue;
    }
    const hue = rng.pick(look.hues) + (rng.next() - 0.5) * 24;
    const sat = between(rng, look.sat[0], look.sat[1]);
    const light = between(rng, look.light[0], look.light[1]) * (night ? 0.35 : 1);
    const accent = hsl(rng.pick(look.hues) + 180 * Math.round(rng.next()), Math.min(1, sat * 1.4), Math.min(0.85, light * 1.6));
    const shapes: Shape[] = [
      { kind: "disc", x: between(rng, 0.1, 0.9), y: between(rng, 0.12, 0.4), w: between(rng, 0.04, 0.12), h: 0, color: night ? [225, 228, 235] : hsl(45, 0.9, 0.85) },
      ...Array.from({ length: rng.int(2, 6) }, (): Shape => ({
        kind: "block",
        x: between(rng, -0.05, 0.95),
        y: between(rng, 0.25, 0.75),
        w: between(rng, 0.03, 0.22),
        h: 1,
        color: rng.next() < 0.3 ? accent : hsl(hue + 180, sat * 0.6, light * 0.4),
      })),
    ];
    shots.push({
      first: n,
      last: n + length - 1,
      black: false,
      sky: hsl(hue, sat, Math.min(0.9, light * 1.25)),
      haze: hsl(hue + 25, sat * 0.8, Math.min(0.95, light * 1.5)),
      ground: hsl(hue + 160, sat * 0.7, light * 0.55),
      horizon: between(rng, 0.45, 0.75),
      shapes,
      pan: (rng.next() - 0.5) * 0.2,
    });
    n += length;
  }
  shots.push(black(n, frames));
  return shots;
}

/** Draws frame `n` at `width × height`, with black letterbox bars around a `pictureAspect` picture. */
function drawFrame(shots: readonly Shot[], n: number, width: number, height: number, pictureAspect: number): RgbImage {
  const image = createImage(width, height);
  const shot = shots.find((s) => n >= s.first && n <= s.last) ?? shots.at(-1)!;
  const pictureHeight = Math.min(height, Math.round(width / pictureAspect));
  const top = Math.floor((height - pictureHeight) / 2);
  const d = image.data;
  // Near-black frames still carry a faint grain so they aren't all identical.
  if (shot.black) {
    for (let i = 0; i < d.length; i += 3) d[i] = d[i + 1] = d[i + 2] = (i * 7 + n) % 9;
    return image;
  }
  const progress = shot.last === shot.first ? 0 : (n - shot.first) / (shot.last - shot.first);
  const shift = shot.pan * progress;
  for (let y = 0; y < pictureHeight; y++) {
    const v = y / pictureHeight;
    for (let x = 0; x < width; x++) {
      const u = x / width + shift;
      let c: Rgb;
      if (v < shot.horizon) {
        const t = v / shot.horizon;
        c = [shot.sky[0] + (shot.haze[0] - shot.sky[0]) * t, shot.sky[1] + (shot.haze[1] - shot.sky[1]) * t, shot.sky[2] + (shot.haze[2] - shot.sky[2]) * t];
      } else {
        const ripple = 0.85 + 0.15 * Math.sin(u * 90 + v * 40);
        c = [shot.ground[0] * ripple, shot.ground[1] * ripple, shot.ground[2] * ripple];
      }
      for (const s of shot.shapes) {
        if (s.kind === "disc") {
          const r = s.w;
          const dx = (u - s.x) * pictureAspect;
          const dy = v - s.y;
          if (dx * dx + dy * dy < r * r) c = s.color;
        } else if (u >= s.x && u < s.x + s.w && v >= s.y && v < shot.horizon + 0.02) {
          c = s.color;
        }
      }
      const i = ((top + y) * width + x) * 3;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  return image;
}

/** The stand-in film as a `FrameSource`, so the real renderer can use it. Frames are 16:9; scope films are letterboxed. */
class SyntheticFilm implements FrameSource {
  readonly description = "procedural DEV FIXTURE film";
  readonly frameCount = FRAMES;
  private frameWidth = 0;

  constructor(
    private readonly shots: readonly Shot[],
    private readonly pictureAspect: number,
  ) {}

  async thumbnails(numbers: readonly number[]): Promise<RgbImage[]> {
    return numbers.map((n) => drawFrame(this.shots, n, 192, 108, this.pictureAspect));
  }

  async prefetchFrames(_numbers: readonly number[], options: { width: number }): Promise<void> {
    this.frameWidth = Math.ceil(options.width);
  }

  async frame(n: number): Promise<RgbImage> {
    if (this.frameWidth === 0) throw new Error("prefetchFrames must run first");
    return drawFrame(this.shots, n, this.frameWidth, Math.round((this.frameWidth * 9) / 16), this.pictureAspect);
  }
}

// ---------------------------------------------------------------------------------------------

/** Answer ids already used by this game's puzzles on other days, so a week doesn't repeat a film. */
async function usedAnswers(ctx: FixtureContext): Promise<Set<number>> {
  const rows = await selectAllPages((from, to) =>
    ctx.db.from("puzzles").select("puzzle_date, solution").eq("game_id", fadeToColor.id).neq("puzzle_date", ctx.date).order("puzzle_date").range(from, to),
  );
  const ids = new Set<number>();
  for (const row of rows) {
    const answer = (row.solution as { answer?: { id?: unknown } } | null)?.answer;
    if (typeof answer?.id === "number") ids.add(answer.id);
  }
  return ids;
}

/** Stamps the DEV FIXTURE tag on a rendered level. */
async function tagged(image: RgbImage): Promise<Buffer> {
  const tag = Buffer.from(fixtureSvg({ width: image.width, height: image.height, content: "" }));
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).composite([{ input: tag }]).png().toBuffer();
}

export default defineFixtureGenerator({
  game: fadeToColor,
  async generate(ctx) {
    const films = await ctx.topFilms({ limit: CANDIDATES, requireDirectors: true });
    const used = await usedAnswers(ctx);
    const fresh = films.filter((film) => !used.has(film.id));
    const answer = ctx.rng.pick(fresh.length > 0 ? fresh : films);

    const pictureAspect = answer.year !== null && answer.year < 1953 ? 1.37 : ctx.rng.pick([1.85, 2.39]);
    const film = new SyntheticFilm(planShots(ctx.rng, lookFor(answer.genres), FRAMES), pictureAspect);
    const rendered = await renderLevels(film, { width: WIDTH, height: HEIGHT, pace: PACES.normal, samples: FRAMES });

    const levels: LevelRef[] = [];
    for (const level of rendered.levels) {
      const ref = await ctx.addAsset({
        kind: `barcode-level-${level.level}`,
        visibility: level.level === 1 ? "shown" : "secret",
        image: await tagged(level.image),
        maxWidth: WIDTH,
        maxHeight: HEIGHT,
        quality: 88,
        smartSubsample: true,
      });
      levels.push({ ...ref, average: level.average, dominant: level.dominant });
    }
    const puzzle: Puzzle = {
      fixture: true,
      maxGuesses: MAX_GUESSES,
      first: levels[0]!,
      look: { saturation: Number(rendered.look.saturation.toFixed(4)), monochrome: rendered.look.monochrome },
    };
    const options = await finalPickOptions(ctx.db, answer.id, ctx.date);
    const solution: Solution = { answer: toFilmDetails(answer), levels, pace: "normal", credit: null, options };
    return { puzzle, solution };
  },
});
