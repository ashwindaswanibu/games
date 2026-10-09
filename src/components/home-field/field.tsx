"use client";

import { Bodoni_Moda } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import type { AssetRef } from "@/core/assets";
import { receiveSealed, useAssetSrc } from "@/lib/sealed-assets";
import { dayFraction, fieldLayout, fieldMetrics, fieldRows, seamAt, tileClip, tileTargets, type HomeModel, type HomeTile, type TileBox } from "./model";
import styles from "./field.module.css";

const display = Bodoni_Moda({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], axes: ["opsz"], variable: "--hf-display", display: "swap" });

const TOP = 56;
const ARRIVAL_MS = 2600;

/*
 * The home (see model.ts): today's games as one field. This file is motion and drawing; the
 * geometry is model.ts. One clock drives every movement (arrival, a finished game collapsing when
 * you come back to the home, the day's print opening, a tile growing into its game), so every frame
 * is drawn from a handful of numbers.
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

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

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

export function HomeField({ model, welcome }: { model: HomeModel; welcome: { firstName: string; displayName: string; username: string } | null }) {
  receiveSealed(model.sealed);
  const router = useRouter();
  const { tiles } = model;
  const targets = tileTargets(tiles);
  const motion = useMotion({ arrive: 1, print: targets.print, open: 0, openIndex: -1, peek: 0, peekIndex: -1, ...Object.fromEntries(targets.collapse.map((c, i) => [`c${i}`, c])) });
  const [ready, setReady] = useState(false);
  const size = useWindowSize();
  const [now, setNow] = useState(() => Date.parse(model.rolloverAt) - 12 * 3600_000);
  const [reduced, setReduced] = useState(false);

  // The clock for the day's line and the countdown.
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

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
        // The day's first visit: the field arrives.
        motion.jump({ arrive: 0 });
        motion.animate("arrive", 1, ARRIVAL_MS, { ease: (x) => x });
      }
      writeStorage(() => localStorage, "home:arrived", model.date);
      writeStorage(() => sessionStorage, "home:tiles", { date: model.date, states: Object.fromEntries(tiles.map((t) => [t.id, t.state])) });
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
    // Once per mount: the model is the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldHeight = Math.max(200, size.height - TOP);
  const metrics = fieldMetrics(size.width);
  const rows = fieldRows(tiles, metrics.perRow);
  const v = motion.values;
  const collapse = tiles.map((_, i) => v[`c${i}`] ?? 0);
  const print = v.print ?? 0;
  const open = (v.openIndex ?? -1) >= 0 && (v.open ?? 0) > 0 ? { index: v.openIndex!, amount: v.open! } : null;
  const peek = (v.peekIndex ?? -1) >= 0 && (v.peek ?? 0) > 0 ? { index: v.peekIndex!, amount: v.peek! } : null;
  const boxes = fieldLayout({ width: size.width, height: fieldHeight, rows, collapse, print, open, peek, metrics });

  function peekAt(index: number, show: boolean) {
    const tile = tiles[index]!;
    if (reduced || metrics.compact || tile.state !== "finished" || print > 0) return;
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
    motion.jump({ openIndex: index });
    motion.animate("open", 1, 520, { from: 0 });
    setTimeout(() => router.push(href), 380);
  }

  useEffect(() => {
    for (const tile of tiles) router.prefetch(tile.href);
  }, [router, tiles]);

  const fraction = dayFraction(now, model.dayStartsAt, model.rolloverAt);
  const left = Math.max(0, Date.parse(model.rolloverAt) - now);
  const clock = [Math.floor(left / 3600_000), Math.floor((left % 3600_000) / 60_000), Math.floor((left % 60_000) / 1000)].map((n) => String(n).padStart(2, "0")).join(":");
  const allDone = tiles.length > 0 && tiles.every((t) => t.state === "finished");
  const played = tiles.filter((t) => t.state === "finished").length;
  const arrive = v.arrive ?? 1;

  return (
    <div className={`${display.variable} ${styles.root}`} data-ready={ready ? "" : undefined}>
      <header className={styles.top} style={{ opacity: clamp(arrive * 3 - 0.6) }}>
        <span className={styles.date}>{model.dateLabel}</span>
        <nav className={styles.nav} aria-label="Elsewhere">
          <a href="/leaderboard">Scores</a>
          <a href={`/u/${model.user.username}`}>Me</a>
          {model.user.isAdmin && <a href="/admin">Admin</a>}
        </nav>
        <span className={styles.score} aria-live="polite">
          {metrics.compact ? (
            <>
              <b>{played}</b>/{tiles.length} played{allDone && ` · ${clock}`}
            </>
          ) : (
            <>
              <b>{played}</b> of {tiles.length} played · {allDone ? `${model.won} points · next day in ${clock}` : `${tiles.length - played} to go · ${model.won} points`}
            </>
          )}
        </span>
        <span className={styles.line} style={{ width: `${(1 - fraction) * size.width * clamp(arrive * 2.5)}px` }} aria-hidden />
      </header>

      {welcome && (
        <p className={styles.welcome} role="status">
          Hey {welcome.firstName}. Friends see you as {welcome.displayName} (@{welcome.username}).{" "}
          <a href={`/u/${welcome.username}`}>Change either on your profile</a>.
        </p>
      )}

      <main className={styles.field} style={{ height: `${fieldHeight}px` }}>
        {tiles.length === 0 && <p className={styles.empty}>Today&apos;s puzzles aren&apos;t out yet. Check back soon.</p>}
        {tiles.map((tile, i) => (
          <Tile
            key={tile.id}
            tile={tile}
            box={boxes[i]!}
            lean={metrics.lean}
            collapse={collapse[i]!}
            print={print}
            opened={open?.index === i ? open.amount : 0}
            arrive={clamp((arrive - 0.08 * i) / 0.8)}
            peek={peek?.index === i ? peek.amount : 0}
            onEnter={(e) => enter(e, i)}
            onPeek={(show) => peekAt(i, show)}
          />
        ))}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A tile
// ---------------------------------------------------------------------------------------------

interface TileProps {
  tile: HomeTile;
  box: TileBox;
  lean: number;
  collapse: number;
  print: number;
  opened: number;
  arrive: number;
  /** How far this played game's strip is opened under the pointer. */
  peek: number;
  onEnter(event: MouseEvent<HTMLAnchorElement>): void;
  onPeek(open: boolean): void;
}

function Tile({ tile, box, lean, collapse, print, opened, arrive, peek, onEnter, onPeek }: TileProps) {
  const finished = tile.state === "finished";
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const pad = Math.min(28, Math.max(12, w * 0.05));
  // Outside the slant: pictures cover the tile's whole slanted extent.
  const k = (lean * h) / 2;
  const cover: CSSProperties = { left: box.x[0] - k - 40, top: box.y[0], width: w + 2 * k + 80, height: h };
  const live = finished ? 0 : 1 - opened;
  const strip = finished ? clamp(collapse * 1.6 - 0.4) * (1 - print) : 0;
  // The bottom of a game still to play is its title card; its picture keeps above it.
  const footer = finished ? 0 : Math.max(110, Math.min(h * 0.36, w < 300 ? 170 : 250));

  return (
    <a
      href={tile.href}
      className={styles.tile}
      style={{ clipPath: tileClip(box, lean), zIndex: opened > 0 ? 3 : 1, opacity: clamp(arrive * 4) }}
      onClick={onEnter}
      onPointerEnter={(e) => e.pointerType === "mouse" && onPeek(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onPeek(false)}
      aria-label={tile.label}
      data-state={tile.state}
    >
      <Material tile={tile} box={box} lean={lean} cover={cover} arrive={arrive} finished={finished} pad={pad} footer={footer} />
      {!finished && <span className={styles.glow} style={cover} aria-hidden />}

      {!finished && <TitleCard tile={tile} box={box} lean={lean} pad={pad} footer={footer} opacity={live * clamp(arrive * 2 - 0.4)} />}

      {finished && tile.result && strip > 0 && <PlayedStrip tile={tile} box={box} lean={lean} opacity={strip} settle={collapse} peek={peek} />}
      {finished && tile.result && print > 0 && <Print tile={tile} box={box} lean={lean} cover={cover} amount={print} />}

      <Marks tile={tile} box={box} lean={lean} pad={pad} visible={clamp(arrive * 2 - 1) * (finished ? print : live)} />
    </a>
  );
}

/** The tile's material: today's puzzle, the game's way. A finished game shows it resolved. */
function Material({ tile, box, lean, cover, arrive, finished, pad, footer }: { tile: HomeTile; box: TileBox; lean: number; cover: CSSProperties; arrive: number; finished: boolean; pad: number; footer: number }) {
  const m = tile.material;
  const w = box.x[1] - box.x[0];
  // Room for the picture: above the title card.
  const h = box.y[1] - box.y[0] - footer;
  const bottom = box.y[1] - footer;

  if (m.kind === "light") {
    return (
      <>
        <SealedImage asset={m.image} className={`${styles.strip} ${styles.grey}`} style={cover} />
        <SealedImage asset={m.image} className={`${styles.strip} ${finished ? styles.rested : styles.drift}`} style={{ ...cover, opacity: finished ? 0.6 : arrive }} />
        <span className={styles.shade} style={cover} />
      </>
    );
  }

  if (m.kind === "thread") {
    if (finished) return <span className={styles.dark} style={cover} />;
    const size = Math.max(22, Math.min(58, w * 0.12, h * 0.085));
    const ax = seamAt(box, lean, box.y[0] + h * 0.18) + pad + 14;
    const ay = box.y[0] + Math.max(70, h * 0.16);
    const bx = box.x[1] - (lean * h) / 2 - pad - 14;
    const by = bottom - Math.max(30, h * 0.12);
    const p0: [number, number] = [ax + size * 1.2, ay + size * 2];
    const p1: [number, number] = [bx - size * 1.1, by - size * 0.9];
    const taut = backOut(clamp((arrive - 0.35) / 0.5));
    const sag = (1 - taut) * h * 0.2;
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2 + sag;
    const at = (u: number): [number, number] => [(1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * mx + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * my + u * u * p1[1]];
    return (
      <>
        <span className={styles.dark} style={cover} />
        <span className={styles.name} style={{ left: ax, top: ay - size * 0.4, fontSize: size, opacity: clamp(arrive * 2.5 - 0.5) }}>
          {splitName(m.from)}
        </span>
        <span className={styles.name} style={{ left: bx - size * 5, width: size * 5, top: by - size * 1.4, fontSize: size, textAlign: "right", opacity: clamp(arrive * 2.5 - 0.7) }}>
          {splitName(m.to)}
        </span>
        <svg className={styles.thread} width="100%" height="100%" aria-hidden style={{ opacity: clamp(arrive * 3 - 0.9) }}>
          <path d={`M ${p0[0]} ${p0[1]} Q ${mx} ${my} ${p1[0]} ${p1[1]}`} />
          {Array.from({ length: m.knots }, (_, j) => {
            const [x, y] = at((j + 1) / (m.knots + 1));
            return <circle key={j} cx={x} cy={y} r={7} className={j < m.drawn ? styles.knotTied : styles.knot} />;
          })}
        </svg>
      </>
    );
  }

  if (m.kind === "frames") {
    if (finished) return <span className={styles.dark} style={cover} />;
    // The latest frame, large, on a lightbox; six ticks beneath, one per frame, lit as they're seen.
    const room = w - 2 * pad - lean * h;
    const frameW = Math.max(80, Math.min(room, 640, ((h - 200) * m.image.width) / m.image.height));
    const frameH = (frameW * m.image.height) / m.image.width;
    const cx = (box.x[0] + box.x[1]) / 2;
    const top = (box.y[0] + 40 + bottom) / 2 - frameH / 2 - 10;
    const tickW = Math.min(36, (frameW - (m.total - 1) * 8) / m.total);
    return (
      <>
        <span className={styles.dark} style={cover} />
        <span className={styles.slot} style={{ left: cx - frameW / 2, top, width: frameW, height: frameH, opacity: clamp((arrive - 0.3) * 3) }}>
          <SealedImage asset={m.image} className={styles.flicker} style={{ inset: 0, width: "100%", height: "100%" }} />
        </span>
        {Array.from({ length: m.total }, (_, j) => (
          <span
            key={j}
            className={styles.tick}
            data-seen={j < m.shown ? "" : undefined}
            style={{ left: cx - (m.total * tickW + (m.total - 1) * 8) / 2 + j * (tickW + 8), top: top + frameH + 22, width: tickW, opacity: clamp((arrive - 0.45 - j * 0.04) * 3) }}
          />
        ))}
      </>
    );
  }

  return (
    <>
      <span className={styles.dark} style={cover} />
      <span className={styles.word} style={{ left: box.x[0], width: w, top: (box.y[0] + bottom) / 2 - 30, fontSize: Math.max(24, Math.min(72, w / 7, h / 5)), opacity: finished ? 0.25 : arrive }}>
        {m.headline}
      </span>
    </>
  );
}

/**
 * A game you've played, in its strip: its material resolved and still, your score large at the
 * top (it counts up as the game settles into the strip), the title running up the side. Opened a
 * little under the pointer (`peek`), it says more (Degrees names its links).
 */
function PlayedStrip({ tile, box, lean, opacity, settle, peek }: { tile: HomeTile; box: TileBox; lean: number; opacity: number; settle: number; peek: number }) {
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

  if (!upright) {
    // A finished row's band: the same, laid along it.
    return (
      <span className={styles.played} style={{ opacity }}>
        {m.kind === "frames" && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.playedPicture}`} style={area} />}
        <span className={styles.playedScore} style={{ left: box.x[0] + 22, top: box.y[0] + h / 2 - 22, fontSize: 40 }}>
          {shown}
        </span>
        <span className={styles.playedTitleFlat} style={{ left: box.x[0] + 96, top: box.y[0] + h / 2 - 20, maxWidth: w - 120, opacity: write }}>
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
    <span className={styles.played} style={{ opacity }}>
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
      <span className={styles.playedLine} style={{ left: (people.length > 1 ? middle(box.y[1] - 44) - 22 : cx + title * 0.62 + 2), top: box.y[1] - 44, maxWidth: h - score * 2 - 140, opacity: write * (people.length > 1 ? 1 - peek : 1) }}>
        <b>{tile.title}</b> · {r.line}
      </span>
    </span>
  );
}

/**
 * A game still to play says so: its name, what it is, and a button (Play · 100, or Continue · reel 4
 * for one you've started). The whole tile is the link; the button is where the eye goes.
 */
function TitleCard({ tile, box, lean, pad, footer, opacity }: { tile: HomeTile; box: TileBox; lean: number; pad: number; footer: number; opacity: number }) {
  const w = box.x[1] - box.x[0];
  const top = box.y[1] - footer + 8;
  const x = seamAt(box, lean, top + footer / 2) + pad;
  const narrow = w < 300;
  // The game's name leads the card: the first thing read on a tile still to play.
  const size = Math.max(26, Math.min(72, w * 0.13, footer * 0.34));
  return (
    <span className={styles.card} style={{ left: x, top, width: Math.max(140, w - (lean * (box.y[1] - box.y[0])) / 2 - 2 * pad), opacity }}>
      <span className={styles.cardTitle} style={{ fontSize: size }}>
        {tile.title}
      </span>
      {!narrow && footer > 150 && <span className={styles.cardTagline}>{tile.tagline}</span>}
      <span className={styles.cardRow}>
        <span className={styles.cta} data-verb={tile.cta.verb}>
          {tile.cta.verb} · {tile.cta.detail} <span aria-hidden>▸</span>
        </span>
        {!narrow && tile.sub && <span className={styles.cardSub}>{tile.sub}</span>}
      </span>
    </span>
  );
}

/** The day's print: a finished game, resolved, filling its share. */
function Print({ tile, box, lean, cover, amount }: { tile: HomeTile; box: TileBox; lean: number; cover: CSSProperties; amount: number }) {
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
      {m.kind === "thread" && <span className={styles.dark} style={cover} />}
      <span className={styles.shade} style={cover} />
      {r.chain && (
        <span className={styles.chain} style={{ opacity: fade(0.3) }}>
          {r.chain.people.map((person, j) => {
            const y = box.y[0] + Math.max(24, h * 0.1) + j * Math.min(72, (baseY - box.y[0] - 60) / Math.max(1, r.chain!.people.length));
            return (
              <span key={j} style={{ position: "absolute", left: seamAt(box, lean, y + 20) + Math.min(48, w * 0.08), top: y }}>
                <span className={styles.person} style={{ fontSize: Math.max(18, Math.min(40, w / 11, h / 18)) }}>{person}</span>
                {r.chain!.films[j] && <span className={styles.via}>↳ {r.chain!.films[j]}</span>}
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
            <b style={{ top: 12 + (j % 2) * 14 }}>{f.name} {f.score}</b>
          </i>
        ))}
      </span>
    </span>
  );
}

/** Other players who finished: marks along the tile's foot (how they did shows in the print, once you've finished). */
function Marks({ tile, box, lean, pad, visible }: { tile: HomeTile; box: TileBox; lean: number; pad: number; visible: number }) {
  const count = tile.state === "finished" ? 0 : Math.min(12, tile.friends.finished);
  if (count === 0 || visible <= 0) return null;
  const y = box.y[1] - 44;
  const from = seamAt(box, lean, y) + pad;
  const to = box.x[1] - (lean * (box.y[1] - box.y[0])) / 2 - pad - 40;
  return (
    <>
      {Array.from({ length: count }, (_, j) => (
        <i key={j} className={styles.mark} style={{ left: lerp(from, to, (j + 1) / (count + 1)), top: y, opacity: visible }} />
      ))}
      <span className={styles.markNote} style={{ left: to - 10, top: y - 22, opacity: visible * 0.8 }}>
        {tile.friends.finished} done
      </span>
    </>
  );
}

function SealedImage({ asset, className, style }: { asset: AssetRef; className?: string; style?: CSSProperties }) {
  const { src } = useAssetSrc(asset.id);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- object URLs of sealed images (src/lib/sealed-assets.ts)
  return <img src={src} alt="" className={className} style={style} draggable={false} decoding="async" />;
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

function splitName(name: string) {
  const parts = name.split(" ");
  if (parts.length < 2) return name;
  return (
    <>
      {parts.slice(0, -1).join(" ")}
      <br />
      {parts.at(-1)}
    </>
  );
}

function backOut(x: number) {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}
