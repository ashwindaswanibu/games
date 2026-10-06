/**
 * Color Grade DEV FIXTURES: today + 7 days of playable puzzles before TMDB stills exist.
 *
 * Each day's answer is a real catalog film. Its "still" is a procedurally drawn cut-paper landscape
 * in a film-like grade (teal and orange, bleach bypass, neon night…), and the "neutral photo" is a
 * procedurally drawn daylight village in balanced colour. Both then go through the same build as
 * real puzzles (`scripts/content/movies/lib/color-grade.mts`): k-means palette, Reinhard transfer
 * and blur. Every image carries a DEV FIXTURE label and the puzzle is flagged `fixture: true`.
 *
 *   npm run content:fixtures -- --game color-grade
 */
import { daysBetween, parsePuzzleDate } from "@/core/day";
import type { Rng } from "@/core/random";
import { toFilmDetails } from "@/games/_movies/server";
import { colorGrade } from "@/games/color-grade/logic";
import { buildColorGradeImages, FRAME_HEIGHT, FRAME_WIDTH } from "../movies/lib/color-grade.mjs";
import { defineFixtureGenerator, type FixtureContext } from "../lib/fixtures.mjs";
import { selectAllPages } from "../movies/lib/pipeline.mjs";

const W = FRAME_WIDTH;
const H = FRAME_HEIGHT;

/** A film-like grade: what the still's light, haze and shadows look like. */
interface Look {
  name: string;
  skyTop: string;
  skyHorizon: string;
  sun: string;
  far: string;
  mid: string;
  near: string;
  accent: string;
}

const LOOKS: readonly Look[] = [
  { name: "teal and orange", skyTop: "#0f3a4a", skyHorizon: "#f29a4a", sun: "#ffd29a", far: "#2f6f78", mid: "#1d4a55", near: "#0a1c22", accent: "#e8692c" },
  { name: "bleach bypass", skyTop: "#5d6563", skyHorizon: "#c9cbc2", sun: "#f2f1ea", far: "#8a908b", mid: "#4f5754", near: "#1d2120", accent: "#8c3a2e" },
  { name: "neon night", skyTop: "#12062a", skyHorizon: "#c2187a", sun: "#ffb3e6", far: "#4b1a7a", mid: "#24104a", near: "#07040f", accent: "#18e0e8" },
  { name: "sepia western", skyTop: "#7a4b22", skyHorizon: "#f0c27a", sun: "#fff0c8", far: "#b07a45", mid: "#7d4f2a", near: "#2e1a0c", accent: "#c23a1a" },
  { name: "digital green", skyTop: "#071a0e", skyHorizon: "#6fbf6a", sun: "#d8ffcf", far: "#2c6b3a", mid: "#123a1e", near: "#030b05", accent: "#b8ff3a" },
  { name: "pastel confection", skyTop: "#f2b8c6", skyHorizon: "#fbe3c8", sun: "#fff6e8", far: "#e59aa8", mid: "#c9707e", near: "#7a3346", accent: "#5f8fd0" },
  { name: "noir moonlight", skyTop: "#05080f", skyHorizon: "#3d5a80", sun: "#dbe7f5", far: "#25364d", mid: "#141e2c", near: "#03050a", accent: "#c9d6e8" },
  { name: "golden hour", skyTop: "#3b2a5a", skyHorizon: "#ffb347", sun: "#fff1b8", far: "#c06c48", mid: "#7a3b3a", near: "#2a1420", accent: "#ffd166" },
  { name: "desert haze", skyTop: "#c9772f", skyHorizon: "#f7d08a", sun: "#fff4d6", far: "#d9944a", mid: "#a8582a", near: "#4a2210", accent: "#2d5f8a" },
  { name: "arctic blue", skyTop: "#2a4f73", skyHorizon: "#cfe6f2", sun: "#ffffff", far: "#7fa9c6", mid: "#3e6a8c", near: "#0f2233", accent: "#e04a3a" },
];

const LOOK_EPOCH = parsePuzzleDate("2026-01-01");

const round = (n: number) => Math.round(n * 10) / 10;

/** A jagged ridge across the frame, closed along the bottom edge. */
function ridge(rng: Rng, baseY: number, roughness: number, steps: number): string {
  const points: string[] = [`0,${H}`];
  for (let i = 0; i <= steps; i++) {
    const x = (W * i) / steps;
    const y = baseY + (rng.next() - 0.5) * roughness * 2;
    points.push(`${round(x)},${round(y)}`);
  }
  points.push(`${W},${H}`);
  return points.join(" ");
}

/** Grain so the frame has photographic spread, not just flat fills. */
const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="SEED" result="noise"/>
  <feColorMatrix in="noise" type="saturate" values="0"/>
  <feComponentTransfer result="grain"><feFuncA type="table" tableValues="0.06 0"/></feComponentTransfer>
  <feComposite in="grain" in2="SourceGraphic" operator="over"/>
</filter>`;

/** A cut-paper landscape in the look's grade: sky, sun, three ridges, a lone figure, light beams. */
function filmStill(look: Look, rng: Rng): string {
  const sunX = round(W * (0.2 + rng.next() * 0.6));
  const sunY = round(H * (0.22 + rng.next() * 0.18));
  const sunR = round(H * (0.07 + rng.next() * 0.06));
  const figureX = round(W * (0.15 + rng.next() * 0.7));
  const figureY = round(H * 0.78);
  const beams = Array.from({ length: 3 }, (_, i) => {
    const x = round(sunX + (i - 1) * W * 0.12);
    return `<polygon points="${sunX},${sunY} ${x - 30},${H} ${x + 50},${H}" fill="${look.sun}" fill-opacity="0.07"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${look.skyTop}"/>
    <stop offset="0.72" stop-color="${look.skyHorizon}"/>
  </linearGradient>
  <radialGradient id="halo">
    <stop offset="0" stop-color="${look.sun}" stop-opacity="0.85"/>
    <stop offset="1" stop-color="${look.skyHorizon}" stop-opacity="0"/>
  </radialGradient>
  ${GRAIN.replace("SEED", String(rng.int(1, 9999)))}
</defs>
<g filter="url(#grain)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${round(sunR * 3.2)}" fill="url(#halo)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${look.sun}"/>
  ${beams}
  <polygon points="${ridge(rng, H * 0.56, 40, 9)}" fill="${look.far}"/>
  <polygon points="${ridge(rng, H * 0.68, 34, 7)}" fill="${look.mid}"/>
  <polygon points="${ridge(rng, H * 0.82, 22, 5)}" fill="${look.near}"/>
  <g fill="${look.accent}">
    <circle cx="${figureX}" cy="${round(figureY - 78)}" r="13"/>
    <polygon points="${figureX - 16},${figureY - 62} ${figureX + 16},${figureY - 62} ${figureX + 26},${figureY + 10} ${figureX - 26},${figureY + 10}"/>
  </g>
</g>
</svg>`;
}

/**
 * An ordinary daylight scene in balanced colour (blue sky, white clouds, green hills, gray road,
 * houses in primary paint): the "neutral photo" a look is transferred onto.
 */
function neutralPhoto(rng: Rng): string {
  const walls = ["#b5483c", "#e0b84a", "#eeeae0", "#4a6f9a", "#d9d2c3", "#7d9a6a"];
  const houses = Array.from({ length: 5 }, (_, i) => {
    const w = 110 + rng.int(0, 60);
    const h = 90 + rng.int(0, 50);
    const x = 60 + i * 240 + rng.int(-30, 30);
    const y = H * 0.66 - h;
    const wall = rng.pick(walls);
    return `<rect x="${x}" y="${round(y)}" width="${w}" height="${h}" fill="${wall}"/>
  <polygon points="${x - 12},${round(y)} ${x + w / 2},${round(y - 60)} ${x + w + 12},${round(y)}" fill="#5a5552"/>
  <rect x="${x + w / 2 - 14}" y="${round(y + h - 46)}" width="28" height="46" fill="#3a3330"/>
  <rect x="${x + 16}" y="${round(y + 18)}" width="24" height="24" fill="#bcd3e6"/>
  <rect x="${x + w - 40}" y="${round(y + 18)}" width="24" height="24" fill="#bcd3e6"/>`;
  }).join("\n");
  const clouds = Array.from({ length: 4 }, () => {
    const cx = rng.int(80, W - 80);
    const cy = rng.int(50, 190);
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rng.int(70, 130)}" ry="${rng.int(22, 36)}" fill="#ffffff" fill-opacity="0.92"/>
  <ellipse cx="${cx + 50}" cy="${cy - 14}" rx="${rng.int(40, 70)}" ry="${rng.int(18, 28)}" fill="#ffffff" fill-opacity="0.92"/>`;
  }).join("\n");
  const trees = Array.from({ length: 3 }, () => {
    const x = rng.int(40, W - 40);
    return `<rect x="${x - 6}" y="${round(H * 0.6)}" width="12" height="60" fill="#5b4632"/>
  <circle cx="${x}" cy="${round(H * 0.6 - 18)}" r="${rng.int(34, 48)}" fill="#3f7a3a"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5f93c8"/>
    <stop offset="1" stop-color="#dce8f0"/>
  </linearGradient>
  ${GRAIN.replace("SEED", String(rng.int(1, 9999)))}
</defs>
<g filter="url(#grain)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${clouds}
  <polygon points="${ridge(rng, H * 0.55, 30, 6)}" fill="#7fa36a"/>
  ${houses}
  ${trees}
  <rect y="${round(H * 0.66)}" width="${W}" height="${round(H * 0.34)}" fill="#6f9a4f"/>
  <polygon points="${W * 0.42},${H * 0.66} ${W * 0.58},${H * 0.66} ${W * 0.78},${H} ${W * 0.22},${H}" fill="#8a8886"/>
  <polygon points="${W * 0.495},${H * 0.7} ${W * 0.505},${H * 0.7} ${W * 0.51},${H} ${W * 0.49},${H}" fill="#f2efe6"/>
</g>
</svg>`;
}

/** Answers already used on other days, so a week of fixtures doesn't repeat a film. */
async function answersOnOtherDays(ctx: FixtureContext): Promise<Set<number>> {
  const data = await selectAllPages((from, to) =>
    ctx.db.from("puzzles").select("puzzle_date, solution").eq("game_id", colorGrade.id).neq("puzzle_date", ctx.date).order("puzzle_date").range(from, to),
  );
  const used = new Set<number>();
  for (const row of data) {
    const parsed = colorGrade.solutionSchema.safeParse(row.solution);
    if (parsed.success) used.add(parsed.data.answer.id);
  }
  return used;
}

export default defineFixtureGenerator({
  game: colorGrade,
  async generate(ctx) {
    const films = await ctx.topFilms({ limit: 200, requireDirectors: true });
    const used = await answersOnOtherDays(ctx);
    const fresh = films.filter((film) => !used.has(film.id));
    const answer = ctx.rng.pick(fresh.length > 0 ? fresh : films);
    // Rotate through the looks by date, so consecutive days never share one.
    const look = LOOKS[((daysBetween(LOOK_EPOCH, ctx.date) % LOOKS.length) + LOOKS.length) % LOOKS.length];

    const images = await buildColorGradeImages({
      still: Buffer.from(filmStill(look, ctx.rng)),
      neutral: Buffer.from(neutralPhoto(ctx.rng)),
      seed: ctx.rng.int(1, 2 ** 31 - 1),
      addAsset: (input) => ctx.addAsset(input),
      fixtureLabel: "DEV FIXTURE",
    });

    return {
      puzzle: { fixture: true, palette: images.palette },
      solution: {
        answer: toFilmDetails(answer),
        neutral: images.neutral,
        graded: images.graded,
        blurred: images.blurred,
        still: images.still,
      },
    };
  },
});
