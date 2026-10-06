/**
 * DEV FIXTURE puzzles for Frame by Frame: a real film from the catalog as the answer, and six
 * procedurally drawn stand-in "frames" in a palette that suits its genres, ordered hardest to
 * easiest like the real pipeline (scripts/content/movies/frame-by-frame.mts) orders TMDB stills:
 *
 *   1  macro: soft colour fields, nothing recognisable
 *   2  out of focus: bokeh and a light band
 *   3  establishing shot: sky, horizon, skyline
 *   4  silhouette in a doorway
 *   5  two-shot with the release year on a sign
 *   6  title card: each word's first letter, the year and the director's surname
 *
 * Frames 5 and 6 carry real hints on purpose, so the loop can be played to a win while testing.
 * Every image carries the "DEV FIXTURE" tag, and the puzzle sets `fixture: true`.
 *
 * Catalog: if it is still empty (the Wikidata import hasn't run), a small embedded set of
 * well-known films is upserted on `wikidata_id`, exactly as the importer keys rows, so the
 * importer later updates these rows instead of duplicating them.
 */
import type { AssetRef } from "@/core/assets";
import { daysBetween, parsePuzzleDate, type PuzzleDate } from "@/core/day";
import { createRng, type Rng } from "@/core/random";
import { frameByFrame, FRAME_COUNT } from "@/games/frame-by-frame/logic";
import { toFilmDetails } from "@/games/_movies/server";
import type { FilmRecord } from "@/server/game-services";
import type { ContentDb } from "../lib/db.mjs";
import { defineFixtureGenerator, fixtureSeed } from "../lib/fixtures.mjs";
import { fixtureSvg } from "../lib/images.mjs";

const WIDTH = 1280;

// ---------------------------------------------------------------------------------------------
// Catalog fallback. Facts checked against Wikidata (labels, P577 year, P57 director, P345, P4947).
// ---------------------------------------------------------------------------------------------

type EmbeddedFilm = { wikidata: string; title: string; year: number; directors: string[]; genres: string[]; imdb: string; tmdb: number; popularity: number };

const EMBEDDED_FILMS: readonly EmbeddedFilm[] = [
  { wikidata: "Q44578", title: "Titanic", year: 1997, directors: ["James Cameron"], genres: ["Romance", "Drama", "Disaster", "Epic"], imdb: "tt0120338", tmdb: 597, popularity: 137 },
  { wikidata: "Q47703", title: "The Godfather", year: 1972, directors: ["Francis Ford Coppola"], genres: ["Crime", "Drama", "Gangster"], imdb: "tt0068646", tmdb: 238, popularity: 132 },
  { wikidata: "Q83495", title: "The Matrix", year: 1999, directors: ["Lana Wachowski", "Lilly Wachowski"], genres: ["Science fiction", "Action", "Cyberpunk"], imdb: "tt0133093", tmdb: 603, popularity: 114 },
  { wikidata: "Q155653", title: "Spirited Away", year: 2001, directors: ["Hayao Miyazaki"], genres: ["Fantasy", "Animation", "Coming-of-age"], imdb: "tt0245429", tmdb: 129, popularity: 109 },
  { wikidata: "Q104123", title: "Pulp Fiction", year: 1994, directors: ["Quentin Tarantino"], genres: ["Crime", "Black comedy", "Neo-noir"], imdb: "tt0110912", tmdb: 680, popularity: 107 },
  { wikidata: "Q132689", title: "Casablanca", year: 1942, directors: ["Michael Curtiz"], genres: ["Romance", "Drama", "War", "Film noir"], imdb: "tt0034583", tmdb: 289, popularity: 107 },
  { wikidata: "Q163872", title: "The Dark Knight", year: 2008, directors: ["Christopher Nolan"], genres: ["Superhero", "Crime", "Action", "Thriller"], imdb: "tt0468569", tmdb: 155, popularity: 107 },
  { wikidata: "Q91540", title: "Back to the Future", year: 1985, directors: ["Robert Zemeckis"], genres: ["Science fiction", "Comedy", "Adventure"], imdb: "tt0088763", tmdb: 105, popularity: 103 },
  { wikidata: "Q167726", title: "Jurassic Park", year: 1993, directors: ["Steven Spielberg"], genres: ["Science fiction", "Adventure", "Action", "Thriller"], imdb: "tt0107290", tmdb: 329, popularity: 99 },
  { wikidata: "Q25188", title: "Inception", year: 2010, directors: ["Christopher Nolan"], genres: ["Science fiction", "Action", "Thriller", "Heist"], imdb: "tt1375666", tmdb: 27205, popularity: 97 },
  { wikidata: "Q17738", title: "Star Wars", year: 1977, directors: ["George Lucas"], genres: ["Science fiction", "Space opera", "Adventure"], imdb: "tt0076759", tmdb: 11, popularity: 96 },
  { wikidata: "Q184843", title: "Blade Runner", year: 1982, directors: ["Ridley Scott"], genres: ["Science fiction", "Neo-noir", "Cyberpunk", "Thriller"], imdb: "tt0083658", tmdb: 78, popularity: 84 },
  { wikidata: "Q484048", title: "Amélie", year: 2001, directors: ["Jean-Pierre Jeunet"], genres: ["Romance", "Comedy", "Drama"], imdb: "tt0211915", tmdb: 194, popularity: 78 },
  { wikidata: "Q186341", title: "The Shining", year: 1980, directors: ["Stanley Kubrick"], genres: ["Horror", "Psychological thriller", "Drama"], imdb: "tt0081505", tmdb: 694, popularity: 75 },
  { wikidata: "Q189505", title: "Jaws", year: 1975, directors: ["Steven Spielberg"], genres: ["Thriller", "Horror", "Adventure"], imdb: "tt0073195", tmdb: 578, popularity: 72 },
];

async function ensureCatalog(db: ContentDb): Promise<void> {
  const { count, error } = await db.from("movie_films").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Failed to read the catalog: ${error.message}`);
  if ((count ?? 0) > 0) return;
  const rows = EMBEDDED_FILMS.map((f) => ({
    title: f.title,
    year: f.year,
    genres: f.genres,
    directors: f.directors,
    popularity: f.popularity,
    tmdb_id: f.tmdb,
    imdb_id: f.imdb,
    wikidata_id: f.wikidata,
  }));
  const { error: upsertError } = await db.from("movie_films").upsert(rows, { onConflict: "wikidata_id", ignoreDuplicates: true });
  if (upsertError) throw new Error(`Failed to seed the embedded films: ${upsertError.message}`);
  console.log(`  catalog was empty: seeded ${rows.length} embedded films (run the Wikidata import for the full catalog)`);
}

// ---------------------------------------------------------------------------------------------
// Which film on which day: a fixed shuffle walked one step per day, so consecutive days differ.
// ---------------------------------------------------------------------------------------------

const ANCHOR = parsePuzzleDate("2026-01-01");

function filmForDay(films: readonly FilmRecord[], date: PuzzleDate): FilmRecord {
  const order = createRng(fixtureSeed(frameByFrame.id, ANCHOR)).shuffle([...films].sort((a, b) => a.id - b.id));
  const n = order.length;
  return order[(((daysBetween(ANCHOR, date) % n) + n) % n)];
}

// ---------------------------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------------------------

/** Five colours, darkest to lightest. */
type Palette = readonly [string, string, string, string, string];

const PALETTES: readonly { match: RegExp; palette: Palette }[] = [
  { match: /horror|slasher|ghost/, palette: ["#0b0b0d", "#3a0d0f", "#8c1c13", "#d9c7a1", "#f2e8d5"] },
  { match: /science|cyberpunk|space|dystop/, palette: ["#05070f", "#0f2a4a", "#1f8a9e", "#e04f8a", "#f4f1e8"] },
  { match: /fantasy|animat|family|children/, palette: ["#13243a", "#2f6f73", "#e3b23c", "#e86a4f", "#f6efe0"] },
  { match: /noir|crime|gangster|heist|thriller|mystery/, palette: ["#0e1116", "#1f2a33", "#4b5d67", "#c9a227", "#e8dcc2"] },
  { match: /war|epic|histor|disaster|western/, palette: ["#1d1a14", "#4a3f2a", "#8a7650", "#c9b38a", "#efe6d2"] },
  { match: /romance|comedy|musical/, palette: ["#2b1b23", "#8e3b46", "#e07a5f", "#f2cc8f", "#fbf3e4"] },
  { match: /adventure|action|superhero/, palette: ["#101820", "#2c4a52", "#d9822b", "#f2b134", "#f7f0e1"] },
];
const DEFAULT_PALETTE: Palette = ["#121212", "#3b3b3b", "#9c9c9c", "#d4b483", "#f0ebe0"];

function paletteFor(genres: readonly string[]): Palette {
  const text = genres.join(" ").toLowerCase();
  return PALETTES.find((p) => p.match.test(text))?.palette ?? DEFAULT_PALETTE;
}

/** Academy ratio before widescreen took over; otherwise flat or scope. */
function heightFor(year: number | null, rng: Rng): number {
  const ratio = year !== null && year < 1953 ? 1.37 : rng.pick([1.85, 2.39]);
  return Math.round(WIDTH / ratio / 2) * 2;
}

const esc = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const f = (n: number) => n.toFixed(1);
const between = (rng: Rng, lo: number, hi: number) => lo + rng.next() * (hi - lo);

interface Canvas {
  w: number;
  h: number;
  p: Palette;
  rng: Rng;
}

/** A cut-paper figure standing on `baseY`, `size` tall. */
function figure(x: number, baseY: number, size: number, fill: string): string {
  const s = size;
  return `<path fill="${fill}" d="M${f(x - 0.17 * s)} ${f(baseY)} L${f(x - 0.15 * s)} ${f(baseY - 0.6 * s)} Q${f(x - 0.14 * s)} ${f(baseY - 0.77 * s)} ${f(x)} ${f(baseY - 0.78 * s)} Q${f(x + 0.14 * s)} ${f(baseY - 0.77 * s)} ${f(x + 0.15 * s)} ${f(baseY - 0.6 * s)} L${f(x + 0.17 * s)} ${f(baseY)} Z"/>
<circle fill="${fill}" cx="${f(x)}" cy="${f(baseY - 0.88 * s)}" r="${f(0.1 * s)}"/>`;
}

function gradient(id: string, from: string, to: string, angle = 90): string {
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) / 2;
  const y = Math.sin(rad) / 2;
  return `<linearGradient id="${id}" x1="${f(0.5 - x)}" y1="${f(0.5 - y)}" x2="${f(0.5 + x)}" y2="${f(0.5 + y)}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
}

/** 1: an extreme close-up, nothing but soft fields of colour and one hard edge. */
function macro({ w, h, p, rng }: Canvas): string {
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const color = p[1 + (i % 3)];
    return `<ellipse cx="${f(between(rng, 0, w))}" cy="${f(between(rng, 0, h))}" rx="${f(between(rng, 0.2, 0.45) * w)}" ry="${f(between(rng, 0.2, 0.5) * h)}" fill="${color}" opacity="${between(rng, 0.45, 0.85).toFixed(2)}"/>`;
  }).join("");
  const edge = between(rng, 0.3, 0.7) * w;
  return `<defs>${gradient("bg", p[0], p[1], between(rng, 0, 180))}<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(w * 0.05)}"/></filter></defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<g filter="url(#soft)">${blobs}</g>
<path d="M${f(edge)} 0 L${f(edge + w * 0.18)} ${h}" stroke="${p[4]}" stroke-width="${f(w * 0.004)}" opacity="0.5"/>`;
}

/** 2: out of focus: bokeh discs over a dark ground and a band of light. */
function bokeh({ w, h, p, rng }: Canvas): string {
  const discs = Array.from({ length: 16 }, () => {
    const r = between(rng, 0.02, 0.08) * w;
    return `<circle cx="${f(between(rng, 0, w))}" cy="${f(between(rng, 0.1, 0.9) * h)}" r="${f(r)}" fill="${rng.pick([p[3], p[4], p[2]])}" opacity="${between(rng, 0.15, 0.55).toFixed(2)}"/>`;
  }).join("");
  const band = between(rng, 0.35, 0.65) * h;
  return `<defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f(w * 0.006)}"/></filter><filter id="haze" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${f(h * 0.06)}"/></filter></defs>
<rect width="${w}" height="${h}" fill="${p[0]}"/>
<rect x="0" y="${f(band - h * 0.08)}" width="${w}" height="${f(h * 0.16)}" fill="${p[1]}" filter="url(#haze)"/>
<g filter="url(#blur)">${discs}</g>`;
}

/** 3: an establishing shot: sky, a low sun, a skyline on the horizon. */
function establishing({ w, h, p, rng }: Canvas): string {
  const horizon = between(rng, 0.58, 0.7) * h;
  let x = 0;
  const blocks: string[] = [];
  while (x < w) {
    const bw = between(rng, 0.03, 0.09) * w;
    const bh = between(rng, 0.04, 0.22) * h;
    blocks.push(`<rect x="${f(x)}" y="${f(horizon - bh)}" width="${f(bw + 1)}" height="${f(bh + 1)}"/>`);
    x += bw;
  }
  const sunX = between(rng, 0.2, 0.8) * w;
  return `<defs>${gradient("sky", p[1], p[3], 90)}<radialGradient id="glow"><stop offset="0" stop-color="${p[4]}" stop-opacity="0.9"/><stop offset="1" stop-color="${p[4]}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
<circle cx="${f(sunX)}" cy="${f(horizon - h * 0.12)}" r="${f(h * 0.3)}" fill="url(#glow)"/>
<circle cx="${f(sunX)}" cy="${f(horizon - h * 0.12)}" r="${f(h * 0.07)}" fill="${p[4]}"/>
<g fill="${p[0]}">${blocks.join("")}</g>
<rect y="${f(horizon)}" width="${w}" height="${f(h - horizon)}" fill="${p[0]}"/>
<rect y="${f(horizon + h * 0.04)}" width="${w}" height="${f(h * 0.006)}" fill="${p[2]}" opacity="0.6"/>`;
}

/** 4: a figure framed in a lit doorway, with a long shadow across the floor. */
function doorway({ w, h, p, rng }: Canvas): string {
  const dw = between(rng, 0.16, 0.22) * w;
  const dx = between(rng, 0.2, 0.8) * w - dw / 2;
  const top = h * 0.12;
  const floor = h * 0.86;
  const cx = dx + dw / 2;
  return `<defs>${gradient("wall", p[1], p[0], 0)}${gradient("door", p[4], p[3], 90)}</defs>
<rect width="${w}" height="${h}" fill="url(#wall)"/>
<rect x="${f(dx)}" y="${f(top)}" width="${f(dw)}" height="${f(floor - top)}" fill="url(#door)"/>
<polygon points="${f(dx)},${f(floor)} ${f(dx + dw)},${f(floor)} ${f(cx + w * 0.42)},${h} ${f(cx - w * 0.42)},${h}" fill="${p[3]}" opacity="0.35"/>
${figure(cx, floor, (floor - top) * 0.78, p[0])}
<polygon points="${f(cx - dw * 0.12)},${f(floor)} ${f(cx + dw * 0.12)},${f(floor)} ${f(cx + w * 0.08)},${h} ${f(cx - w * 0.08)},${h}" fill="${p[0]}" opacity="0.8"/>`;
}

/** 5: a two-shot at dusk, with the release year on a sign between them. */
function twoShot({ w, h, p, rng }: Canvas, year: number | null): string {
  const ground = h * 0.92;
  const size = h * between(rng, 0.62, 0.72);
  const gap = w * between(rng, 0.24, 0.32);
  const cx = w / 2;
  const signW = w * 0.16;
  const signH = h * 0.13;
  const sign = year === null ? "" : `<g transform="translate(${f(cx - signW / 2)} ${f(h * 0.14)})"><rect width="${f(signW)}" height="${f(signH)}" fill="${p[0]}" stroke="${p[4]}" stroke-width="${f(w * 0.003)}"/>
<text x="${f(signW / 2)}" y="${f(signH * 0.72)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(signH * 0.62)}" letter-spacing="${f(signH * 0.06)}" fill="${p[4]}">${year}</text></g>`;
  return `<defs>${gradient("dusk", p[2], p[1], 90)}</defs>
<rect width="${w}" height="${h}" fill="url(#dusk)"/>
<rect y="${f(h * 0.7)}" width="${w}" height="${f(h * 0.3)}" fill="${p[1]}" opacity="0.7"/>
${sign}
${figure(cx - gap / 2, ground, size, p[0])}
${figure(cx + gap / 2, ground, size * between(rng, 0.88, 1), p[0])}
<rect y="${f(ground)}" width="${w}" height="${f(h - ground)}" fill="${p[0]}"/>`;
}

/** "The Dark Knight" → "T__ D___ K_____": first letters kept, other letters blanked. */
export function initialsPattern(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const letters = [...word];
      const first = letters.findIndex((c) => /[\p{L}\p{N}]/u.test(c));
      return letters.map((c, i) => (i === first || !/[\p{L}\p{N}]/u.test(c) ? c : "_")).join("");
    })
    .join(" ");
}

/** 6: a title card: blanked title, year and the director's surname. */
function titleCard({ w, h, p }: Canvas, film: FilmRecord): string {
  const pattern = initialsPattern(film.title).toUpperCase();
  // Helvetica Bold averages ~0.62em per glyph here, plus 0.12em letter-spacing; fit inside the 0.8w box.
  const size = Math.min(h * 0.2, (w * 0.8) / (Math.max(4, pattern.length) * 0.74));
  const director = film.directors[0]?.split(/\s+/).at(-1) ?? "";
  const meta = [film.year, director.toUpperCase()].filter(Boolean).join("  ·  ");
  return `<rect width="${w}" height="${h}" fill="${p[0]}"/>
<rect x="${f(w * 0.06)}" y="${f(h * 0.22)}" width="${f(w * 0.88)}" height="${f(h * 0.5)}" fill="none" stroke="${p[3]}" stroke-width="${f(w * 0.004)}"/>
<text x="${f(w / 2)}" y="${f(h * 0.5)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(size)}" letter-spacing="${f(size * 0.12)}" fill="${p[4]}">${esc(pattern)}</text>
<text x="${f(w / 2)}" y="${f(h * 0.64)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(h * 0.055)}" letter-spacing="${f(h * 0.012)}" fill="${p[3]}">${esc(meta)}</text>`;
}

// ---------------------------------------------------------------------------------------------

export default defineFixtureGenerator({
  game: frameByFrame,
  async generate(ctx) {
    await ensureCatalog(ctx.db);
    const films = await ctx.topFilms({ limit: 120, requireDirectors: true });
    const film = filmForDay(films, ctx.date);
    const canvas: Canvas = { w: WIDTH, h: heightFor(film.year, ctx.rng), p: paletteFor(film.genres), rng: ctx.rng };

    const scenes = [macro(canvas), bokeh(canvas), establishing(canvas), doorway(canvas), twoShot(canvas, film.year), titleCard(canvas, film)];
    if (scenes.length !== FRAME_COUNT) throw new Error(`Expected ${FRAME_COUNT} frames, drew ${scenes.length}`);

    const frames: AssetRef[] = [];
    for (const [index, content] of scenes.entries()) {
      frames.push(
        await ctx.addAsset({
          kind: "frame",
          visibility: index === 0 ? "shown" : "secret",
          image: fixtureSvg({ width: canvas.w, height: canvas.h, content }),
          maxWidth: WIDTH,
        }),
      );
    }
    const [first, ...later] = frames;
    return { puzzle: { fixture: true, first }, solution: { answer: toFilmDetails(film), later } };
  },
});
