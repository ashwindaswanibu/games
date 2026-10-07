/**
 * Result marks as data: each game's own form (spec §6.2), built from its layout spec and the
 * semantic marks of the viewer's share grid. Pure; `mark.tsx` turns it into SVG. Nothing here knows
 * a game by name: a new game gets a mark from its `MarkForm` alone.
 *
 * Grammar (§6.1). Earned = cut from cream with an ink plate. Spent = printed (hollow on a deep
 * sheet, where a solid cream would read as earned). Skip = print at 40%. Not yet = a dashed keyline
 * in the slot's own shape. Not needed (finished, slot never used) = a faint hairline.
 *
 * Units: one `u` (the CSS `--mark-u`) is `U` user units, so the SVG scales with `--mark-u` and every
 * shape keeps its proportions.
 */

import type { HomeGameState, MarkForm, ShareMarkKind } from "@/core/home-view";
import { cutDisc, cutQuad, fixed, pathOf, rng, type Pt, type Rng } from "./geometry";

export const U = 20;

export type PieceKind = "earned" | "spent" | "skip";

export interface MarkShape {
  /** SVG path data, in user units. */
  readonly d: string;
  /** A disc slot's "not needed" is a dot, not an outline. */
  readonly dot?: boolean;
  /** Small cream details printed on a piece (film sprocket holes). */
  readonly holes?: string;
}

export interface MarkPiece {
  readonly kind: PieceKind;
  readonly shape: MarkShape;
  /** Rotation of a cut piece (degrees) around its own centre. */
  readonly rotate: number;
  /** 0.6 for a "near" mark in the generic row (cream at 60% with its plate). */
  readonly opacity?: number;
}

export interface MarkSlot {
  /** The empty form: always drawn for a game not yet finished; under the pieces during the set-in. */
  readonly keyline: MarkShape;
  /** What the viewer did with this slot, when finished. */
  readonly piece: MarkPiece | null;
  /** A slot the finished game never needed. */
  readonly unused: MarkShape | null;
}

export interface MarkModel {
  /** Size in u. */
  readonly w: number;
  readonly h: number;
  readonly slots: readonly MarkSlot[];
  /** Extra lines drawn under the slots (the chain's joins), printed when finished, dashed before. */
  readonly joins: readonly { d: string; done: boolean }[];
  readonly finished: boolean;
}

const u = (n: number) => n * U;

function rect(x: number, y: number, w: number, h: number, radius = 0): string {
  if (radius <= 0) return `M${fixed(x)} ${fixed(y)}H${fixed(x + w)}V${fixed(y + h)}H${fixed(x)}Z`;
  const r = Math.min(radius, w / 2, h / 2);
  return `M${fixed(x + r)} ${fixed(y)}H${fixed(x + w - r)}A${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + w)} ${fixed(y + r)}V${fixed(y + h - r)}A${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + w - r)} ${fixed(y + h)}H${fixed(x + r)}A${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x)} ${fixed(y + h - r)}V${fixed(y + r)}A${fixed(r)} ${fixed(r)} 0 0 1 ${fixed(x + r)} ${fixed(y)}Z`;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${fixed(cx - r)} ${fixed(cy)}A${fixed(r)} ${fixed(r)} 0 1 0 ${fixed(cx + r)} ${fixed(cy)}A${fixed(r)} ${fixed(r)} 0 1 0 ${fixed(cx - r)} ${fixed(cy)}Z`;
}

function triangle(cx: number, cy: number, size: number, up: boolean, r: Rng): string {
  const h = size * 0.92;
  const j = () => (r() - 0.5) * 0.06 * size;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const pts: Pt[] = up
    ? [[cx + j(), top + j()], [cx + size / 2 + j(), bottom + j()], [cx - size / 2 + j(), bottom + j()]]
    : [[cx - size / 2 + j(), top + j()], [cx + size / 2 + j(), top + j()], [cx + j(), bottom + j()]];
  return pathOf(pts);
}

function star(cx: number, cy: number, outer: number, inner: number, r: Rng): string {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = (i % 2 ? inner : outer) * (1 - r() * 0.05);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pathOf(pts);
}

function pennant(x: number, cy: number, size: number): string {
  // A pole and a flag, as one outline.
  const pole = size * 0.09;
  const top = cy - size / 2;
  return `M${fixed(x)} ${fixed(top)}H${fixed(x + pole)}L${fixed(x + size * 0.72)} ${fixed(top + size * 0.2)}L${fixed(x + pole)} ${fixed(top + size * 0.42)}V${fixed(top + size)}H${fixed(x)}Z`;
}

/** A film piece with four sprocket holes. */
function film(cx: number, cy: number, w: number, h: number, r: Rng): MarkShape {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const hole = h * 0.18;
  const hx = [x + w * 0.16, x + w * 0.84 - hole];
  const hy = [y + h * 0.14, y + h * 0.86 - hole];
  const holes = hx.flatMap((a) => hy.map((b) => rect(a, b, hole, hole))).join("");
  return { d: cutQuad(r, x, y, w, h, 0.5), holes };
}

const tilt = (r: Rng, max = 4) => (r() - 0.5) * 2 * max;

function pieceFor(kind: ShareMarkKind): PieceKind | "unused" | null {
  switch (kind) {
    case "hit":
    case "win":
    case "near":
      return "earned";
    case "skip":
      return "skip";
    case "unused":
      return "unused";
    default:
      return "spent";
  }
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

function slotsForm(count: number, marks: readonly ShareMarkKind[] | null, r: Rng): MarkModel {
  const gap = 0.3;
  const slots: MarkSlot[] = [];
  for (let i = 0; i < count; i++) {
    const cx = u(i * (1 + gap) + 0.5);
    const cy = u(0.5);
    const keyline: MarkShape = { d: circle(cx, cy, u(0.41)) };
    const m = marks?.[i];
    let piece: MarkPiece | null = null;
    let unused: MarkShape | null = null;
    if (marks) {
      if (m === "up" || m === "down") piece = { kind: "spent", shape: { d: triangle(cx, cy, u(0.86), m === "up", r) }, rotate: tilt(r, 3) };
      else if (m === "hit" || m === "win" || m === "near") piece = { kind: "earned", shape: { d: cutDisc(r, cx, cy, u(0.45)) }, rotate: tilt(r) };
      else if (m === "skip") piece = { kind: "skip", shape: { d: cutDisc(r, cx, cy, u(0.4)) }, rotate: 0 };
      else if (m) piece = { kind: "spent", shape: { d: cutDisc(r, cx, cy, u(0.4)) }, rotate: 0 };
      else unused = { d: circle(cx, cy, u(0.08)), dot: true };
    }
    slots.push({ keyline, piece, unused });
  }
  return { w: count + (count - 1) * gap, h: 1, slots, joins: [], finished: marks !== null };
}

function framesForm(form: Extract<MarkForm, { kind: "frames" }>, marks: readonly ShareMarkKind[] | null, r: Rng): MarkModel {
  const wide = form.aspect === "3:2";
  const fh = wide ? 0.72 : 0.8;
  const fw = wide ? 1.08 : 1.07;
  const gap = wide ? 0.18 : 0.2;
  const radius = wide ? 0 : 0.1;
  const y = (1 - fh) / 2;
  const slots: MarkSlot[] = [];
  for (let i = 0; i < form.count; i++) {
    const x = i * (fw + gap);
    const keyline: MarkShape = { d: rect(u(x), u(y), u(fw), u(fh), u(radius)) };
    const m = marks?.[i];
    let piece: MarkPiece | null = null;
    let unused: MarkShape | null = null;
    if (marks) {
      const p = m ? pieceFor(m) : "unused";
      if (p === "unused") unused = keyline;
      else if (p) piece = { kind: p, shape: { d: cutQuad(r, u(x), u(y), u(fw), u(fh), 0.6) }, rotate: p === "earned" ? tilt(r) : 0 };
    }
    slots.push({ keyline, piece, unused });
  }
  let w = form.count * fw + (form.count - 1) * gap;
  if (form.finalPick) {
    const d = 0.72;
    const cx = w + 0.5 + d / 2;
    const keyline: MarkShape = { d: circle(u(cx), u(0.5), u(d / 2)) };
    const m = marks?.[form.count];
    let piece: MarkPiece | null = null;
    if (marks && m) {
      const p = pieceFor(m);
      piece = { kind: p === "earned" ? "earned" : p === "skip" ? "skip" : "spent", shape: { d: cutDisc(r, u(cx), u(0.5), u(d / 2)) }, rotate: tilt(r) };
    }
    // Never reached: the disc is left out (no keyline, no hairline) once the game is finished.
    slots.push({ keyline, piece, unused: null });
    w = cx + d / 2;
  }
  return { w, h: 1, slots, joins: [], finished: marks !== null };
}

function chainForm(par: number | null, marks: readonly ShareMarkKind[] | null, r: Rng): MarkModel {
  const step = 1.2;
  const x0 = 0.18;
  const cy = u(0.5);
  const finished = marks !== null;
  const links = finished ? marks.filter((m) => m !== "win" && m !== "flag").length : Math.max(1, par ?? 2);
  const end = finished ? marks[marks.length - 1] : null;
  const slots: MarkSlot[] = [];
  const joins: { d: string; done: boolean }[] = [];
  // Start node.
  const startD = circle(u(x0), cy, u(0.18));
  slots.push({ keyline: { d: startD }, piece: finished ? { kind: "spent", shape: { d: cutDisc(r, u(x0), cy, u(0.18), 10) }, rotate: 0 } : null, unused: null });
  for (let i = 1; i <= links; i++) {
    const cx = x0 + i * step;
    const keyline: MarkShape = { d: rect(u(cx - 0.31), u(0.25), u(0.62), u(0.5)) };
    slots.push({ keyline, piece: finished ? { kind: "spent", shape: film(u(cx), cy, u(0.62), u(0.5), r), rotate: 0 } : null, unused: null });
  }
  const endX = x0 + (links + 1) * step;
  joins.push({ d: `M${fixed(u(x0))} ${fixed(cy)}H${fixed(u(endX))}`, done: finished });
  const starD = (rr: Rng) => star(u(endX), cy, u(0.45), u(0.2), rr);
  if (!finished) {
    slots.push({ keyline: { d: starD(rng(0)) }, piece: null, unused: null });
  } else if (end === "win") {
    slots.push({ keyline: { d: starD(rng(0)) }, piece: { kind: "earned", shape: { d: starD(r) }, rotate: tilt(r, 6) }, unused: null });
  } else {
    slots.push({ keyline: { d: starD(rng(0)) }, piece: { kind: "spent", shape: { d: pennant(u(endX - 0.12), cy, u(0.9)) }, rotate: 0 }, unused: null });
  }
  return { w: endX + 0.45, h: 1, slots, joins, finished };
}

function rowForm(count: number | null, marks: readonly ShareMarkKind[] | null, r: Rng): MarkModel {
  const n = Math.max(count ?? 5, marks?.length ?? 0);
  const gap = 0.25;
  const slots: MarkSlot[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * (1 + gap);
    const cx = u(x + 0.5);
    const cy = u(0.5);
    const keyline: MarkShape = { d: rect(u(x + 0.06), u(0.06), u(0.88), u(0.88)) };
    const m = marks?.[i];
    let piece: MarkPiece | null = null;
    let unused: MarkShape | null = null;
    if (marks) {
      const square = () => cutQuad(r, u(x + 0.04), u(0.04), u(0.92), u(0.92), 0.6);
      switch (m) {
        case undefined:
        case "unused":
          unused = keyline;
          break;
        case "hit":
          piece = { kind: "earned", shape: { d: square() }, rotate: tilt(r) };
          break;
        case "near":
          piece = { kind: "earned", shape: { d: square() }, rotate: tilt(r), opacity: 0.6 };
          break;
        case "win":
          piece = { kind: "earned", shape: { d: star(cx, cy, u(0.5), u(0.22), r) }, rotate: tilt(r, 6) };
          break;
        case "skip":
          piece = { kind: "skip", shape: { d: square() }, rotate: 0 };
          break;
        case "up":
        case "down":
          piece = { kind: "spent", shape: { d: triangle(cx, cy, u(0.86), m === "up", r) }, rotate: 0 };
          break;
        case "link":
          piece = { kind: "spent", shape: film(cx, cy, u(0.8), u(0.62), r), rotate: 0 };
          break;
        case "flag":
          piece = { kind: "spent", shape: { d: pennant(u(x + 0.2), cy, u(0.9)) }, rotate: 0 };
          break;
        case "other":
          piece = { kind: "skip", shape: { d: square() }, rotate: 0 };
          break;
        default:
          piece = { kind: "spent", shape: { d: square() }, rotate: 0 };
      }
    }
    slots.push({ keyline, piece, unused });
  }
  return { w: n + (n - 1) * gap, h: 1, slots, joins: [], finished: marks !== null };
}

/** The model for one game's mark: its empty form, or the viewer's finished result in that form. */
export function buildMark(form: MarkForm, state: HomeGameState, marks: readonly ShareMarkKind[] | null, seed: string): MarkModel {
  const r = rng(`${seed}:mark`);
  const done = state === "finished" ? (marks ?? []) : null;
  switch (form.kind) {
    case "slots":
      return slotsForm(form.count, done, r);
    case "frames":
      return framesForm(form, done, r);
    case "chain":
      return chainForm(form.par, done, r);
    case "row":
      return rowForm(form.count, done, r);
  }
}

/** Pieces in the order the set-in places them (slot order), with their slot index. */
export function placedPieces(model: MarkModel): { slot: number; piece: MarkPiece }[] {
  return model.slots.flatMap((s, slot) => (s.piece ? [{ slot, piece: s.piece }] : []));
}
