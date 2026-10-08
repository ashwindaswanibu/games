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
  const motion = useMotion({ arrive: 1, print: targets.print, open: 0, openIndex: -1, ...Object.fromEntries(targets.collapse.map((c, i) => [`c${i}`, c])) });
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
  const boxes = fieldLayout({ width: size.width, height: fieldHeight, rows, collapse, print, open, metrics });

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
  const stillToPlay = tiles.filter((t) => t.state !== "finished").length * 100;
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
              <b>{model.won}</b>/{model.max}
              {allDone && ` · ${clock}`}
            </>
          ) : (
            <>
              <b>{model.won}</b> of {model.max} today · {allDone ? `done · next day in ${clock}` : `${stillToPlay} still to play`}
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
            onEnter={(e) => enter(e, i)}
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
  onEnter(event: MouseEvent<HTMLAnchorElement>): void;
}

function Tile({ tile, box, lean, collapse, print, opened, arrive, onEnter }: TileProps) {
  const finished = tile.state === "finished";
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const pad = Math.min(28, Math.max(12, w * 0.05));
  // Outside the slant: pictures cover the tile's whole slanted extent.
  const k = (lean * h) / 2;
  const cover: CSSProperties = { left: box.x[0] - k - 40, top: box.y[0], width: w + 2 * k + 80, height: h };
  const live = finished ? 0 : 1 - opened;
  const strip = finished ? clamp(collapse * 1.6 - 0.4) * (1 - print) : 0;
  const labelAt = { left: seamAt(box, lean, box.y[0] + pad + 10) + pad, top: box.y[0] + pad };

  return (
    <a
      href={tile.href}
      className={styles.tile}
      style={{ clipPath: tileClip(box, lean), zIndex: opened > 0 ? 3 : 1, opacity: clamp(arrive * 4) }}
      onClick={onEnter}
      aria-label={tile.label}
      data-state={tile.state}
    >
      <Material tile={tile} box={box} lean={lean} cover={cover} arrive={arrive} finished={finished} pad={pad} />

      {!finished && (
        <span className={styles.label} style={{ ...labelAt, opacity: live * clamp(arrive * 2 - 0.4) }}>
          {tile.name}
          <i>{tile.sub}</i>
        </span>
      )}

      {finished && tile.result && strip > 0 && <StripText tile={tile} box={box} opacity={strip} />}
      {finished && tile.result && print > 0 && <Print tile={tile} box={box} lean={lean} cover={cover} amount={print} />}

      <Marks tile={tile} box={box} lean={lean} pad={pad} visible={clamp(arrive * 2 - 1) * (finished ? print : live)} />
    </a>
  );
}

/** The tile's material: today's puzzle, the game's way. A finished game shows it resolved. */
function Material({ tile, box, lean, cover, arrive, finished, pad }: { tile: HomeTile; box: TileBox; lean: number; cover: CSSProperties; arrive: number; finished: boolean; pad: number }) {
  const m = tile.material;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];

  if (m.kind === "light") {
    return (
      <>
        <SealedImage asset={m.image} className={`${styles.cover} ${styles.grey}`} style={cover} />
        <SealedImage asset={m.image} className={`${styles.cover} ${finished ? "" : styles.drift}`} style={{ ...cover, opacity: finished ? 0.85 : arrive }} />
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
    const by = box.y[1] - Math.max(60, h * 0.2);
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
    const cols = 3;
    const slotW = Math.max(36, Math.min(190, (w - 2 * pad - (lean * h)) / 3.4, (h - 120) / 1.7 / 0.75));
    const slotH = slotW * 0.75;
    const gx = (box.x[0] + box.x[1]) / 2 - (cols * slotW + (cols - 1) * 14) / 2;
    const gy = (box.y[0] + box.y[1]) / 2 - slotH - 7;
    return (
      <>
        <span className={styles.dark} style={cover} />
        {Array.from({ length: m.total }, (_, j) => {
          const lit = j === m.shown - 1;
          return (
            <span
              key={j}
              className={styles.slot}
              data-seen={j < m.shown - 1 ? "" : undefined}
              style={{ left: gx + (j % cols) * (slotW + 14), top: gy + Math.floor(j / cols) * (slotH + 14), width: slotW, height: slotH, opacity: clamp((arrive - 0.3 - j * 0.05) * 3) }}
            >
              {lit && <SealedImage asset={m.image} className={styles.flicker} style={{ inset: 0, width: "100%", height: "100%" }} />}
            </span>
          );
        })}
      </>
    );
  }

  return (
    <>
      <span className={styles.dark} style={cover} />
      <span className={styles.word} style={{ left: box.x[0], width: w, top: (box.y[0] + box.y[1]) / 2 - 30, fontSize: Math.max(24, Math.min(72, w / 7, h / 5)), opacity: finished ? 0.25 : arrive }}>
        {m.headline}
      </span>
    </>
  );
}

/** A finished game in a strip (or a finished row's band): its result, written along it. */
function StripText({ tile, box, opacity }: { tile: HomeTile; box: TileBox; opacity: number }) {
  const r = tile.result!;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const text = [r.title || tile.name, r.line, `${r.score}`].filter(Boolean).join(" · ");
  const upright = w < h;
  return (
    <span
      className={styles.stripText}
      style={
        upright
          ? { left: (box.x[0] + box.x[1]) / 2 - 7, top: box.y[1] - 36, transform: "rotate(-90deg)", transformOrigin: "0 0", maxWidth: h - 72, opacity }
          : { left: box.x[0] + 20, top: (box.y[0] + box.y[1]) / 2 - 7, maxWidth: w - 40, opacity }
      }
    >
      {text}
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
      {m.kind === "light" && r.image && <SealedImage asset={r.image} className={styles.cover} style={cover} />}
      {r.frames && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.backdrop}`} style={cover} />}
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
