/**
 * One title designer per bucket, one gesture each (spec §5.4). All decorative (`aria-hidden`).
 *  - Words: the cut letters themselves.
 *  - Movies: Saul Bass / Maurice Binder's gun barrel, left of the title, nothing behind the letters.
 *  - Geography: North by Northwest's converging lines, 1px rules under the tracked title.
 *  - Chess: Vertigo's spiral beside the letters, never through them.
 */

import type { CSSProperties } from "react";
import type { CutWord } from "./geometry";
import { fixed } from "./geometry";

/** Cut-paper letters, cream with an ink plate (the Words title, the opening's card, FIN). */
export function CutLetters({
  word,
  className,
  style,
  fill = "var(--sheet-cream)",
  plate = "var(--sheet-ink)",
  plateOffset = [3.2, 3.4],
}: {
  word: CutWord;
  className?: string;
  style?: CSSProperties;
  fill?: string;
  plate?: string;
  plateOffset?: readonly [number, number];
}) {
  return (
    <svg className={className} style={style} viewBox={word.viewBox} aria-hidden="true" focusable="false" preserveAspectRatio="xMinYMid meet">
      {word.letters.map((l, i) => (
        <g key={i} transform={l.transform} data-letter={i}>
          <path d={l.d} fill={plate} fillRule="evenodd" transform={`translate(${plateOffset[0]} ${plateOffset[1]})`} />
          <path d={l.d} fill={fill} fillRule="evenodd" />
        </g>
      ))}
    </svg>
  );
}

let rifling: string[] | null = null;
function riflingLines(): string[] {
  if (rifling) return rifling;
  rifling = [];
  for (let k = 0; k < 7; k++) {
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const rad = 40 + t * 56;
      const a = (k / 7) * Math.PI * 2 + t * 1.25;
      pts.push(`${fixed(Math.cos(a) * rad, 1)},${fixed(Math.sin(a) * rad, 1)}`);
    }
    rifling.push(pts.join(" "));
  }
  return rifling;
}

/** The gun barrel: a sheet-ink disc, ochre rifling, a cream bore. No "3". */
export function Barrel({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      <circle r="99" fill="var(--sheet-ink)" />
      {riflingLines().map((pts, k) => (
        <polyline key={k} points={pts} fill="none" stroke="var(--ochre)" strokeWidth={k % 2 ? 1 : 2.2} opacity={k % 2 ? 0.45 : 0.8} />
      ))}
      <circle r="96" fill="none" stroke="var(--ochre)" strokeWidth="3" opacity="0.9" />
      <circle r="82" fill="none" stroke="var(--ochre)" strokeWidth="1" opacity="0.4" />
      <circle r="66" fill="none" stroke="var(--ochre)" strokeWidth="1.5" opacity="0.6" />
      <circle r="40" fill="var(--sheet-cream)" />
      <circle r="31" fill="none" stroke="var(--sheet-ink)" strokeWidth="1.4" />
      <circle r="25" fill="none" stroke="var(--sheet-ink)" strokeWidth="0.8" />
      <path d="M-40 0H40M0 -40V40" stroke="var(--sheet-ink)" strokeWidth="1" />
      <path d="M0 0L0 -34A34 34 0 0 1 29.4 17Z" fill="var(--sheet-ink)" opacity="0.14" />
    </svg>
  );
}

/**
 * North by Northwest: lines converging on a vanishing point above the head, crossed by rules that
 * tighten toward it. Drawn in a `w`×`h` box, stretched to fill (it is a field of rules, not a figure).
 */
export function ConvergingLines({ w = 800, h = 200, vanishX = 0.62, className, style, opacity = 0.32 }: { w?: number; h?: number; vanishX?: number; className?: string; style?: CSSProperties; opacity?: number }) {
  const angle = -11;
  const t = Math.tan((-angle * Math.PI) / 180);
  const vx = w * vanishX;
  const vy = -h * 1.1;
  let d = "";
  for (let i = -14; i <= 14; i++) {
    const x = w / 2 + i * (w / 14);
    d += `M${fixed(vx, 1)} ${fixed(vy, 1)}L${fixed(x + (x - vx) * 0.9, 1)} ${h}`;
  }
  for (let i = -6; i < 40; i++) {
    const y0 = i * (10 + i * 0.9);
    if (y0 > h + w * t) break;
    d += `M0 ${fixed(y0 + w * t, 1)}L${w} ${fixed(y0 - w * t * 0.12, 1)}`;
  }
  return (
    <svg className={className} style={style} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="var(--sheet-cream)" strokeWidth="1" opacity={opacity} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

let spiral: { cream: string; verm: string } | null = null;
function spiralLines(): { cream: string; verm: string } {
  if (spiral) return spiral;
  const o: string[] = [];
  const n: string[] = [];
  for (let i = 0; i <= 900; i += 3) {
    const th = (i / 900) * Math.PI * 18;
    const rr = 2 + th * 2.6;
    o.push(`${fixed(Math.cos(th) * rr, 1)},${fixed(Math.sin(th) * rr * 0.94, 1)}`);
    const r2 = rr + 5.5;
    n.push(`${fixed(Math.cos(th + 1.2) * r2, 1)},${fixed(Math.sin(th + 1.2) * r2 * 0.94, 1)}`);
  }
  spiral = { cream: o.join(" "), verm: n.join(" ") };
  return spiral;
}

/** Vertigo: a cream spiral with a vermilion companion line, both at .7. */
export function Spiral({ className, style }: { className?: string; style?: CSSProperties }) {
  const s = spiralLines();
  return (
    <svg className={className} style={style} viewBox="-160 -160 320 320" aria-hidden="true" focusable="false">
      <polyline points={s.cream} fill="none" stroke="var(--sheet-cream)" strokeWidth="1.6" opacity="0.7" />
      <polyline points={s.verm} fill="none" stroke="var(--verm)" strokeWidth="1.1" opacity="0.7" />
      <circle r="6" fill="var(--sheet-cream)" />
    </svg>
  );
}

/** The globe of the opening's Geography card: a cream disc with an ink graticule. */
export function Globe({ className, style }: { className?: string; style?: CSSProperties }) {
  const lines: string[] = [];
  for (const k of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const y = k * 46;
    const half = Math.sqrt(Math.max(0, 46 * 46 - y * y));
    lines.push(`M${fixed(-half, 1)} ${fixed(y, 1)}H${fixed(half, 1)}`);
  }
  return (
    <svg className={className} style={style} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
      <circle r="47" fill="var(--sheet-cream)" />
      <g fill="none" stroke="var(--teal)" strokeWidth="1.6">
        <path d={lines.join("")} />
        <ellipse rx="16" ry="46" />
        <ellipse rx="34" ry="46" />
        <path d="M0 -46V46" />
        <circle r="46" />
      </g>
    </svg>
  );
}
