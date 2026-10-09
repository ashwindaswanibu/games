import type { AssetRef, SealedAssets } from "@/core/assets";

/*
 * The home as a field (see field.tsx): today's games share the screen equally, cut by slanted
 * seams. A game still to play holds its share; finishing collapses it into a strip carrying the
 * result while the others widen; when every game is done the strips widen again into the day's
 * print, equal and resolved. Opening a game grows its tile over the whole field.
 *
 * The browser never learns which game is which beyond this model: each tile says what material to
 * draw (light, a thread, frames, a word), so the field's code names no game (testing games stay
 * out of players' bundles; see scripts/check-client-bundles.mts). Pure; everything here is tested.
 */

export type TileState = "unplayed" | "playing" | "finished";

/** What a tile is made of: today's puzzle itself, drawn the game's way. */
export type TileMaterial =
  /** A picture that is light (Fade to Color's strip): it fades from black into colour and drifts. */
  | { kind: "light"; image: AssetRef }
  /** Two names and the taut thread between them, a knot per link of par (Degrees). */
  | { kind: "thread"; from: string; to: string; knots: number; drawn: number }
  /** A slot of frames, the latest lit (Frame by Frame). */
  | { kind: "frames"; image: AssetRef; total: number; shown: number }
  /** Any other game: its name, set large. */
  | { kind: "word"; headline: string };

/** A finished game, as the strip and the day's print show it. */
export interface TileResult {
  /** The answer or the puzzle's name ("Dune: Part Two"); empty when the chain says it all. */
  title: string;
  /** How it went, in the game's words ("Named on reel 3"). */
  line: string;
  score: number;
  /** A picture to fill the print with (the strip of light, the frame it was named on). */
  image: AssetRef | null;
  /** Degrees: the chain the player made. */
  chain: { people: string[]; films: string[] } | null;
  /** Frame by Frame: the frames seen, the last being the one it was named on. */
  frames: AssetRef[] | null;
}

/** Another player who finished: a mark on the tile. Who and how they did show once you've finished too. */
export interface FriendMark {
  name: string;
  score: number;
}

export interface HomeTile {
  id: string;
  /** Its category: each starts a row of the field. */
  group: string;
  name: string;
  /** Under the name: what the game is today, or where you are in it. */
  sub: string;
  href: string;
  state: TileState;
  material: TileMaterial;
  result: TileResult | null;
  friends: { finished: number; marks: FriendMark[] | null };
  /** A spoken summary for the tile's link. */
  label: string;
}

export interface HomeModel {
  date: string;
  /** "THURSDAY · 8 OCTOBER" */
  dateLabel: string;
  /** The next New York midnight, ISO. */
  rolloverAt: string;
  /** Midnight to midnight in New York, ISO, for the day's line. */
  dayStartsAt: string;
  won: number;
  max: number;
  tiles: HomeTile[];
  sealed: SealedAssets;
  user: { username: string; isAdmin: boolean };
}

/**
 * The field's measures for a screen: how many games a row holds before wrapping, the width of a
 * finished game's strip, the height of a finished row's band, and how far the seams lean (as a
 * fraction of a row's height, so every seam keeps one angle).
 */
export function fieldMetrics(width: number): { perRow: number; strip: number; band: number; lean: number; compact: boolean } {
  const compact = width < 720;
  return { perRow: compact ? 2 : 4, strip: compact ? 64 : 132, band: compact ? 72 : 96, lean: 0.083, compact };
}

/**
 * Rows of tiles (indexes into `tiles`): each group (a category) starts a row, and a row holds at
 * most `perRow` games, so a category of six becomes two rows of three, not a row of four and two.
 */
export function fieldRows(tiles: readonly Pick<HomeTile, "group">[], perRow: number): number[][] {
  const groups: number[][] = [];
  tiles.forEach((tile, i) => {
    const last = groups.at(-1);
    if (last && tiles[last[0]!]!.group === tile.group) last.push(i);
    else groups.push([i]);
  });
  return groups.flatMap((group) => {
    const rows = Math.ceil(group.length / perRow);
    const size = Math.ceil(group.length / rows);
    return Array.from({ length: rows }, (_, r) => group.slice(r * size, (r + 1) * size));
  });
}

/**
 * Where each piece lies along one axis, in order: `[start, end]`. `collapse[i]` is how far piece i
 * has become a strip of `strip` (0–1); the others share what's left by their open weight (1 for a
 * game, its open games for a row). `print` evens everything out; `open` grows one piece over all.
 */
export function spans(params: {
  length: number;
  collapse: readonly number[];
  weight?: readonly number[];
  /** Extra width for a strip (a played game opened a little under the pointer). */
  extra?: readonly number[];
  print: number;
  open: { index: number; amount: number } | null;
  strip: number;
  overshoot: number;
}): [number, number][] {
  const { length, collapse, print, open, strip, overshoot } = params;
  const n = collapse.length;
  if (n === 0) return [];
  const weight = params.weight ?? collapse.map(() => 1);
  const strips = collapse.map((c, i) => (strip + (params.extra?.[i] ?? 0)) * c);
  const openWeights = collapse.map((c, i) => (1 - c) * weight[i]!);
  const openSum = openWeights.reduce((a, b) => a + b, 0);
  const space = Math.max(0, length - strips.reduce((a, b) => a + b, 0));
  let sizes = collapse.map((_, i) => strips[i]! + (openSum > 1e-6 ? (openWeights[i]! / openSum) * space : 0));
  // Everything finished: the leftover space is shared equally until the print takes over.
  if (openSum <= 1e-6) sizes = sizes.map((w) => w + space / n);
  sizes = sizes.map((w) => w + (length / n - w) * print);
  let start = 0;
  if (open && open.amount > 0) {
    const x = open.amount;
    sizes = sizes.map((w, i) => (i === open.index ? w + (length + 2 * overshoot - w) * x : w * (1 - x)));
    const before = sizes.slice(0, open.index).reduce((a, b) => a + b, 0);
    start = (-overshoot - before) * x;
  }
  const out: [number, number][] = [];
  for (const w of sizes) {
    out.push([start, start + w]);
    start += w;
  }
  return out;
}

/** How much wider a played game's strip opens under the pointer. */
export const PEEK = 150;

export interface TileBox {
  x: [number, number];
  y: [number, number];
  /** Where the tile sits: its row, its place in the row, the row's size. */
  row: number;
  col: number;
  cols: number;
}

/**
 * The whole field: each tile's box. Rows share the height by how many of their games are still to
 * play (a finished row is a band); within a row, games share the width the same way (a finished
 * game is a strip). `open` grows one tile over the whole field.
 */
export function fieldLayout(params: {
  width: number;
  height: number;
  rows: readonly (readonly number[])[];
  collapse: readonly number[];
  print: number;
  open: { index: number; amount: number } | null;
  /** A played game's strip opened a little (under the pointer), and how far. */
  peek?: { index: number; amount: number } | null;
  metrics: { strip: number; band: number; lean: number };
}): TileBox[] {
  const { width, height, rows, collapse, print, open, metrics } = params;
  const peek = params.peek ?? null;
  const openRow = open ? rows.findIndex((r) => r.includes(open.index)) : -1;
  const rowSpans = spans({
    length: height,
    collapse: rows.map((r) => Math.min(...r.map((i) => collapse[i]!))),
    // A row's share of the height: its games still to play.
    weight: rows.map((r) => r.reduce((sum, i) => sum + (1 - collapse[i]!), 0)),
    print,
    open: openRow >= 0 ? { index: openRow, amount: open!.amount } : null,
    strip: metrics.band,
    overshoot: 40,
  });
  const boxes: TileBox[] = [];
  rows.forEach((row, r) => {
    const y = rowSpans[r]!;
    const lean = metrics.lean * (y[1] - y[0]);
    const xs = spans({
      length: width,
      collapse: row.map((i) => collapse[i]!),
      extra: row.map((i) => (peek && peek.index === i ? PEEK * peek.amount : 0)),
      print,
      open: r === openRow ? { index: row.indexOf(open!.index), amount: open!.amount } : null,
      strip: metrics.strip,
      overshoot: lean + 60,
    });
    row.forEach((i, c) => {
      boxes[i] = { x: xs[c]!, y, row: r, col: c, cols: row.length };
    });
  });
  return boxes;
}

/** How far a tile's seams lean at its height (one angle everywhere). */
export function leanOf(box: TileBox, lean: number): number {
  return (lean * (box.y[1] - box.y[0])) / 2;
}

/** The clip polygon of a tile: slanted seams between neighbours, straight outer edges run off the field. */
export function tileClip(box: TileBox, lean: number): string {
  const k = leanOf(box, lean);
  const a = box.col === 0 ? box.x[0] - 400 : box.x[0];
  const b = box.col === box.cols - 1 ? box.x[1] + 400 : box.x[1];
  const [top, bottom] = box.y;
  return `polygon(${a + k}px ${top}px, ${b + k}px ${top}px, ${b - k}px ${bottom}px, ${a - k}px ${bottom}px)`;
}

/** The tile's left seam at height `y` (inside the tile), so text keeps its margin down a slanted edge. */
export function seamAt(box: TileBox, lean: number, y: number): number {
  // The first tile's outer edge is the screen's, straight.
  if (box.col === 0) return Math.max(0, box.x[0]);
  const k = leanOf(box, lean);
  const u = (y - box.y[0]) / Math.max(1, box.y[1] - box.y[0]);
  return box.x[0] + k - 2 * k * u;
}

/** Order on the home: games are equal, so the field keeps the registry's order (finishing moves nothing, it collapses in place). */
export function tileTargets(tiles: readonly Pick<HomeTile, "state">[]): { collapse: number[]; print: number } {
  const collapse = tiles.map((t) => (t.state === "finished" ? 1 : 0));
  return { collapse, print: tiles.length > 0 && collapse.every((c) => c === 1) ? 1 : 0 };
}

/** How far through the New York day `now` is (0 at midnight, 1 at the next). */
export function dayFraction(now: number, dayStartsAt: string, rolloverAt: string): number {
  const start = Date.parse(dayStartsAt);
  const end = Date.parse(rolloverAt);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}
