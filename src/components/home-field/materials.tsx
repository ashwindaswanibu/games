"use client";

import type { CSSProperties } from "react";
import type { AssetRef } from "@/core/assets";
import { useAssetSrc } from "@/lib/sealed-assets";
import { rightSeamAt, seamAt, type HomeTile, type TileBox, type TileMaterial } from "./model";
import styles from "./materials.module.css";

/*
 * Each tile is the object you meet inside its game, drawn from today's puzzle and your own play:
 * the film is a cut of the reel, Degrees the thread between two names, Lexicon the dictionary's
 * fore-edge under its lamp. Objects stand upright; only the seams lean. Each room is lit only by
 * its own game's lamp. The day's arrival acts the objects out once (the `[data-arrival]` rules in
 * materials.module.css, each element's delay its `--d`); at rest nothing here moves.
 */

/** A box in field coordinates (pixels), usable as a style. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where and how a tile's object is drawn. */
export interface Stage {
  box: TileBox;
  lean: number;
  /** The tile's whole extent past its slanted edges: rooms and pictures fill it. */
  cover: Rect;
  /** Where the object goes: across the tile, between these heights (above its title card). */
  zone: { top: number; bottom: number };
  /** A phone's row, wider than tall: objects lie along it. */
  wide: boolean;
  /** A phone row's top and bottom edges, in degrees (its cuts; 0 where the field's edge is straight). Null on a laptop. */
  cuts: { top: number; bottom: number } | null;
  /** The field's width. */
  width: number;
  /** The piece's place in its row (its row, on a phone), for the arrival's stagger. */
  order: number;
}

/** An element's place in the arrival: its delay, in ms from when the field is ready. */
export const at = (ms: number): CSSProperties => ({ "--d": `${Math.round(ms)}ms` }) as CSSProperties;

/** An angle for `rotate`, rounded as the browser keeps it (so the server's HTML and the client agree). */
export const turn = (degrees: number) => `${degrees.toFixed(3)}deg`;

/** The tile's object: today's puzzle, the game's way. A finished game's is its room (or its picture, resolved). */
export function Material({ tile, stage, finished, dateShort }: { tile: HomeTile; stage: Stage; finished: boolean; dateShort: string }) {
  const m = tile.material;
  if (m.kind === "light") return <FilmReel m={m} stage={stage} finished={finished} dateShort={dateShort} />;
  if (finished) return <Room kind={m.kind} stage={stage} />;
  if (m.kind === "thread") return <Thread m={m} stage={stage} playing={tile.state === "playing"} />;
  if (m.kind === "letters") return <ForeEdge m={m} stage={stage} />;
  if (m.kind === "frames") return <Frames m={m} stage={stage} />;
  return <Word m={m} stage={stage} />;
}

/** A game's room: the dark it's drawn in, lit by its own lamp. */
export function Room({ kind, stage }: { kind: TileMaterial["kind"]; stage: Stage }) {
  const lamp = kind === "thread" ? styles.roomThread : kind === "letters" ? styles.roomLetters : styles.roomPlain;
  return <span className={`${styles.room} ${lamp}`} style={{ ...stage.cover, ...at(300 + stage.order * 90) }} aria-hidden />;
}

// ---------------------------------------------------------------------------------------------
// The film: a cut of the reel
// ---------------------------------------------------------------------------------------------

/**
 * The strip of light on a cut of the reel: sprocket rails along its top and bottom edges (the
 * reel's own edges; on a phone they lie along the row's cuts), the date and where you are printed
 * on the top rail as the game prints them, and the bars at full colour.
 */
function FilmReel({ m, stage, finished, dateShort }: { m: Extract<TileMaterial, { kind: "light" }>; stage: Stage; finished: boolean; dateShort: string }) {
  const { box, lean, cover, wide, cuts, width } = stage;
  const rail = wide ? 12 : 18;
  const h = box.y[1] - box.y[0];
  // The bars fill the tile; on a laptop they stop at the rails (a phone's rails lie over them, slanted).
  const picture: Rect = wide || finished ? cover : { ...cover, top: box.y[0] + rail, height: h - 2 * rail };
  const railBox = (edge: "top" | "bottom"): CSSProperties => {
    const top = edge === "top" ? box.y[0] : box.y[1] - rail;
    if (!cuts) return { left: cover.left, width: cover.width, top, height: rail };
    // Along a phone row's cut: turned about the screen's middle, where the cut passes through the row's edge.
    return { left: -40, width: width + 80, top, height: rail, rotate: turn(cuts[edge]), transformOrigin: edge === "top" ? "50% 0" : "50% 100%" };
  };
  // The edge print keeps 14px inside the seams at the rail's height (20px inside a phone's edges).
  const y = box.y[0] + rail / 2;
  const inset = cuts ? { left: 60, right: 60 } : { left: seamAt(box, lean, y) + 14 - cover.left, right: cover.left + cover.width - (rightSeamAt(box, lean, y) - 14) };

  return (
    <>
      <SealedImage asset={m.image} className={`${styles.strip} ${styles.grey}`} style={{ ...picture, ...at(300) }} />
      <SealedImage asset={m.image} className={`${styles.strip} ${finished ? styles.rested : styles.colour}`} style={{ ...picture, ...at(700) }} />
      {finished ? (
        <span className={styles.shade} style={cover} />
      ) : (
        <>
          {/* Down to the bottom rail (a phone's slanted rail lies over it, so it runs on under). */}
          <span className={styles.foot} style={{ left: cover.left, width: cover.width, top: box.y[1] - Math.min(340, h), height: cuts ? cover.top + cover.height - box.y[1] + Math.min(340, h) : Math.min(340, h) - rail }} />
          <span className={`${styles.rail} ${wide ? styles.railThin : ""}`} style={{ ...railBox("top"), paddingLeft: inset.left, paddingRight: inset.right, ...at(1300) }} aria-hidden>
            <span className={styles.edge}>▸ {dateShort}</span>
            <span className={styles.edge}>{m.edge}</span>
          </span>
          <span className={`${styles.rail} ${wide ? styles.railThin : ""}`} style={{ ...railBox("bottom"), ...at(1300) }} aria-hidden />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Degrees: the thread
// ---------------------------------------------------------------------------------------------

/** Bodoni's upright letters run about half an em. */
const NAME_EM = 0.52;
/** The inline FROM/TO labels' width before a name's first line (mono 9px, 0.3em tracking, 10px gap). */
const LABEL_W = { from: 42, to: 26 };

/**
 * The thread as the game draws it: a filled start knot, a knot per link of par (amber once tied,
 * ringed amber where the next link goes), stitched where untied, and a hollow end ring, with the
 * two names beside their ends. On a laptop it runs down the tile beside its left seam, at the
 * seam's angle; on a phone, across the row with the names above its ends.
 */
function Thread({ m, stage, playing }: { m: Extract<TileMaterial, { kind: "thread" }>; stage: Stage; playing: boolean }) {
  const { box, lean, zone, wide } = stage;
  const w = box.x[1] - box.x[0];
  const n = playing ? Math.max(m.knots, m.drawn + 1) : m.knots;
  const names = tallNameSize(m, w, zone);
  let points: [number, number][];
  if (wide) {
    const y = zone.bottom - 14;
    const a = seamAt(box, lean, y) + 28;
    const b = rightSeamAt(box, lean, y) - 28;
    points = Array.from({ length: n + 1 }, (_, j) => [a + ((b - a) * j) / n, y]);
  } else {
    // The ends keep room for their names, centred on them (less in a short tile, whose names shrink to fit).
    const half = 0.98 * names.size;
    const top = zone.top + Math.min(70, Math.max(half + 10, (zone.bottom - zone.top) * 0.12));
    const bottom = zone.bottom - Math.min(50, Math.max(half + 3, (zone.bottom - zone.top) * 0.09));
    points = Array.from({ length: n + 1 }, (_, j) => {
      const y = top + ((bottom - top) * j) / n;
      return [seamAt(box, lean, y) + 40, y];
    });
  }
  const knot = (j: number) => {
    if (j === 0) return styles.knotStart;
    if (j === n) return styles.knotEnd;
    if (j <= m.drawn) return styles.knotTied;
    return playing && j === m.drawn + 1 ? styles.knotNext : styles.knotUntied;
  };
  const stretch = (j: number) => (j < m.drawn ? styles.stretchTied : playing && j === m.drawn ? styles.stretchOpen : styles.stretchUntied);
  // When each knot lands: the start first, then one a stretch.
  const landed = (j: number) => (j === 0 ? 800 : 900 + 220 * j);

  return (
    <>
      <Room kind="thread" stage={stage} />
      {points.slice(0, -1).map(([x, y], j) => {
        const [nx, ny] = points[j + 1]!;
        // A stretch hangs from its first knot, turned to reach the next (CSS turns clockwise from straight down).
        const angle = (Math.atan2(-(nx - x), ny - y) * 180) / Math.PI;
        return <span key={`s${j}`} className={`${styles.stretch} ${stretch(j)}`} style={{ left: x, top: y, height: Math.hypot(nx - x, ny - y), rotate: turn(angle), ...at(900 + 220 * j) }} />;
      })}
      {points.map(([x, y], j) => (
        <span key={`k${j}`} className={`${styles.knot} ${knot(j)}`} style={{ left: x, top: y, ...at(landed(j)) }} />
      ))}
      {wide ? wideNames(m, points, w, zone) : tallNames(m, points, names)}
    </>
  );
}

/** A name split at its last space ("Louis de / Funès"), as the thread sets it. */
function nameLines(name: string): string[] {
  const i = name.lastIndexOf(" ");
  return i < 0 ? [name] : [name.slice(0, i), name.slice(i + 1)];
}

/**
 * The names' one size on a tall tile: as large as the narrower allows across, and small enough
 * that both, centred on their ends, fit the zone with the thread between them (two lines each).
 */
function tallNameSize(m: { from: string; to: string }, w: number, zone: { top: number; bottom: number }): { size: number; labelled: boolean } {
  const labelled = w >= 260;
  const room = labelled ? w - 86 : w - 70;
  const fits = (name: string, label: number) => Math.min(...nameLines(name).map((line, i) => (room - (i === 0 ? label : 0)) / (line.length * NAME_EM)));
  const tall = (zone.bottom - zone.top - 29) / (4 * 0.98);
  return { size: Math.max(12, Math.min(48, tall, fits(m.from, labelled ? LABEL_W.from : 0), fits(m.to, labelled ? LABEL_W.to : 0))), labelled };
}

/** Beside the start and end knots on a tall tile, one size for both. */
function tallNames(m: { from: string; to: string }, points: [number, number][], { size, labelled }: { size: number; labelled: boolean }) {
  const end = points.length - 1;
  const name = (text: string, label: string, [x, y]: [number, number], delay: number) => (
    <span className={styles.name} style={{ left: x + 22, top: y, fontSize: size, ...at(delay) }}>
      {nameLines(text).map((line, i) => (
        <span key={i} className={styles.nameLine}>
          {labelled && i === 0 && <span className={styles.nameLabel}>{label}</span>}
          {line}
        </span>
      ))}
    </span>
  );
  return (
    <>
      {name(m.from, "From", points[0]!, 800)}
      {name(m.to, "To", points[end]!, 900 + 220 * end)}
    </>
  );
}

/** Above the end knots on a phone's row: the start's left-aligned, the end's right-aligned, on one line where they fit. */
function wideNames(m: { from: string; to: string }, points: [number, number][], w: number, zone: { top: number; bottom: number }) {
  const room = w / 2 - 40;
  const oneLine = Math.min(room / (m.from.length * 0.5), room / (m.to.length * 0.5));
  const lines = oneLine >= 18 ? 1 : 2;
  const longest = (name: string) => (lines === 1 ? name.length : Math.max(...nameLines(name).map((l) => l.length)));
  const size = Math.min(26, room / (longest(m.from) * 0.5), room / (longest(m.to) * 0.5));
  const labelled = zone.bottom - zone.top >= 140;
  const end = points.length - 1;
  const name = (text: string, label: string, [x, y]: [number, number], side: "start" | "end", delay: number) => (
    <span
      className={`${styles.name} ${styles.nameAbove}`}
      data-side={side}
      style={{ ...(side === "start" ? { left: x - 8 } : { right: `calc(100% - ${x + 8}px)` }), bottom: `calc(100% - ${y - 20}px)`, fontSize: size, ...at(delay) }}
    >
      {(lines === 1 ? [text] : nameLines(text)).map((line, i) => (
        <span key={i} className={styles.nameLine}>
          {labelled && i === 0 && <span className={styles.nameLabel}>{label}</span>}
          {line}
        </span>
      ))}
    </span>
  );
  return (
    <>
      {name(m.from, "From", points[0]!, "start", 800)}
      {name(m.to, "To", points[end]!, "end", 900 + 220 * end)}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Lexicon: the dictionary's fore-edge
// ---------------------------------------------------------------------------------------------

/** Bodoni's lower case, with the row's 0.18em gaps, runs about this many ems a letter. */
const LETTER_EM = 0.74;

/**
 * Today's dictionary seen from its fore-edge, under the game's lamp: a hairline a page, the pages
 * today's word can't be on in shadow, a red ribbon at each page you've guessed (the two that bound
 * the gap bright), and the nine letters beneath with the word's length in slots.
 */
function ForeEdge({ m, stage }: { m: Extract<TileMaterial, { kind: "letters" }>; stage: Stage }) {
  const { box, lean, zone, wide } = stage;
  const w = box.x[1] - box.x[0];
  const zoneH = zone.bottom - zone.top;
  const narrow = !wide && w < 260;
  const B = wide ? w - 48 : narrow ? w - 40 : w - 72;
  const band = wide ? 40 : Math.min(112, zoneH * 0.2);
  const letter = wide ? 26 : Math.max(narrow ? 18 : 0, Math.min(44, B / (m.letters.length * LETTER_EM)));
  // One block: the kicker, the band, the letters and the slots, centred at 45% of the zone (a phone's, in its middle).
  const block = wide ? band + 10 + letter : 9 + 16 + band + 36 + letter + 16 + 1.5;
  const top = wide ? (zone.top + zone.bottom) / 2 - block / 2 : zone.top + zoneH * 0.45 - block / 2;
  const bandTop = wide ? top : top + 25;
  // Centred on the tile's middle at the band's height (the seams lean; the book stands upright).
  const yMid = bandTop + band / 2;
  const cx = (seamAt(box, lean, yMid) + rightSeamAt(box, lean, yMid)) / 2;
  const left = cx - B / 2;
  const lettersTop = bandTop + band + (wide ? 10 : 36);
  const total = Math.max(1, m.total);

  return (
    <>
      <Room kind="letters" stage={stage} />
      {!wide && (
        <span className={styles.kicker} style={{ left: cx, top, ...at(900) }}>
          Today&apos;s dictionary
        </span>
      )}
      <span className={styles.book} style={{ left, top: bandTop, width: B, height: band, ...at(700) }}>
        <span className={styles.bookEdge}>
          <span className={styles.pages} style={{ "--pages": total } as CSSProperties} />
          <span className={styles.lamp} />
          <span className={`${styles.bookShade} ${styles.shadeLeft}`} style={{ transform: `scaleX(${(m.gap.low + 1) / total})`, ...at(800) }} />
          <span className={`${styles.bookShade} ${styles.shadeRight}`} style={{ transform: `scaleX(${(total - m.gap.high) / total})`, ...at(800) }} />
        </span>
      </span>
      {m.ribbons.map((r, i) => (
        <span
          key={i}
          className={styles.ribbon}
          data-edge={r.edge ? "" : undefined}
          // Hanging past the book; on a phone, short of the letters set just under it.
          style={{ left: left + ((r.page + 0.5) / total) * B, top: bandTop - (wide ? 5 : 8), height: band + (wide ? 13 : 26), ...at(2000 + 60 * i) }}
        />
      ))}
      <span className={styles.letters} style={{ left: cx, top: lettersTop, fontSize: letter }}>
        {[...m.letters].map((ch, j) => (
          <span key={j} style={at(1300 + 50 * j)}>
            {ch}
          </span>
        ))}
      </span>
      {!wide && (
        <span className={styles.slots} style={{ left: cx, top: lettersTop + letter + 16, ...at(1800) }}>
          {Array.from({ length: m.length }, (_, j) => (
            <span key={j} />
          ))}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Other games
// ---------------------------------------------------------------------------------------------

/** Frame by Frame (off the home for now): the latest frame on a lightbox, a tick per frame beneath, lit as seen. */
function Frames({ m, stage }: { m: Extract<TileMaterial, { kind: "frames" }>; stage: Stage }) {
  const { box, lean, zone } = stage;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const pad = Math.min(28, Math.max(12, w * 0.05));
  const room = w - 2 * pad - lean * h;
  const frameW = Math.max(80, Math.min(room, 640, ((zone.bottom - zone.top - 120) * m.image.width) / m.image.height));
  const frameH = (frameW * m.image.height) / m.image.width;
  const cx = (box.x[0] + box.x[1]) / 2;
  const top = (zone.top + zone.bottom) / 2 - frameH / 2 - 10;
  const tickW = Math.min(36, (frameW - (m.total - 1) * 8) / m.total);
  return (
    <>
      <Room kind="frames" stage={stage} />
      <span className={styles.slot} style={{ left: cx - frameW / 2, top, width: frameW, height: frameH }}>
        <SealedImage asset={m.image} style={{ inset: 0, width: "100%", height: "100%" }} />
      </span>
      {Array.from({ length: m.total }, (_, j) => (
        <span
          key={j}
          className={styles.tick}
          data-seen={j < m.shown ? "" : undefined}
          style={{ left: cx - (m.total * tickW + (m.total - 1) * 8) / 2 + j * (tickW + 8), top: top + frameH + 22, width: tickW }}
        />
      ))}
    </>
  );
}

/** Any other game: its name, set large. */
function Word({ m, stage }: { m: Extract<TileMaterial, { kind: "word" }>; stage: Stage }) {
  const { box, zone } = stage;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  return (
    <>
      <Room kind="word" stage={stage} />
      <span className={styles.word} style={{ left: box.x[0], width: w, top: (zone.top + zone.bottom) / 2 - 30, fontSize: Math.max(24, Math.min(72, w / 7, h / 5)) }}>
        {m.headline}
      </span>
    </>
  );
}

export function SealedImage({ asset, className, style }: { asset: AssetRef; className?: string; style?: CSSProperties }) {
  const { src } = useAssetSrc(asset.id);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- object URLs of sealed images (src/lib/sealed-assets.ts)
  return <img src={src} alt="" className={className} style={style} draggable={false} decoding="async" />;
}
