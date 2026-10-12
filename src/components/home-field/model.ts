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
  /** A picture that is light (Fade to Color's strip): it fades from black into colour and drifts. */
  | { kind: "light"; image: AssetRef }
  /** Two names and the taut thread between them, a knot per link of par (Degrees). */
  | { kind: "thread"; from: string; to: string; knots: number; drawn: number }
  /** A slot of frames, the latest lit (Frame by Frame). */
  | { kind: "frames"; image: AssetRef; total: number; shown: number }
  /** A day's letters, set large in a row (Lexicon), with the length of the word hidden among them. */
  | { kind: "letters"; letters: string; length: number }
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
  /** Its category's id: the category's plate leads its games (see `fieldPlan`). */
  group: string;
  name: string;
  /** The game's name as written ("Fade to Color"), for its title card. */
  title: string;
  /** What the game is, in a line ("Name the film from a single frame"). */
  tagline: string;
  /** Under the name: what the game is today, or where you are in it. */
  sub: string;
  /** The title card's button: "Play · 100", or "Continue · reel 4" for a game you've started. */
  cta: { verb: "Play" | "Continue"; detail: string };
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
  return { strip: compact ? 64 : 132, band: compact ? 72 : 96, minRow: compact ? 220 : 280, slot: { min: 270, max: 520 }, lean: 0.083, compact };
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
 * plate (its name, set large) leads its games and takes the slots they leave in its row; small
 * categories share a row. A category whose games fill their rows exactly gets its plate as a band
 * above them instead.
 *
 * Pieces are numbered tiles first (their index in `tiles`), then plates (`tiles.length + c` for
 * the c-th category in `categories`).
 */
export interface FieldPlan {
  rows: number[][];
  /** Each piece's share of its row, in slots: 1 for a game, what's left for a plate. */
  slots: number[];
  /** Rows that are a plate alone (a band of fixed height). */
  bands: boolean[];
  /** The categories in order of their first game, as group ids. */
  categories: string[];
}

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
  const slots = [...tiles.map(() => 1), ...categories.map(() => 1)];
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
    if (own.length + 1 <= perRow) {
      if (used + own.length + 1 > perRow) close();
      open.push(plate, ...own);
      used += own.length + 1;
      return;
    }
    close();
    // A big category: full rows of games, the first short by what its plate needs.
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
 * The plan for a screen: how many slots a row holds is chosen, not fixed. On a phone it's two. On
 * a wider screen it's anything from rows of slots no wider than `slot.max` to rows of slots no
 * narrower than `slot.min`, and the field takes the count that leaves plates least to fill
 * (games, not names, should fill the screen), preferring one whose rows fit the screen, then fewer
 * rows (taller games).
 */
export function choosePlan(
  tiles: readonly Pick<HomeTile, "group">[],
  screen: { width: number; height: number },
  metrics: { band: number; minRow: number; compact: boolean; slot: { min: number; max: number } },
): FieldPlan {
  const low = metrics.compact ? 2 : Math.max(2, Math.ceil(screen.width / metrics.slot.max));
  const high = metrics.compact ? 2 : Math.max(low, Math.floor(screen.width / metrics.slot.min));
  let best: { plan: FieldPlan; cost: [number, number, number] } | null = null;
  for (let perRow = low; perRow <= high; perRow++) {
    const plan = fieldPlan(tiles, perRow);
    // A plate's slots beyond its first; a plate alone in a band counts as one.
    const spare = plan.rows.reduce((n, row, r) => n + (plan.bands[r] ? 1 : row.filter((i) => i >= tiles.length).reduce((m, i) => m + plan.slots[i]! - 1, 0)), 0);
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
