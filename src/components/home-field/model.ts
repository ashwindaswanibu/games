import type { AssetRef, SealedAssets } from "@/core/assets";

/*
 * The home as a field (see field.tsx): today's games share the screen equally, cut by slanted
 * seams, each category led by a plate with its name. A game still to play holds its share; finishing collapses it into a strip carrying the
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
  /** A picture that is light (Fade to Color's strip), on a cut of the reel with its edge print ("LEADER ◂ 10", "REEL 04 ◂ 10"). */
  | { kind: "light"; image: AssetRef; edge: string }
  /** Two names and the taut thread between them, a knot per link of par (Degrees). */
  | { kind: "thread"; from: string; to: string; knots: number; drawn: number }
  /** A slot of frames, the latest lit (Frame by Frame). */
  | { kind: "frames"; image: AssetRef; total: number; shown: number }
  /**
   * A day's letters under its dictionary's fore-edge (Lexicon): `total` pages, the gap still open
   * (`low`/`high` are the closest pages guessed either side, -1 and `total` for none), a ribbon at
   * each page guessed (`edge` for the two that bound the gap), and the hidden word's length.
   */
  | {
      kind: "letters";
      letters: string;
      total: number;
      gap: { low: number; high: number };
      /** `found`: the guess that found the word (only ever there once you've finished). */
      ribbons: { page: number; edge: boolean; found: boolean }[];
    }
  /** Any other game: its name, set large. */
  | { kind: "word"; headline: string };

/** A finished game, as the strip and the day's print show it. */
export interface TileResult {
  /** The answer or the puzzle's name ("Dune: Part Two"); empty when the chain says it all. */
  title: string;
  /** How it went, in the game's words ("Named on reel 3"). */
  line: string;
  score: number;
  /** Whether you won (named the film, reached the end, found the word): its colour and light are what you earn. */
  won: boolean;
  /** Under the title, as the game's end card has it: who made the film and when, the word's entry ("verb · take into custody"); empty for none. */
  note: string;
  /** Movie Barcode: the reel the film was named (or picked) on, 1–10; null when it got away or was picked after the last reel. */
  reel: number | null;
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
  /** Its category's id: the category's plate leads its games (see `fieldPlan`). */
  group: string;
  name: string;
  /** The game's name as written ("Movie Barcode"), for its title card. */
  title: string;
  /** The same name in its wordmark's parts, italic where the game's own header sets it so ("Movie *Barcode*"). */
  /** `slit`: printed as a barcode (Movie Barcode's "Barcode"). */
  titleParts: { text: string; italic?: boolean; slit?: boolean }[];
  /** What the game is, in a line ("Name the film from a single frame"). */
  tagline: string;
  /** Under the name: what the game is today, or where you are in it. */
  sub: string;
  /** The title card's button: the game's own first verb ("Roll film"), or where you are in it ("Reel 4"). */
  cta: { label: string; continuing: boolean };
  /** The game's light, "r g b" (its button and edges); null when the browser takes it from the picture (the film's). */
  accent: string | null;
  /** Text on the game's light (its button filled). */
  onAccent: string;
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
  /** "SUN, OCT 11", as the reel's edge prints it. */
  dateShort: string;
  /** The next New York midnight, ISO. */
  rolloverAt: string;
  /** Midnight to midnight in New York, ISO, for the day's line. */
  dayStartsAt: string;
  /** When the server drew the home, ISO: the day's line starts there, so the server's HTML has it right. */
  servedAt: string;
  won: number;
  max: number;
  tiles: HomeTile[];
  /** The categories of today's games. */
  categories: HomeCategory[];
  sealed: SealedAssets;
  user: { username: string; isAdmin: boolean };
}

/**
 * The field's measures for a screen: the width of a finished game's strip, the height of a
 * finished row's band, the least height a row of games keeps, how narrow and how wide a slot in a
 * row may be (see `choosePlan`), and how far the seams lean (as a fraction of a row's height, so every seam keeps one angle).
 */
export function fieldMetrics(width: number): { strip: number; band: number; minRow: number; slot: { min: number; max: number }; lean: number; compact: boolean } {
  const compact = width < 720;
  // A phone holds one game a row: two bands and three rows fill a 390×844 screen under the header exactly.
  return { strip: compact ? 64 : 132, band: compact ? 64 : 96, minRow: compact ? 220 : 280, slot: { min: 270, max: 520 }, lean: 0.083, compact };
}

/** A category on the home: its plate carries its name. */
export interface HomeCategory {
  id: string;
  name: string;
  /** What the category is, in a line ("Letters, ladders and lists"). */
  tagline: string;
}

/**
 * How the field is cut: rows of pieces, each piece a game's tile or a category's plate. Every row
 * holds `perRow` game-sized slots, so every game is the same size wherever it sits. A category's
 * plate (its name, standing up its seam) leads its games in half a slot (`PLATE`), and takes the
 * slots they leave in its row; small categories share a row. A category whose games fill their
 * rows exactly gets its plate as a band above them instead.
 *
 * Pieces are numbered tiles first (their index in `tiles`), then plates (`tiles.length + c` for
 * the c-th category in `categories`).
 */
export interface FieldPlan {
  rows: number[][];
  /** Each piece's share of its row, in slots: 1 for a game, `PLATE` or what's left for a plate. */
  slots: number[];
  /** Rows that are a plate alone (a band of fixed height). */
  bands: boolean[];
  /** The categories in order of their first game, as group ids. */
  categories: string[];
}

/** A plate's least share of its row, in slots: its name stands up the cut, so half a game's width holds it. */
export const PLATE = 0.5;

export function fieldPlan(tiles: readonly Pick<HomeTile, "group">[], perRow: number): FieldPlan {
  const categories: string[] = [];
  const games: number[][] = [];
  tiles.forEach((tile, i) => {
    const c = categories.indexOf(tile.group);
    if (c >= 0) games[c]!.push(i);
    else {
      categories.push(tile.group);
      games.push([i]);
    }
  });
  const slots = [...tiles.map(() => 1), ...categories.map(() => PLATE)];
  const rows: number[][] = [];
  const bands: boolean[] = [];
  // The row being filled with small categories, and the slots it has used.
  let open: number[] = [];
  let used = 0;
  const close = () => {
    if (open.length === 0) return;
    // What the row's categories leave goes to its first plate.
    slots[open[0]!]! += perRow - used;
    rows.push(open);
    bands.push(false);
    open = [];
    used = 0;
  };
  games.forEach((own, c) => {
    const plate = tiles.length + c;
    if (own.length + PLATE <= perRow) {
      if (used + own.length + PLATE > perRow) close();
      open.push(plate, ...own);
      used += own.length + PLATE;
      return;
    }
    close();
    // A big category: full rows of games, the first short by what its plate needs (for whole
    // counts of games, rounding n + 1 slots up to rows is the same as rounding n + PLATE).
    const count = Math.ceil((own.length + 1) / perRow);
    const first = own.length - (count - 1) * perRow;
    if (first === 0) {
      rows.push([plate]);
      bands.push(true);
      slots[plate] = perRow;
    } else {
      rows.push([plate, ...own.slice(0, first)]);
      bands.push(false);
      slots[plate] = perRow - first;
    }
    for (let r = 0; r < count - 1; r++) {
      rows.push(own.slice(first + r * perRow, first + (r + 1) * perRow));
      bands.push(false);
    }
  });
  close();
  return { rows, slots, bands, categories };
}

/**
 * Where each piece lies along one axis, in order: `[start, end]`. `collapse[i]` is how far piece i
 * has become a strip of `strip` (0–1); the others share what's left by their weight (1 by
 * default). A `fixed` piece is always a strip. `print` evens everything else out by weight; `open`
 * grows one piece over all.
 */
export function spans(params: {
  length: number;
  collapse: readonly number[];
  weight?: readonly number[];
  /** Pieces that are always a strip, whatever happens to the rest. */
  fixed?: readonly boolean[];
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
  const fixed = (i: number) => params.fixed?.[i] === true;
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const strips = collapse.map((c, i) => (strip + (params.extra?.[i] ?? 0)) * (fixed(i) ? 1 : c));
  const openWeights = collapse.map((c, i) => (fixed(i) ? 0 : (1 - c) * weight[i]!));
  const openSum = sum(openWeights);
  const space = Math.max(0, length - sum(strips));
  let sizes = collapse.map((_, i) => strips[i]! + (openSum > 1e-6 ? (openWeights[i]! / openSum) * space : 0));
  // What the fixed pieces leave, shared by weight: where everything finished rests, and the print.
  const freeWeights = collapse.map((_, i) => (fixed(i) ? 0 : weight[i]!));
  const freeSum = sum(freeWeights);
  const free = length - sum(strips.filter((_, i) => fixed(i)));
  const even = (i: number) => (free * freeWeights[i]!) / freeSum;
  if (freeSum > 1e-6) {
    if (openSum <= 1e-6) sizes = sizes.map((w, i) => (fixed(i) ? w : even(i)));
    sizes = sizes.map((w, i) => (fixed(i) ? w : w + (even(i) - w) * print));
  }
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
 * The whole field: each piece's box (tiles, then plates; see `FieldPlan`). Rows with a game still
 * to play share the height equally; a row whose games are all finished is a band, and so is a
 * plate alone. Within a row, pieces share the width by their slots and a finished game is a strip;
 * once the row is done its plate becomes one too. `open` grows one tile over the whole field.
 */
export function fieldLayout(params: {
  width: number;
  height: number;
  plan: Pick<FieldPlan, "rows" | "slots" | "bands">;
  /** Each tile's collapse (plates follow their rows). */
  collapse: readonly number[];
  print: number;
  open: { index: number; amount: number } | null;
  /** A played game's strip opened a little (under the pointer), and how far. */
  peek?: { index: number; amount: number } | null;
  metrics: { strip: number; band: number; lean: number };
}): TileBox[] {
  const { width, height, plan, collapse, print, open, metrics } = params;
  const { rows, slots, bands } = plan;
  const peek = params.peek ?? null;
  const isTile = (i: number) => i < collapse.length;
  const rowCollapse = rows.map((row, r) => {
    const games = row.filter(isTile);
    return bands[r] || games.length === 0 ? 1 : Math.min(...games.map((i) => collapse[i]!));
  });
  const openRow = open ? rows.findIndex((r) => r.includes(open.index)) : -1;
  const rowSpans = spans({
    length: height,
    collapse: rowCollapse,
    fixed: bands,
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
      collapse: row.map((i) => (isTile(i) ? collapse[i]! : bands[r] ? 0 : rowCollapse[r]!)),
      weight: row.map((i) => slots[i] ?? 1),
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

/**
 * The plan for a screen: how many slots a row holds is chosen, not fixed. On a phone it's one: a
 * game a row, each category's plate a band above its games. On a wider screen it's anything from
 * rows of slots no wider than `slot.max` to rows of slots no narrower than `slot.min`, and the
 * field takes the count that leaves plates least to fill (games, not names, should fill the
 * screen), preferring one whose rows fit the screen, then fewer rows (taller games).
 */
export function choosePlan(
  tiles: readonly Pick<HomeTile, "group">[],
  screen: { width: number; height: number },
  metrics: { band: number; minRow: number; compact: boolean; slot: { min: number; max: number } },
): FieldPlan {
  if (metrics.compact) return fieldPlan(tiles, 1);
  const low = Math.max(2, Math.ceil(screen.width / metrics.slot.max));
  const high = Math.max(low, Math.floor(screen.width / metrics.slot.min));
  let best: { plan: FieldPlan; cost: [number, number, number] } | null = null;
  for (let perRow = low; perRow <= high; perRow++) {
    const plan = fieldPlan(tiles, perRow);
    // A plate's slots beyond its least; a plate alone in a band counts as one.
    const spare = plan.rows.reduce((n, row, r) => n + (plan.bands[r] ? 1 : row.filter((i) => i >= tiles.length).reduce((m, i) => m + plan.slots[i]! - PLATE, 0)), 0);
    const overflows = fieldHeight(0, plan, metrics) > screen.height ? 1 : 0;
    const cost: [number, number, number] = [overflows, spare, plan.rows.length];
    if (!best || before(cost, best.cost)) best = { plan, cost };
  }
  return best!.plan;
}

/** Whether `a` comes before `b`, comparing in order. */
function before(a: readonly number[], b: readonly number[]): boolean {
  const i = a.findIndex((x, j) => x !== b[j]);
  return i >= 0 && a[i]! < b[i]!;
}

/** The field's height: the screen's, or taller when its rows wouldn't keep games playable (the page then scrolls). */
export function fieldHeight(available: number, plan: Pick<FieldPlan, "bands">, metrics: { band: number; minRow: number }): number {
  const bands = plan.bands.filter(Boolean).length;
  return Math.max(200, available, bands * metrics.band + (plan.bands.length - bands) * metrics.minRow);
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

/** The tile's right seam at height `y` (the screen's edge for the last in its row). */
export function rightSeamAt(box: TileBox, lean: number, y: number): number {
  if (box.col === box.cols - 1) return box.x[1];
  const k = leanOf(box, lean);
  const u = (y - box.y[0]) / Math.max(1, box.y[1] - box.y[0]);
  return box.x[1] + k - 2 * k * u;
}

/** A strip's centre line at height `y`: halfway between its edges, so it runs parallel to its seams (half as slanted beside the screen's straight edge). */
export function stripMiddle(box: TileBox, lean: number, y: number): number {
  return (seamAt(box, lean, y) + rightSeamAt(box, lean, y)) / 2;
}

/** How far under friends' scale their names reach (two staggered rows). */
export const SCALE_DEPTH = 36;

/**
 * Where the day's print sets its lines in a poster. `base` is the baseline every result title sits
 * on, so a row of posters reads as one line of credits; under it, the note (who made the film, the
 * word's entry), the result line, and friends' scale. Each depends only on the poster's row (its
 * height), so posters in a row share every line. On a phone the stack is tighter and stays clear
 * of the row's slanted bottom cut, which reaches `cut` above its edge.
 */
export function printLines(box: Pick<TileBox, "y">, compact: boolean, cut: number): { base: number; note: number; line: number; scale: number } {
  if (compact) {
    const base = box.y[1] - cut - 96;
    return { base, note: base + 8, line: base + 30, scale: base + 56 };
  }
  const h = box.y[1] - box.y[0];
  const base = box.y[1] - Math.max(130, Math.min(230, h * 0.28));
  return { base, note: base + 14, line: base + 50, scale: base + 84 };
}

/**
 * The angle a plate's name stands at, in degrees: upright, turned to read up the seam beside it
 * (the seams lean `lean` across per unit down, so the name is a quarter turn less that angle).
 */
export function spineAngle(lean: number): number {
  return -(90 - (Math.atan(lean) * 180) / Math.PI);
}

/**
 * On a phone the field is rows, one game a row, and every cut between rows is the seams' angle
 * turned on its side: rising to the right, through the row's edge `y` at the screen's middle.
 * This is where that cut crosses `x`.
 */
export function rowCut(y: number, lean: number, width: number, x: number): number {
  return y + lean * (width / 2 - x);
}

/** A row's clip on a phone: its cuts above and below, the field's first top and last bottom straight; all run off the screen. */
export function rowClip(box: TileBox, lean: number, width: number, first: boolean, last: boolean): string {
  const a = -400;
  const b = width + 400;
  const top = (x: number) => (first ? box.y[0] : rowCut(box.y[0], lean, width, x));
  const bottom = (x: number) => (last ? box.y[1] : rowCut(box.y[1], lean, width, x));
  return `polygon(${a}px ${top(a)}px, ${b}px ${top(b)}px, ${b}px ${bottom(b)}px, ${a}px ${bottom(a)}px)`;
}

/** Order on the home: games are equal, so the field keeps the registry's order (finishing moves nothing, it collapses in place). */
export function tileTargets(tiles: readonly Pick<HomeTile, "state">[]): { collapse: number[]; print: number } {
  const collapse = tiles.map((t) => (t.state === "finished" ? 1 : 0));
  return { collapse, print: tiles.length > 0 && collapse.every((c) => c === 1) ? 1 : 0 };
}

/**
 * The header's one line about the day: what's left to play, then the points once some are won,
 * then (all played) the points out of the day's `max` and the countdown to the next day. A phone
 * says less.
 */
export function dayLine(tiles: readonly Pick<HomeTile, "state">[], won: number, max: number, clock: string, compact: boolean): string {
  const left = tiles.filter((t) => t.state !== "finished").length;
  const points = `${won} ${won === 1 ? "point" : "points"}`;
  if (tiles.length > 0 && left === 0) return compact ? `All played · ${clock}` : `All played · ${won} of ${max} · Next day in ${clock}`;
  return left < tiles.length && !compact ? `${left} to play · ${points}` : `${left} to play`;
}

/** The longest line of `text` set on `lines` lines (two: split at the space that balances them best), in letters. */
export function longestLine(text: string, lines: number): number {
  if (lines < 2) return text.length;
  let best = text.length;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) best = Math.min(best, Math.max(i, text.length - i - 1));
  return best;
}

/** How far through the New York day `now` is (0 at midnight, 1 at the next). */
export function dayFraction(now: number, dayStartsAt: string, rolloverAt: string): number {
  const start = Date.parse(dayStartsAt);
  const end = Date.parse(rolloverAt);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// ---------------------------------------------------------------------------------------------
// The first frame
// ---------------------------------------------------------------------------------------------

/** A window's size in CSS pixels: the field is laid out for one. */
export interface WindowSize {
  width: number;
  height: number;
}

/**
 * The browser keeps its window's size in this cookie (`viewportCookie`), so the server lays the
 * field out for the screen it's going to (`viewportFor`) and its HTML can be the home's first frame.
 */
export const VIEWPORT_COOKIE = "vw";

/** What the server lays the field out for before the browser has said: a phone's window or a laptop's. */
export const PHONE: WindowSize = { width: 390, height: 844 };
export const LAPTOP: WindowSize = { width: 1440, height: 900 };

/** The cookie for a window's size (`document.cookie = …`), kept a year. */
export function viewportCookie(size: WindowSize): string {
  return `${VIEWPORT_COOKIE}=${Math.round(size.width)}x${Math.round(size.height)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * The window the server lays the field out for: the size its cookie last said ("390x844"), or,
 * without one (or a garbled one), a phone's or a laptop's by what the request says it is.
 */
export function viewportFor(cookie: string | undefined, mobile: boolean): WindowSize {
  const said = /^([1-9]\d{1,3})x([1-9]\d{1,3})$/.exec(cookie ?? "");
  if (said) return { width: Number(said[1]), height: Number(said[2]) };
  return mobile ? PHONE : LAPTOP;
}

/** Whether a request comes from a phone: Chromium's `Sec-CH-UA-Mobile: ?1`, or "Mobi" in the user agent (Safari and Firefox say so there). */
export function isMobileAgent(hint: string | null, userAgent: string | null): boolean {
  return hint === "?1" || /Mobi/.test(userAgent ?? "");
}

/** The home's memory in the browser: the day it last arrived (localStorage), and what this tab last showed (sessionStorage). */
export const ARRIVED_KEY = "home:arrived";
export const SHOWN_KEY = "home:tiles";

/** What this tab last showed of the home: the day, and each game's state then. */
export interface HomeShown {
  date: string;
  states: Record<string, string>;
}

/**
 * How the field comes on: the day's first visit arrives, once (`arrival`); back from a game you've
 * just finished (one this tab showed unfinished today), that game shrinks from the whole screen into
 * its strip (`back`); otherwise, and always with reduced motion, it's simply there (`still`).
 */
export type Entrance = { kind: "arrival" } | { kind: "back"; index: number } | { kind: "still" };

export function entrance(tiles: readonly Pick<HomeTile, "id" | "state">[], date: string, memory: { arrived: string | null; shown: HomeShown | null }, reducedMotion: boolean): Entrance {
  if (reducedMotion) return { kind: "still" };
  const states = memory.shown?.date === date ? memory.shown.states : null;
  const index = states ? tiles.findIndex((t) => t.state === "finished" && states[t.id] !== undefined && states[t.id] !== "finished") : -1;
  if (index >= 0) return { kind: "back", index };
  return memory.arrived === date ? { kind: "still" } : { kind: "arrival" };
}

/** The attribute that holds the field under the ground until it's ready (field.module.css). */
export const HOLD = "data-hold";

/**
 * The field's own script, run as the browser reads the page (before React, before the first paint),
 * as the first child of the field's root. It holds the field (`HOLD` on the root) when it's going to
 * move as it comes on (`entrance`, worked out the same way from the same memory) or when the window
 * isn't the size the server laid it out for (React lays it out again first). Any other visit, the
 * server's HTML is what shows.
 */
export function entranceScript(tiles: readonly Pick<HomeTile, "id" | "state">[], date: string, laidOut: WindowSize): string {
  // JSON in a script: "<" escaped so no value can close it.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const finished = tiles.filter((t) => t.state === "finished").map((t) => t.id);
  return [
    "(function(root,date,finished,size){",
    "function read(store,key){try{var raw=window[store].getItem(key);return raw?JSON.parse(raw):null}catch(e){return null}}",
    "var still=false;try{still=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}",
    `var shown=read('sessionStorage',${json(SHOWN_KEY)});`,
    "var states=shown&&shown.date===date?shown.states:null;",
    "var back=!!states&&finished.some(function(id){return states[id]!==undefined&&states[id]!=='finished'});",
    `var moves=!still&&(back||read('localStorage',${json(ARRIVED_KEY)})!==date);`,
    `if(moves||innerWidth+'x'+innerHeight!==size)root.setAttribute(${json(HOLD)},'')`,
    `})(document.currentScript.parentNode,${json(date)},${json(finished)},${json(`${laidOut.width}x${laidOut.height}`)})`,
  ].join("");
}
