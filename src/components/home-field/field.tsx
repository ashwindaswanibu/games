"use client";

import { Bodoni_Moda } from "next/font/google";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { AssetRef } from "@/core/assets";
import { receiveSealed } from "@/lib/sealed-assets";
import { at, Material, Room, SealedImage, turn, type Rect, type Stage } from "./materials";
import {
  choosePlan,
  dayFraction,
  dayLine,
  fieldHeight as heightFor,
  fieldLayout,
  fieldMetrics,
  leanOf,
  rightSeamAt,
  rowClip,
  rowCut,
  seamAt,
  spineAngle,
  tileClip,
  tileTargets,
  type FieldPlan,
  type HomeCategory,
  type HomeModel,
  type HomeTile,
  type TileBox,
} from "./model";
import { barsFill } from "@/lib/film-palette";
import { useFilmLight } from "./use-film-light";
import styles from "./field.module.css";

const display = Bodoni_Moda({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], axes: ["opsz"], variable: "--hf-display", display: "swap" });

const TOP = 56;
/** The day's arrival is over by then (it ends sooner on any input). */
const ARRIVAL_MS = 3000;

/*
 * The home (see model.ts): today's games as one dark room cut into pieces, the games its only
 * light. This file is motion and drawing; the geometry is model.ts and each game's object is
 * materials.tsx.
 *
 * Two kinds of motion. The day's first visit plays a title sequence once, all CSS (the
 * `[data-arrival]` rules, each element's delay its `--d`), so React draws it once: the seams cut,
 * the names rise, the objects act themselves out, then the titles come in. Everything that moves
 * the field's geometry (a finished game collapsing when you come back, the day's print opening, a
 * tile growing into its game) runs on one clock, so every frame is drawn from a handful of numbers.
 * At rest nothing on the home moves.
 */

// ---------------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------------

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

interface Tween {
  key: string;
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (x: number) => number;
}

/**
 * Named numbers that move: `animate` sends one to a value over time and the component redraws each
 * frame from `values`. Tweens live outside React; only their results are state.
 */
function useMotion(initial: Record<string, number>) {
  const [values, setValues] = useState(initial);
  const current = useRef(initial);
  const tweens = useRef<Tween[]>([]);
  const frame = useRef<number | null>(null);

  const tick = useRef((now: number) => {
    const next: Tween[] = [];
    const out = { ...current.current };
    for (const tw of tweens.current) {
      const u = tw.duration <= 0 ? 1 : clamp((now - tw.start) / tw.duration);
      out[tw.key] = now < tw.start ? tw.from : lerp(tw.from, tw.to, tw.ease(u));
      if (u < 1 || now < tw.start) next.push(tw);
    }
    tweens.current = next;
    current.current = out;
    setValues(out);
    frame.current = next.length ? requestAnimationFrame(tick.current) : null;
  });

  /** Jumps values (no motion), e.g. where a movement starts from. */
  function jump(changes: Record<string, number>) {
    current.current = { ...current.current, ...changes };
    setValues(current.current);
  }

  function animate(key: string, to: number, duration: number, options: { delay?: number; from?: number; ease?: (x: number) => number } = {}) {
    const from = options.from ?? current.current[key] ?? 0;
    current.current = { ...current.current, [key]: from };
    tweens.current = tweens.current.filter((tw) => tw.key !== key);
    tweens.current.push({ key, from, to, start: performance.now() + (options.delay ?? 0), duration, ease: options.ease ?? easeInOut });
    if (frame.current === null) frame.current = requestAnimationFrame(tick.current);
  }

  // Stopped when the component goes, and picked up again if it comes back with movements pending
  // (React's development remount runs this cleanup between a movement's start and its frames).
  useEffect(() => {
    if (tweens.current.length > 0 && frame.current === null) frame.current = requestAnimationFrame(tick.current);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  return { values, animate, jump };
}

/** The window's size, for laying out the field (a fixed laptop size on the server; hidden until hydrated anyway). */
function useWindowSize(): { width: number; height: number } {
  const key = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => "1440x900",
  );
  const [width, height] = key.split("x").map(Number);
  return { width: width!, height: height! };
}

function readStorage<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: the home still works, just without its memory.
  }
}

// ---------------------------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------------------------

/**
 * How a piece's veil stands: the house lights down while another game is under the pointer or
 * focused (`dim`); opening a game takes the others to black (`out`) and then the game itself
 * (`close`), so the game's own fade-in reads as the second half of one dip to black.
 */
type Veil = "dim" | "out" | "close" | undefined;

/** Which side of a piece the film lies on, its light falling across the cut. */
type Spill = "after" | "before";

export function HomeField({ model, welcome }: { model: HomeModel; welcome: { firstName: string; displayName: string; username: string } | null }) {
  receiveSealed(model.sealed);
  const router = useRouter();
  const { tiles } = model;
  const targets = tileTargets(tiles);
  const motion = useMotion({ print: targets.print, open: 0, openIndex: -1, peek: 0, peekIndex: -1, ...Object.fromEntries(targets.collapse.map((c, i) => [`c${i}`, c])) });
  const [ready, setReady] = useState(false);
  const [arrival, setArrival] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const size = useWindowSize();
  const [reduced, setReduced] = useState(false);
  const film = tiles.find((t) => t.material.kind === "light")?.material as { image: AssetRef } | undefined;
  const light = useFilmLight(film?.image ?? null);

  // Before the field shows: what changed since this tab last showed the home, and the day's arrival.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setReduced(noMotion);
      const before = readStorage<{ date: string; states: Record<string, string> }>(() => sessionStorage, "home:tiles");
      const justFinished = before?.date === model.date ? tiles.findIndex((t) => t.state === "finished" && before.states[t.id] !== undefined && before.states[t.id] !== "finished") : -1;
      const arrived = readStorage<string>(() => localStorage, "home:arrived") === model.date;

      if (!noMotion && justFinished >= 0) {
        // Back from a game you've just finished: it shrinks from the whole screen into its strip.
        motion.jump({ openIndex: justFinished, open: 1, [`c${justFinished}`]: 0, ...(targets.print ? { print: 0 } : {}) });
        motion.animate("open", 0, 1000, { delay: 120 });
        motion.animate(`c${justFinished}`, 1, 1000, { delay: 120 });
        if (targets.print) motion.animate("print", 1, 1500, { delay: 1100 });
      } else if (!noMotion && !arrived) {
        // The day's first visit: the field arrives, once.
        setArrival(true);
      }
      writeStorage(() => localStorage, "home:arrived", model.date);
      writeStorage(() => sessionStorage, "home:tiles", { date: model.date, states: Object.fromEntries(tiles.map((t) => [t.id, t.state])) });
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
    // Once per mount: the model is the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The arrival ends on its own, or at once on the first touch, key or scroll: everything lands at rest.
  useEffect(() => {
    if (!arrival) return;
    const end = () => setArrival(false);
    const timer = setTimeout(end, ARRIVAL_MS);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, end, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, end);
    };
  }, [arrival]);

  const metrics = fieldMetrics(size.width);
  const { compact, lean } = metrics;
  const plan = choosePlan(tiles, { width: size.width, height: size.height - TOP }, metrics);
  const fieldHeight = heightFor(size.height - TOP, plan, metrics);
  const v = motion.values;
  const collapse = tiles.map((_, i) => v[`c${i}`] ?? 0);
  const print = v.print ?? 0;
  const open = (v.openIndex ?? -1) >= 0 && (v.open ?? 0) > 0 ? { index: v.openIndex!, amount: v.open! } : null;
  const peek = (v.peekIndex ?? -1) >= 0 && (v.peek ?? 0) > 0 ? { index: v.peekIndex!, amount: v.peek! } : null;
  const boxes = fieldLayout({ width: size.width, height: fieldHeight, plan, collapse, print, open, peek, metrics });
  const categoryOf = (id: string): HomeCategory => model.categories.find((x) => x.id === id) ?? { id, name: id, tagline: "" };
  // Type sizes come from the field at rest (with nothing opening, so a tile growing into its game
  // doesn't shrink the names on its way): every plate's name one size, every game's title one size.
  const resting = open || peek ? fieldLayout({ width: size.width, height: fieldHeight, plan, collapse, print, open: null, peek: null, metrics }) : boxes;
  const spine = Math.max(40, Math.min(132, ...plan.categories.flatMap((id, c) => (standing(resting[tiles.length + c]!, compact) ? [spineRoom(resting[tiles.length + c]!, lean, categoryOf(id).name)] : []))));
  const fits = tiles.map((tile, i) => (tile.state === "finished" ? null : titleFit(tile, resting[i]!, lean, compact, size.width)));
  const titleSize = Math.min(72, ...fits.flatMap((f) => (f ? [f.size] : [])));

  const lastRow = plan.rows.length - 1;
  const clipOf = (b: TileBox) => (compact ? rowClip(b, lean, size.width, b.row === 0, b.row === lastRow) : tileClip(b, lean));
  // A phone row's cuts reach `cut` above and below its edges.
  const cut = compact ? (lean * size.width) / 2 : 0;
  const coverOf = (b: TileBox): Rect => {
    const k = leanOf(b, lean);
    return { left: b.x[0] - k - 40, top: b.y[0] - cut - 2, width: b.x[1] - b.x[0] + 2 * k + 80, height: b.y[1] - b.y[0] + 2 * cut + 4 };
  };
  const tilt = (Math.atan(lean) * 180) / Math.PI;
  const cutsOf = (b: TileBox) => (compact ? { top: b.row === 0 ? 0 : -tilt, bottom: b.row === lastRow ? 0 : -tilt } : null);
  // A phone row's middle at x, between its cuts (or the field's straight edges).
  const middleAt = (b: TileBox, x: number) => {
    if (!compact) return (b.y[0] + b.y[1]) / 2;
    const top = b.row === 0 ? b.y[0] : rowCut(b.y[0], lean, size.width, x);
    const bottom = b.row === lastRow ? b.y[1] : rowCut(b.y[1], lean, size.width, x);
    return (top + bottom) / 2;
  };
  const orderOf = (b: TileBox) => (compact ? b.row : b.col);
  const stageOf = (i: number, zone: { top: number; bottom: number }): Stage => {
    const b = boxes[i]!;
    // Wide or tall as the tile rests (a tile growing into its game keeps its object's shape).
    const r = resting[i]!;
    return { box: b, lean, cover: coverOf(b), zone, wide: r.x[1] - r.x[0] > r.y[1] - r.y[0], cuts: cutsOf(b), width: size.width, order: orderOf(b) };
  };

  // The film's light falls across the cuts onto the pieces beside it (above and below, on a phone).
  const spills = new Map<number, Spill>();
  plan.rows.forEach((row, r) => {
    row.forEach((p, c) => {
      if (p >= tiles.length || tiles[p]!.material.kind !== "light") return;
      const before = compact ? plan.rows[r - 1]?.[0] : row[c - 1];
      const after = compact ? plan.rows[r + 1]?.[0] : row[c + 1];
      if (before !== undefined) spills.set(before, "after");
      if (after !== undefined) spills.set(after, "before");
    });
  });
  const veilOf = (piece: number): Veil => (opening !== null ? (opening === piece ? "close" : "out") : lit !== null && lit !== piece ? "dim" : undefined);
  const spillOf = (piece: number, b: TileBox) => {
    const side = spills.get(piece);
    return side ? <SpillLight side={side} box={b} lean={lean} compact={compact} width={size.width} /> : null;
  };

  function houseLights(index: number, on: boolean) {
    setLit((current) => (on ? index : current === index ? null : current));
  }

  function peekAt(index: number, show: boolean) {
    const tile = tiles[index]!;
    if (reduced || compact || tile.state !== "finished" || print > 0) return;
    if (show) {
      if ((v.peekIndex ?? -1) !== index) motion.jump({ peekIndex: index, peek: 0 });
      motion.animate("peek", 1, 320);
    } else if ((v.peekIndex ?? -1) === index) motion.animate("peek", 0, 260);
  }

  function enter(event: MouseEvent<HTMLAnchorElement>, index: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = tiles[index]!.href;
    if (reduced) return router.push(href);
    // The room dims, the tile grows over it and dips to black; the game develops out of the same black.
    setArrival(false);
    setOpening(index);
    motion.jump({ openIndex: index });
    motion.animate("open", 1, 520, { from: 0 });
    setTimeout(() => router.push(href), 420);
  }

  useEffect(() => {
    for (const tile of tiles) router.prefetch(tile.href);
  }, [router, tiles]);

  const rootStyle = { "--light": light.accent, "--spine-angle": turn(spineAngle(lean)) } as CSSProperties;

  return (
    <div className={`${display.variable} ${styles.root}`} style={rootStyle} data-ready={ready ? "" : undefined} data-arrival={arrival ? "" : undefined}>
      <DayHeader model={model} compact={compact} width={size.width} />

      {welcome && (
        <p className={styles.welcome} role="status">
          Hey {welcome.firstName}. Friends see you as {welcome.displayName} (@{welcome.username}).{" "}
          <a href={`/u/${welcome.username}`}>Change either on your profile</a>.
        </p>
      )}

      <main className={styles.field} style={{ height: `${fieldHeight}px` }}>
        {tiles.length === 0 && <p className={styles.empty}>Today&apos;s puzzles aren&apos;t out yet. Check back soon.</p>}
        {plan.categories.map((id, c) => {
          const own = tiles.flatMap((tile, i) => (tile.group === id ? [i] : []));
          const piece = tiles.length + c;
          const b = boxes[piece]!;
          return (
            <Fragment key={id}>
              <Plate
                category={categoryOf(id)}
                games={own.map((i) => tiles[i]!)}
                box={b}
                lean={lean}
                clip={clipOf(b)}
                cover={coverOf(b)}
                standing={standing(b, compact)}
                compact={compact}
                spine={spine}
                lit={own.some((i) => tiles[i]!.material.kind === "light") ? barsFill(light.columns, model.categories.find((x) => x.id === id)?.name ?? id, 5) : undefined}
                middle={(x) => middleAt(b, x)}
                order={orderOf(b)}
                veil={veilOf(piece)}
              >
                {spillOf(piece, b)}
              </Plate>
              {own.map((i) => {
                const tile = tiles[i]!;
                const box = boxes[i]!;
                const lines = fits[i]?.lines ?? 1;
                return (
                  <Tile
                    key={tile.id}
                    tile={tile}
                    stage={stageOf(i, objectZone(box, compact, titleSize, lines))}
                    clip={clipOf(box)}
                    accent={tile.accent ?? light.accent}
                    dateShort={model.dateShort}
                    compact={compact}
                    title={{ size: titleSize, lines }}
                    collapse={collapse[i]!}
                    print={print}
                    opened={open?.index === i ? open.amount : 0}
                    peek={peek?.index === i ? peek.amount : 0}
                    middle={(x) => middleAt(box, x)}
                    veil={veilOf(i)}
                    onEnter={(e) => enter(e, i)}
                    onPeek={(show) => peekAt(i, show)}
                    onLight={(on) => houseLights(i, on)}
                  >
                    {spillOf(i, box)}
                  </Tile>
                );
              })}
            </Fragment>
          );
        })}
        {arrival && <Seams boxes={boxes} plan={plan} lean={lean} compact={compact} width={size.width} />}
      </main>
    </div>
  );
}

/**
 * The day's edge: the date, where to go, what's left to play; along its foot, the day as a rule,
 * what's left of it bright from now to midnight. It keeps its own clock, so the field below
 * doesn't redraw every second.
 */
function DayHeader({ model, compact, width }: { model: HomeModel; compact: boolean; width: number }) {
  const [now, setNow] = useState(() => Date.parse(model.rolloverAt) - 12 * 3600_000);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const fraction = dayFraction(now, model.dayStartsAt, model.rolloverAt);
  const left = Math.max(0, Date.parse(model.rolloverAt) - now);
  const clock = [Math.floor(left / 3600_000), Math.floor((left % 3600_000) / 60_000), Math.floor((left % 60_000) / 1000)].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <header className={styles.top}>
      <span className={styles.date}>{model.dateLabel}</span>
      <nav className={styles.nav} aria-label="Elsewhere">
        <a href="/leaderboard">Scores</a>
        <a href={`/u/${model.user.username}`}>Me</a>
        {model.user.isAdmin && <a href="/admin">Admin</a>}
      </nav>
      <span className={styles.score} aria-live="polite">
        {dayLine(model.tiles, model.won, clock, compact)}
      </span>
      <span className={styles.rule} aria-hidden>
        <i className={styles.ruleRest} style={{ transform: `scaleX(${1 - fraction})` }} />
        <i className={styles.ruleNow} style={{ transform: `translateX(${fraction * width - 2.5}px)` }} />
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// A category's plate
// ---------------------------------------------------------------------------------------------

/** A plate tall enough to stand its name up the seam (a laptop's; a band lays it flat). */
function standing(box: TileBox, compact: boolean): boolean {
  return !compact && box.y[1] - box.y[0] >= 150;
}

/** Bodoni's italic runs about half an em a letter. */
const SPINE_EM = 0.52;
/** A standing name's feet keep this far inside its right seam (toward its games), and its first letter starts this far above the plate's foot. */
const SPINE_INSET = 20;
const FOOT = 40;

/**
 * The largest a category's name stands in its plate: across, from 20px inside its right seam to
 * 24px clear of its left edge, at the shared bottom line; up, within the plate's height.
 */
function spineRoom(box: TileBox, lean: number, name: string): number {
  const y = box.y[1] - FOOT;
  const h = box.y[1] - box.y[0];
  return Math.min(rightSeamAt(box, lean, y) - seamAt(box, lean, y) - SPINE_INSET - 24, (h - 160) / (name.length * SPINE_EM));
}

/**
 * A category's plate: the ground itself, its name standing up its right seam like a book's spine,
 * reading upward parallel to the cut, its first letter on the bottom line the games' buttons
 * share. A plate laid flat (a band) says its name and how its games are going on one line. The
 * film's own category is filled with the film's light.
 */
function Plate({
  category,
  games,
  box,
  lean,
  clip,
  cover,
  standing: upright,
  compact,
  spine,
  lit,
  middle,
  order,
  veil,
  children,
}: {
  category: HomeCategory;
  games: HomeTile[];
  box: TileBox;
  lean: number;
  clip: string;
  cover: Rect;
  standing: boolean;
  compact: boolean;
  /** The standing names' shared size. */
  spine: number;
  /** The film's light for the name (null while it's worked out); undefined for a category without the film. */
  lit: string | null | undefined;
  middle(x: number): number;
  order: number;
  veil: Veil;
  children?: ReactNode;
}) {
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  if (w < 1 || h < 1) return null;
  const done = games.filter((t) => t.state === "finished");
  const points = done.reduce((sum, t) => sum + (t.result?.score ?? 0), 0);
  const progress =
    done.length === 0
      ? `${games.length} ${games.length === 1 ? "game" : "games"} today`
      : done.length < games.length
        ? `${done.length} of ${games.length} played`
        : `All played · ${points} ${points === 1 ? "point" : "points"}`;
  const label = `${category.name}: ${category.tagline ? `${category.tagline}. ` : ""}${progress}`;
  const arrive = at(450 + order * 60);
  const name = (
    <span className={styles.spineInner} style={arrive}>
      <span className={styles.spineInk}>{category.name}</span>
      {lit !== undefined && (
        <span className={styles.spineLit} data-on={lit ? "" : undefined} style={{ ...(lit ? { backgroundImage: lit } : {}), ...at(700) }} aria-hidden>
          {category.name}
        </span>
      )}
    </span>
  );

  let body: ReactNode;
  if (upright) {
    const y = box.y[1] - FOOT;
    body = (
      <h2 className={styles.spine} style={{ left: rightSeamAt(box, lean, y) - SPINE_INSET, top: y, fontSize: spine }}>
        {name}
      </h2>
    );
  } else {
    // A band: the name and how its games are going on one line, centred between its edges (a
    // phone's: 20px in, the name 28px, centred between the row's cuts under the name).
    const k = leanOf(box, lean);
    const pad = compact ? 20 : Math.min(28, Math.max(12, w * 0.05));
    const size = compact ? 28 : Math.max(18, Math.min(46, h * 0.44, (w - 2 * k - 2 * pad) / (category.name.length * 0.55)));
    const x = compact ? 20 : seamAt(box, lean, (box.y[0] + box.y[1]) / 2) + pad;
    body = (
      <span className={styles.plateFlat} style={{ left: x, top: middle(x + category.name.length * size * 0.25), maxWidth: Math.max(0, box.x[1] - k - pad - x), ...arrive }}>
        <h2 className={styles.plateName} style={{ fontSize: size }}>
          {name}
        </h2>
        <span className={styles.plateLine}>{progress}</span>
      </span>
    );
  }

  return (
    <section className={styles.plate} style={{ clipPath: clip }} aria-label={label}>
      {children}
      {body}
      <span className={styles.veil} style={cover} data-veil={veil} aria-hidden />
    </section>
  );
}

/**
 * The film's light falling across a cut onto the piece beside it, following the cut's slant: on
 * a laptop a soft falloff from the seam (stronger on the piece before the film, where it reads as
 * the film's own glow); on a phone a thin band along the row's cut.
 */
function SpillLight({ side, box, lean, compact, width }: { side: Spill; box: TileBox; lean: number; compact: boolean; width: number }) {
  const tilt = (Math.atan(lean) * 180) / Math.PI;
  const h = box.y[1] - box.y[0];
  let style: CSSProperties;
  if (compact) {
    style =
      side === "after"
        ? { left: -40, width: width + 80, top: box.y[1] - 40, height: 40, rotate: turn(-tilt), transformOrigin: "50% 100%", background: "linear-gradient(to top, rgb(var(--light) / 0.18), transparent)" }
        : { left: -40, width: width + 80, top: box.y[0], height: 40, rotate: turn(-tilt), transformOrigin: "50% 0", background: "linear-gradient(to bottom, rgb(var(--light) / 0.1), transparent)" };
  } else {
    style =
      side === "after"
        ? {
            left: box.x[1] - 260,
            width: 260,
            top: box.y[0] - 40,
            height: h + 80,
            rotate: turn(tilt),
            transformOrigin: "100% 50%",
            background: "linear-gradient(to left, rgb(var(--light) / 0.16), rgb(var(--light) / 0.05) 40%, transparent)",
          }
        : {
            left: box.x[0],
            width: 220,
            top: box.y[0] - 40,
            height: h + 80,
            rotate: turn(tilt),
            transformOrigin: "0 50%",
            background: "linear-gradient(to right, rgb(var(--light) / 0.1), rgb(var(--light) / 0.03) 40%, transparent)",
          };
  }
  return <span className={styles.spill} style={{ ...style, ...at(700) }} aria-hidden />;
}

/** The arrival's cut: a line down every seam between pieces (across every cut between a phone's rows), drawn once and gone. */
function Seams({ boxes, plan, lean, compact, width }: { boxes: TileBox[]; plan: FieldPlan; lean: number; compact: boolean; width: number }) {
  const theta = Math.atan(lean);
  const tilt = (theta * 180) / Math.PI;
  const lines: CSSProperties[] = [];
  if (compact) {
    plan.rows.slice(1).forEach((row) => {
      const b = boxes[row[0]!]!;
      lines.push({ left: 0, top: rowCut(b.y[0], lean, width, 0), width: width / Math.cos(theta), height: 1, rotate: turn(-tilt), ...at(60 + lines.length * 90) });
    });
  } else {
    for (const row of plan.rows) {
      for (const p of row) {
        const b = boxes[p]!;
        if (b.col === 0) continue;
        lines.push({ left: b.x[0] + leanOf(b, lean), top: b.y[0], width: 1, height: (b.y[1] - b.y[0]) / Math.cos(theta), rotate: turn(tilt), ...at(60 + lines.length * 70) });
      }
    }
  }
  return (
    <span className={styles.seams} data-across={compact ? "" : undefined} aria-hidden>
      {lines.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// A tile
// ---------------------------------------------------------------------------------------------

/** A title card's name runs about this many ems a letter (Bodoni, upright, a little over). */
const TITLE_EM = 0.56;
/** A title card's height besides its title: 10px, the sub line, 14px, the button. */
const CARD_REST = 10 + 10 + 14 + 37;

/** A title card's width: from 24px past its left seam to its right seam's margin. */
function cardWidth(box: TileBox, lean: number): number {
  const w = box.x[1] - box.x[0];
  const pad = Math.min(28, Math.max(12, w * 0.05));
  return Math.max(140, w - leanOf(box, lean) - 2 * pad);
}

/** The most of a tile's height its title card takes (a short row's games keep room for their objects). */
const CARD_SHARE = 0.4;

/**
 * The largest a game's title sets across its card, on one line or on two when that sets it larger
 * (a phone's is one line across the row), the card taking at most `CARD_SHARE` of the tile's
 * height. The field sets every title at the least of these.
 */
function titleFit(tile: HomeTile, box: TileBox, lean: number, compact: boolean, width: number): { size: number; lines: number } {
  if (compact) return { size: (width - 40) / (tile.title.length * TITLE_EM), lines: 1 };
  const room = cardWidth(box, lean);
  const tall = CARD_SHARE * (box.y[1] - box.y[0]) - CARD_REST;
  const size = (lines: number) => Math.min(88, room / (longestLine(tile.title, lines) * TITLE_EM), tall / lines);
  return tile.title.includes(" ") && size(2) > size(1) ? { size: size(2), lines: 2 } : { size: size(1), lines: 1 };
}

/**
 * The room above a game's title card for its object. On a laptop the card stands on the line 40px
 * above the field's foot that every button shares; on a phone its button sits 14px above the row's
 * foot.
 */
function objectZone(box: TileBox, compact: boolean, size: number, lines: number): { top: number; bottom: number } {
  if (compact) {
    // The card: the title, an 8px gap, the button's row.
    const card = box.y[1] - 14 - (size + 8 + 32);
    return { top: box.y[0] + 24, bottom: card - 12 };
  }
  const card = box.y[1] - FOOT - (lines * size + CARD_REST);
  return { top: box.y[0], bottom: card - 40 };
}

interface TileProps {
  tile: HomeTile;
  stage: Stage;
  clip: string;
  /** The game's light, "r g b". */
  accent: string;
  dateShort: string;
  compact: boolean;
  /** The field's one title size, and this title's lines. */
  title: { size: number; lines: number };
  collapse: number;
  print: number;
  opened: number;
  /** How far this played game's strip is opened under the pointer. */
  peek: number;
  middle(x: number): number;
  veil: Veil;
  onEnter(event: MouseEvent<HTMLAnchorElement>): void;
  onPeek(open: boolean): void;
  /** The house lights: this game under the pointer or focused. */
  onLight(on: boolean): void;
  children?: ReactNode;
}

function Tile({ tile, stage, clip, accent, dateShort, compact, title, collapse, print, opened, peek, middle, veil, onEnter, onPeek, onLight, children }: TileProps) {
  const { box, lean, cover } = stage;
  const finished = tile.state === "finished";
  const live = finished ? 0 : 1 - opened;
  const strip = finished ? clamp(collapse * 1.6 - 0.4) * (1 - print) : 0;
  const style = { clipPath: clip, zIndex: opened > 0 ? 3 : 1, "--accent": accent, "--on-accent": tile.onAccent } as CSSProperties;

  return (
    <a
      href={tile.href}
      className={styles.tile}
      style={style}
      onClick={onEnter}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        onLight(true);
        onPeek(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        onLight(false);
        onPeek(false);
      }}
      onFocus={() => onLight(true)}
      onBlur={() => onLight(false)}
      aria-label={tile.label}
      data-state={tile.state}
    >
      <Material tile={tile} stage={stage} finished={finished} dateShort={dateShort} />
      {children}

      {!finished && <TitleCard tile={tile} stage={stage} compact={compact} size={title.size} lines={title.lines} opacity={live} />}

      {finished && tile.result && strip > 0 && (
        <PlayedStrip tile={tile} stage={stage} opacity={strip} settle={collapse} peek={peek} middle={middle} />
      )}
      {finished && tile.result && print > 0 && <Print tile={tile} box={box} lean={lean} cover={cover} amount={print} />}
      <span className={styles.veil} style={cover} data-veil={veil} aria-hidden />
    </a>
  );
}

/**
 * A game still to play says so on one billing line shared by every game: its name in its
 * wordmark's own emphasis, what it is today (and how many have finished it), and its own first
 * verb in its own light ("Roll film"), or where you are ("Reel 4"). The whole tile is the link.
 */
function TitleCard({ tile, stage, compact, size, lines, opacity }: { tile: HomeTile; stage: Stage; compact: boolean; size: number; lines: number; opacity: number }) {
  const { box, lean, width, order } = stage;
  const sub = [tile.sub, tile.friends.finished > 0 ? `${tile.friends.finished} finished` : ""].filter(Boolean).join(" · ");
  const name = (
    <span className={styles.cardTitle} style={{ fontSize: size }}>
      <TitleText parts={tile.titleParts} lines={lines} />
    </span>
  );
  const enterAt = at(1600 + order * 70);
  if (compact) {
    return (
      <span className={`${styles.card} ${styles.cardCompact}`} style={{ left: 20, width: width - 40, bottom: `calc(100% - ${box.y[1] - 14}px)`, opacity, ...enterAt }}>
        {name}
        <span className={styles.cardRow}>
          <span className={styles.cta}>{tile.cta.label}</span>
          {sub && <span className={styles.cardSub}>{sub}</span>}
        </span>
      </span>
    );
  }
  const x = seamAt(box, lean, box.y[1] - 120) + 24;
  return (
    <span className={styles.card} style={{ left: x, width: cardWidth(box, lean), bottom: `calc(100% - ${box.y[1] - FOOT}px)`, opacity, ...enterAt }}>
      {name}
      <span className={styles.cardSub}>{sub || " "}</span>
      <span className={styles.cta}>{tile.cta.label}</span>
    </span>
  );
}

/** A title in its wordmark's parts, broken onto two lines at the space that balances them (as `longestLine` measures). */
function TitleText({ parts, lines }: { parts: HomeTile["titleParts"]; lines: number }) {
  const words = parts.flatMap((p) => p.text.split(" ").map((text) => ({ text, italic: p.italic === true })));
  let breakAt = words.length;
  if (lines === 2 && words.length > 1) {
    const length = (ws: typeof words) => ws.map((w) => w.text).join(" ").length;
    let best = Infinity;
    for (let i = 1; i < words.length; i++) {
      const longest = Math.max(length(words.slice(0, i)), length(words.slice(i)));
      if (longest < best) {
        best = longest;
        breakAt = i;
      }
    }
  }
  return words.map((w, i) => (
    <Fragment key={i}>
      {i === breakAt ? <br /> : i > 0 ? " " : null}
      {w.italic ? <i>{w.text}</i> : w.text}
    </Fragment>
  ));
}

/** The longest line of `text` set on `lines` lines (two: split at the space that balances them best). */
function longestLine(text: string, lines: number): number {
  if (lines < 2) return text.length;
  let best = text.length;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) best = Math.min(best, Math.max(i, text.length - i - 1));
  return best;
}

// ---------------------------------------------------------------------------------------------
// Finished games
// ---------------------------------------------------------------------------------------------

/**
 * A game you've played, in its strip: its room, your score large at the top (it counts up as the
 * game settles into the strip), the title running up the side. Opened a little under the pointer
 * (`peek`), it says more (Degrees names its links).
 */
function PlayedStrip({ tile, stage, opacity, settle, peek, middle: rowMiddle }: { tile: HomeTile; stage: Stage; opacity: number; settle: number; peek: number; middle(x: number): number }) {
  const { box, lean, order } = stage;
  const r = tile.result!;
  const m = tile.material;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const upright = w < h;
  const k = (lean * h) / 2;
  // The strip's middle at height y: its seams lean, so the middle drifts left going down.
  const middle = (y: number) => (box.x[0] + box.x[1]) / 2 + k * (1 - (2 * (y - box.y[0])) / h);
  const cx = (box.x[0] + box.x[1]) / 2;
  const shown = Math.round(r.score * easeInOut(clamp((settle - 0.25) / 0.75)));
  const write = clamp((settle - 0.45) / 0.55);
  const area: CSSProperties = { left: box.x[0] - 40, top: box.y[0], width: w + 80, height: h };
  const arrive = at(300 + order * 90);

  if (!upright) {
    // A finished row's band: the same, laid along it (centred between a phone row's cuts).
    const x = box.x[0] + 22;
    return (
      <span className={styles.played} style={{ opacity, ...arrive }}>
        {m.kind === "frames" && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.playedPicture}`} style={area} />}
        <span className={styles.playedScore} style={{ left: x, top: rowMiddle(x + 20) - 22, fontSize: 40 }}>
          {shown}
        </span>
        <span className={styles.playedTitleFlat} style={{ left: x + 74, top: rowMiddle(x + 160) - 20, maxWidth: w - 120, opacity: write }}>
          {r.title || r.line}
          <i>✓ Played · {r.title ? r.line : tile.name}</i>
        </span>
      </span>
    );
  }

  const digits = String(r.score).length;
  const score = Math.max(24, Math.min(64, w * 0.5, (w - 30) / (0.62 * digits)));
  const title = Math.max(16, Math.min(30, w * 0.22));
  const chainTop = box.y[0] + score * 1.9 + 90;
  const chainBottom = box.y[1] - 70;
  const people = r.chain?.people ?? [];
  return (
    <span className={styles.played} style={{ opacity, ...arrive }}>
      {m.kind === "frames" && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.playedPicture}`} style={area} />}
      <span className={styles.playedShade} style={area} />
      <span className={styles.playedMark} style={{ left: middle(box.y[0] + 24), top: box.y[0] + 18, transform: "translateX(-50%)" }}>
        ✓ Played
      </span>
      <span className={styles.playedScore} style={{ left: middle(box.y[0] + 46 + score / 2), top: box.y[0] + 46, fontSize: score, transform: "translateX(-50%)" }}>
        {shown}
      </span>
      <span className={styles.playedUnit} style={{ left: middle(box.y[0] + 54 + score), top: box.y[0] + 50 + score, transform: "translateX(-50%)" }}>
        of 100
      </span>
      {people.length > 1 && (
        <>
          <svg className={styles.chainSvg} width="100%" height="100%" aria-hidden>
            <line x1={middle(chainTop)} y1={chainTop} x2={lerp(middle(chainTop), middle(chainBottom), write)} y2={lerp(chainTop, chainBottom, write)} />
          </svg>
          {people.map((person, j) => {
            const y = lerp(chainTop, chainBottom, j / (people.length - 1));
            const end = j === 0 || j === people.length - 1;
            return (
              <span key={j} style={{ position: "absolute", left: middle(y), top: y, opacity: clamp(write * people.length - j) }}>
                <i className={end ? styles.beadEnd : styles.bead} />
                <span className={styles.beadName} style={{ opacity: peek }}>
                  {person}
                  {r.chain!.films[j] && <em>↳ {r.chain!.films[j]}</em>}
                </span>
              </span>
            );
          })}
        </>
      )}
      {people.length <= 1 && (
        <span
          className={styles.playedTitle}
          style={{ left: cx - title * 0.62, top: box.y[1] - 44, fontSize: title, maxWidth: h - score * 2 - 140, opacity: write, transform: `rotate(-90deg) translateX(${lerp(-24, 0, write)}px)` }}
        >
          {r.title || tile.name}
        </span>
      )}
      <span className={styles.playedLine} style={{ left: people.length > 1 ? middle(box.y[1] - 44) - 22 : cx + title * 0.62 + 2, top: box.y[1] - 44, maxWidth: h - score * 2 - 140, opacity: write * (people.length > 1 ? 1 - peek : 1) }}>
        <b>{tile.title}</b> · {r.line}
      </span>
    </span>
  );
}

/** The day's print: a finished game, resolved, filling its share. */
function Print({ tile, box, lean, cover, amount }: { tile: HomeTile; box: TileBox; lean: number; cover: Rect; amount: number }) {
  const r = tile.result!;
  const m = tile.material;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const title = Math.max(22, Math.min(56, w / 8.5, h / 9));
  const scaleW = Math.max(80, Math.min(300, w * 0.62));
  const baseY = box.y[1] - Math.max(70, Math.min(230, h * 0.28));
  const x = seamAt(box, lean, baseY) + Math.min(48, w * 0.08);
  const fade = (from: number) => clamp((amount - from) / (1 - from));
  return (
    <span className={styles.print} style={{ opacity: clamp(amount * 1.6) }}>
      {m.kind === "light" && r.image && <SealedImage asset={r.image} className={styles.strip} style={cover} />}
      {r.frames && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.wash}`} style={cover} />}
      {r.frames && r.image && h > 260 && <SealedImage asset={r.image} className={styles.still} style={stillBox(box, lean, r.image, baseY)} />}
      {m.kind !== "light" && !r.frames && <Room kind={m.kind} stage={{ box, lean, cover, zone: { top: box.y[0], bottom: box.y[1] }, wide: false, cuts: null, width: 0, order: 0 }} />}
      <span className={styles.shade} style={cover} />
      {r.chain && (
        <span className={styles.chain} style={{ opacity: fade(0.3) }}>
          {r.chain.people.map((person, j) => {
            const step = Math.min(72, (baseY - box.y[0] - 60) / Math.max(1, r.chain!.people.length));
            const size = Math.max(14, Math.min(40, w / 11, h / 18, step / 1.15));
            const y = box.y[0] + Math.max(24, h * 0.1) + j * step;
            return (
              <span key={j} style={{ position: "absolute", left: seamAt(box, lean, y + 20) + Math.min(48, w * 0.08), top: y }}>
                <span className={styles.person} style={{ fontSize: size }}>
                  {person}
                </span>
                {/* The films between, where the print has room for them (a phone's row doesn't). */}
                {r.chain!.films[j] && step >= size * 1.05 + 28 && <span className={styles.via}>↳ {r.chain!.films[j]}</span>}
              </span>
            );
          })}
        </span>
      )}
      {r.title && (
        <span className={styles.resultTitle} style={{ left: x, bottom: `calc(100% - ${baseY - title * 0.25}px)`, fontSize: title, opacity: fade(0.35), maxWidth: Math.max(120, box.x[1] - x - 40) }}>
          {r.title}
        </span>
      )}
      <span className={styles.resultLine} style={{ left: x + 2, top: baseY + 6, opacity: fade(0.4) }}>
        {r.line} · {r.score}
      </span>
      {r.frames && r.frames.length > 1 && h > 260 && (
        <span className={styles.thumbs} style={{ left: x, top: baseY + 34, opacity: fade(0.5) }}>
          {r.frames.map((f, j) => (
            <SealedImage key={f.id} asset={f} className={styles.thumb} style={{ outline: j === r.frames!.length - 1 ? "1.5px solid var(--hf-ink)" : "none" }} />
          ))}
        </span>
      )}
      <span className={styles.scale} style={{ left: x, top: baseY + (r.frames && r.frames.length > 1 && h > 260 ? 100 : 44), width: scaleW, opacity: fade(0.45) }}>
        <i className={styles.me} style={{ left: `${r.score}%` }} title={`You: ${r.score}`} />
        {(tile.friends.marks ?? []).map((f, j) => (
          <i key={j} className={styles.friendDot} style={{ left: `${f.score}%` }}>
            <b style={{ top: 12 + (j % 2) * 14 }}>
              {f.name} {f.score}
            </b>
          </i>
        ))}
      </span>
    </span>
  );
}

/**
 * The frame it was named on, at its own proportions (never stretched over a tall third of the
 * screen): as wide as the tile allows, above the title.
 */
function stillBox(box: TileBox, lean: number, image: AssetRef, baseY: number): CSSProperties {
  const k = (lean * (box.y[1] - box.y[0])) / 2;
  const room = box.x[1] - box.x[0] - 2 * k - 48;
  const width = Math.max(120, Math.min(room, (image.width / image.height) * (baseY - box.y[0] - 150)));
  const height = (width * image.height) / image.width;
  const top = Math.max(box.y[0] + 24, baseY - 110 - height);
  return { left: (box.x[0] + box.x[1]) / 2 - width / 2, top, width, height };
}
