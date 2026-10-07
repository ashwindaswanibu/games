/**
 * Hand-cut paper geometry: seeded scissor cuts, torn edges and the cut-paper alphabet. Pure and
 * deterministic (no DOM, no clock, no Math.random): the same seed gives byte-identical strings on
 * the server and in every browser, so server-rendered clip paths hydrate without a mismatch and
 * every device sees the same picture for a day.
 *
 * Polygons are in percent space (0–100 on both axes) unless noted. Seeds are strings derived from
 * the day ("2026-10-07:band"), so nothing depends on render order.
 *
 * Visual randomness only: puzzle generation uses src/core/random.ts.
 */

export type Pt = readonly [number, number];
export type Polygon = readonly Pt[];
export type Rng = () => number;

// ---------------------------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------------------------

/** FNV-1a over UTF-16 code units. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast PRNG with a 32-bit state. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded generator: strings are hashed with FNV-1a, numbers are used as the state directly. */
export function rng(seed: string | number): Rng {
  return mulberry32(typeof seed === "number" ? seed : hashString(seed));
}

/** A uniform float in [lo, hi). */
export function between(r: Rng, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

// ---------------------------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------------------------

/** Fixed decimals, never "-0.00", so server and browser output match exactly. */
export function fixed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** A CSS `polygon(...)` in percent units. */
export function polygon(pts: Polygon): string {
  return `polygon(${pts.map(([x, y]) => `${fixed(x)}% ${fixed(y)}%`).join(",")})`;
}

export interface CutRectOptions {
  /** How far each corner may be cut in (percent). */
  j?: number;
  /** Wobble of the straight segments (percent). */
  a?: number;
  /** Segments per side: top, right, bottom, left. */
  n?: readonly [number, number, number, number];
  /** Sides torn rather than cut. */
  tear?: { t?: boolean; r?: boolean; b?: boolean; l?: boolean };
  /** Points along a torn side. */
  tn?: number;
  /** Depth of a tear (percent). */
  ta?: number;
}

/** A rectangle cut with scissors: jittered corners and slightly-off straight segments, optionally torn sides. */
export function cutRect(r: Rng, o: CutRectOptions = {}): Pt[] {
  const j = o.j ?? 1.6;
  const a = o.a ?? 0.45;
  const n = o.n ?? [3, 2, 3, 2];
  const tear = o.tear ?? {};
  const corners: Pt[] = [
    [r() * j, r() * j],
    [100 - r() * j, r() * j],
    [100 - r() * j, 100 - r() * j],
    [r() * j, 100 - r() * j],
  ];
  const sides = ["t", "r", "b", "l"] as const;
  const pts: Pt[] = [];
  for (let s = 0; s < 4; s++) {
    const A = corners[s];
    const B = corners[(s + 1) % 4];
    const torn = tear[sides[s]] === true;
    const k = torn ? (o.tn ?? 40) : n[s];
    for (let i = 0; i < k; i++) {
      const t = i / k;
      let x = A[0] + (B[0] - A[0]) * t;
      let y = A[1] + (B[1] - A[1]) * t;
      if (i > 0) {
        if (torn) {
          const off = r() * (o.ta ?? 4) * (r() < 0.2 ? 1.8 : 1);
          if (s === 0) y += off;
          else if (s === 1) x -= off;
          else if (s === 2) y -= off;
          else x += off;
        } else {
          const off = (r() - 0.5) * 2 * a;
          if (s % 2 === 0) y += off;
          else x += off;
        }
      }
      pts.push([x, y]);
    }
  }
  return pts;
}

/**
 * A sheet whose bottom edge is torn `depth` pixels deep at most and whose other edges are cut.
 * Mixes % and px, so the tear reads the same at any sheet height and the cut corners stay small
 * on a tall sheet.
 */
export function sheetClip(r: Rng, o: { cut?: number; depth?: number; tornBottom?: boolean } = {}): string {
  const cut = o.cut ?? 2.2; // px a corner may be cut in
  const depth = o.depth ?? 7;
  const px = (n: number) => `${fixed(n, 1)}px`;
  const c = () => r() * cut;
  const pts: string[] = [];
  // Top edge, left to right: three straight cuts.
  pts.push(`${px(c())} ${px(c())}`);
  pts.push(`${fixed(33 + r() * 4)}% ${px(r() * 1.6)}`);
  pts.push(`${fixed(66 + r() * 4)}% ${px(r() * 1.6)}`);
  pts.push(`calc(100% - ${px(c())}) ${px(c())}`);
  // Right edge.
  pts.push(`calc(100% - ${px(r() * 1.8)}) ${fixed(45 + r() * 10)}%`);
  pts.push(`calc(100% - ${px(c())}) calc(100% - ${px(c() + (o.tornBottom ? depth * 0.5 : 0))})`);
  // Bottom edge, right to left: torn, or two cuts.
  if (o.tornBottom) {
    const n = 18;
    let d = depth * 0.5;
    for (let i = 1; i < n; i++) {
      d = Math.max(0.6, Math.min(depth, d + (r() - 0.5) * depth * 0.9));
      pts.push(`${fixed(100 - (i * 100) / n + (r() - 0.5) * 2.4)}% calc(100% - ${px(d)})`);
    }
  } else {
    pts.push(`${fixed(64 + r() * 6)}% calc(100% - ${px(r() * 1.6)})`);
    pts.push(`${fixed(30 + r() * 6)}% calc(100% - ${px(r() * 1.6)})`);
  }
  pts.push(`${px(c())} calc(100% - ${px(c() + (o.tornBottom ? depth * 0.4 : 0))})`);
  // Left edge.
  pts.push(`${px(r() * 1.8)} ${fixed(40 + r() * 10)}%`);
  return `polygon(${pts.join(",")})`;
}

/** A torn top edge (the phone's tab bar), `depth` pixels deep at most. */
export function tornTopClip(r: Rng, depth = 9): string {
  const n = 16;
  const pts: string[] = [];
  let d = 3 + r() * (depth - 4);
  for (let i = 0; i <= n; i++) {
    const x = (i * 100) / n + (i > 0 && i < n ? (r() - 0.5) * 4 : 0);
    d = Math.max(1, Math.min(depth, d + (r() - 0.5) * depth * 1.1));
    pts.push(`${fixed(x, 1)}% ${fixed(d, 1)}px`);
  }
  pts.push("100% 100%", "0 100%");
  return `polygon(${pts.join(",")})`;
}

/** A disc cut freehand in a 0–100 box: `n` points, radius wobbling by up to `w`. */
export function cutCircle(r: Rng, n = 30, w = 1.8): Pt[] {
  const pts: Pt[] = [];
  const phase = r() * 6;
  for (let i = 0; i < n; i++) {
    const angle = ((i + (r() - 0.5) * 0.45) / n) * Math.PI * 2 + phase;
    const radius = 49.6 - r() * w;
    pts.push([50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius]);
  }
  return pts;
}

/** An SVG path for a polygon in user units. */
export function pathOf(pts: Polygon, digits = 2): string {
  return `M${pts.map(([x, y]) => `${fixed(x, digits)} ${fixed(y, digits)}`).join("L")}Z`;
}

/** A small quadrilateral cut by hand: a rectangle whose corners drift by up to `a` (user units). */
export function cutQuad(r: Rng, x: number, y: number, w: number, h: number, a = 0.7): string {
  const j = () => (r() - 0.5) * 2 * a;
  return pathOf([
    [x + j(), y + j()],
    [x + w + j(), y + j()],
    [x + w + j(), y + h + j()],
    [x + j(), y + h + j()],
  ]);
}

/** A small disc cut by hand: `n` points, radius losing up to 7% per point (user units). */
export function cutDisc(r: Rng, cx: number, cy: number, radius: number, n = 14): string {
  const phase = r() * 6;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + phase;
    const rr = radius * (1 - r() * 0.07);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pathOf(pts);
}

// ---------------------------------------------------------------------------------------------
// The dial: the paper that is left of today
// ---------------------------------------------------------------------------------------------

/** The dial's cut rim, centred on 0 in a −50…50 box. */
export function dialRim(seed: string): Pt[] {
  return cutCircle(rng(seed), 40, 1.4).map(([x, y]) => [x - 50, y - 50] as const);
}

/**
 * The paper left of today: a sector from the "now" angle clockwise round to 12 o'clock, its rim
 * cut by hand. `gone` is the fraction of the day already past (0 at midnight, 1 at the next).
 * Full disc at 0, a sliver at 23:00, nothing at 1.
 */
export function dialSector(gone: number, rim: Polygon, radius = 49.2): string {
  if (gone >= 0.9995) return "";
  if (gone <= 0.0005) return pathOf(rim);
  const a0 = gone * Math.PI * 2;
  const tau = Math.PI * 2;
  const kept = rim
    .map(([x, y]) => ({ x, y, ang: (Math.atan2(x, -y) + tau) % tau }))
    .filter((p) => p.ang > a0)
    .sort((a, b) => a.ang - b.ang);
  const start: Pt = [Math.sin(a0) * radius, -Math.cos(a0) * radius];
  return pathOf([[0, 0], start, ...kept.map((p) => [p.x, p.y] as const), [0, -radius]]);
}

// ---------------------------------------------------------------------------------------------
// Cut-paper alphabet
// ---------------------------------------------------------------------------------------------

function ellipse(cx: number, cy: number, rx: number, ry: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

interface Glyph {
  /** Advance width on the 80-unit cap height. */
  readonly w: number;
  /** Outer contour, then counters (drawn with fill-rule evenodd). */
  readonly p: readonly Polygon[];
}

/** Scissor-cut capitals on an 80-unit cap height: the letters of WORDS and FIN. */
export const GLYPHS: Readonly<Record<string, Glyph>> = {
  W: { w: 64, p: [[[0, 0], [13, 0], [19, 52], [27, 12], [37, 12], [45, 52], [51, 0], [64, 0], [53, 80], [40, 80], [32, 40], [24, 80], [11, 80]]] },
  O: { w: 60, p: [ellipse(30, 40, 30, 40, 22), ellipse(30, 40, 13.5, 25, 16)] },
  R: {
    w: 58,
    p: [
      [[0, 0], [36, 0], [48, 5], [55, 16], [55, 30], [47, 40], [58, 80], [43, 80], [32, 46], [14, 46], [14, 80], [0, 80]],
      [[14, 12], [33, 12], [40, 18], [40, 29], [33, 34], [14, 34]],
    ],
  },
  D: {
    w: 58,
    p: [
      [[0, 0], [30, 0], [46, 8], [55, 22], [58, 40], [55, 58], [46, 72], [30, 80], [0, 80]],
      [[14, 13], [28, 13], [39, 21], [43, 40], [39, 59], [28, 67], [14, 67]],
    ],
  },
  S: {
    w: 56,
    p: [[[9, 0], [56, 0], [56, 14], [17, 14], [15, 17], [15, 30], [46, 30], [56, 39], [56, 71], [47, 80], [0, 80], [0, 66], [39, 66], [41, 63], [41, 47], [9, 47], [0, 38], [0, 9]]],
  },
  F: { w: 50, p: [[[0, 0], [50, 0], [50, 14], [15, 14], [15, 33], [43, 33], [43, 46], [15, 46], [15, 80], [0, 80]]] },
  I: { w: 15, p: [[[0, 0], [15, 0], [15, 80], [0, 80]]] },
  N: { w: 58, p: [[[0, 0], [14, 0], [44, 52], [44, 0], [58, 0], [58, 80], [44, 80], [14, 28], [14, 80], [0, 80]]] },
};

/** Adds scissor wobble along each edge of a contour. */
export function wobble(poly: Polygon, r: Rng, step = 11, amp = 0.8): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    out.push([a[0] + (r() - 0.5) * 1.4, a[1] + (r() - 0.5) * 1.4]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.floor(len / step);
    for (let j = 1; j < k; j++) {
      const t = j / k;
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      const off = (r() - 0.5) * 2 * amp;
      out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    }
  }
  return out;
}

export interface CutLetter {
  readonly char: string;
  /** Placement inside the word's viewBox. */
  readonly transform: string;
  /** Outline (with counters) for `fill-rule: evenodd`. */
  readonly d: string;
  /** Centre of the letter in viewBox units, for per-letter motion. */
  readonly cx: number;
  readonly cy: number;
}

export interface CutWord {
  readonly viewBox: string;
  /** Unit width and height of the viewBox (its aspect ratio). */
  readonly width: number;
  readonly height: number;
  readonly letters: readonly CutLetter[];
}

/**
 * A word of scissor-cut capitals, each letter seeded a little off its line and turned up to ±`rot`
 * degrees. Letters without a cut glyph are skipped (only W O R D S F I N exist).
 */
export function cutWord(word: string, seed: string, o: { rot?: number; dy?: number; gap?: number; pad?: number } = {}): CutWord {
  const r = rng(seed);
  const gap = o.gap ?? 7;
  const rot = o.rot ?? 3;
  const dy = o.dy ?? 3;
  const pad = o.pad ?? 10;
  let x = 0;
  const letters: CutLetter[] = [];
  for (const char of word) {
    const glyph = GLYPHS[char];
    if (!glyph) continue;
    const rr = (r() - 0.5) * 2 * rot;
    const y = (r() - 0.5) * 2 * dy;
    const d = glyph.p.map((p) => pathOf(wobble(p, r), 1)).join("");
    letters.push({
      char,
      transform: `translate(${fixed(x, 1)} ${fixed(y, 1)}) rotate(${fixed(rr)} ${glyph.w / 2} 40)`,
      d,
      cx: x + glyph.w / 2,
      cy: 40 + y,
    });
    x += glyph.w + gap;
  }
  const width = Math.max(0, x - gap);
  return { viewBox: `${-pad} ${-pad} ${width + pad * 2} ${80 + pad * 2}`, width: width + pad * 2, height: 80 + pad * 2, letters };
}
