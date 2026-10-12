"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { AssetRef } from "@/core/assets";
import { barsFill, type Rgb } from "@/lib/film-palette";
import { clamp, easeInOut, lerp } from "./ease";
import { at, BookEdge, Room, SealedImage, type Rect, type Stage } from "./materials";
import { longestLine, printLines, rightSeamAt, seamAt, stripMiddle, type HomeTile, type TileBox, type TileMaterial, type TileResult } from "./model";
import styles from "./played.module.css";

/*
 * A finished game on the home: its object, resolved, says it's done. Collapsed into a strip (a
 * band, along a finished row) it keeps the score over the game's own object: the film's bars at
 * full colour with the reel it was named on lit, the thread tied in the light, the red silk ribbon
 * with the word lettered on it. When every game is done the strips open into the day's print, each
 * poster its game's end card, every title on one baseline so a row of posters reads as one line of
 * credits.
 *
 * Colour and light are what you earn, as in the games: a film that got away is titled in ink, a
 * chain given up on is the game's own route in plain ink, a word given up on gets no ribbon.
 */

/** A film runs ten reels. */
const REELS = 10;
/** Bodoni Moda's baseline sits this far above the foot of a line set solid (line height 1), in ems. */
const BASELINE = 0.14;
/** A title runs about this many ems a letter (Bodoni, upright, a little over). */
const TITLE_EM = 0.56;
/** How far Degrees' thread moves over as its strip opens under the pointer, for the names beside it. */
const PEEK_ROOM = 60;
/** The silk a found word is lettered on: wide enough for Bodoni's ascenders and descenders at the lettering's size. */
const RIBBON = { width: 26, type: 20 };

/** Centres a line's lower case (its x-height) on a point, where -50% centres its line box (Bodoni's x-height sits low in it). */
const LOWER = "calc(-50% - 0.15em)";
/** A `bottom` (in the tile, which spans the field) that sets a line of `size` px on baseline `y`; `below` is how far its box runs under the baseline, in ems. */
const onBaseline = (y: number, size: number, below = BASELINE) => `calc(100% - ${y + below * size}px)`;

// ---------------------------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------------------------

interface Written {
  tile: HomeTile;
  r: TileResult;
  stage: Stage;
  /** The score as it counts up. */
  shown: number;
  /** How far the object is drawn in, 0–1. */
  write: number;
}

/**
 * A game you've played, in its strip: your score at the top (it counts up as the game settles into
 * the strip) over the game's object, done, drawn in as it settles. Opened a little under the
 * pointer (`peek`), Degrees names its links. Along a finished row's band, the same laid flat.
 */
export function PlayedStrip({ tile, stage, opacity, settle, peek, middle }: { tile: HomeTile; stage: Stage; opacity: number; settle: number; peek: number; middle(x: number): number }) {
  const { box } = stage;
  const r = tile.result!;
  const written: Written = { tile, r, stage, shown: Math.round(r.score * easeInOut(clamp((settle - 0.25) / 0.75))), write: clamp((settle - 0.45) / 0.55) };
  const upright = box.x[1] - box.x[0] < box.y[1] - box.y[0];
  return (
    <span className={styles.played} style={{ opacity, ...at(300 + stage.order * 90) }}>
      {upright ? <Strip {...written} peek={peek} /> : <Band {...written} middle={middle} />}
    </span>
  );
}

/**
 * Writing that runs up a strip from (`x`, `y`), centred on its line and turned to `angle`; it
 * slides up into place as it's written. `lower` centres lower case on its line instead (its
 * x-height, not the line box), as lettering on the silk is.
 */
function RunUp({ text, x, y, size, length, angle, write, lower, className }: { text: string; x: number; y: number; size: number; length: number; angle: string; write: number; lower?: boolean; className?: string }) {
  return (
    <span
      className={`${styles.runUp} ${className ?? ""}`}
      style={{ left: x, top: y, fontSize: size, maxWidth: Math.max(0, length), opacity: write, transform: `rotate(${angle}) translate(${lerp(-24, 0, write)}px, ${lower ? LOWER : "-50%"})` }}
    >
      {text}
    </span>
  );
}

function Strip({ tile, r, stage, shown, write, peek }: Written & { peek: number }) {
  const { box, lean } = stage;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const across = (top: number, bottom: number): Rect => ({ left: box.x[0] - 40, top, width: w + 80, height: bottom - top });
  // Writing follows the strip's centre line (parallel to its seams); objects hang plumb from its middle.
  const along = (y: number) => stripMiddle(box, lean, y);
  const cx = along((box.y[0] + box.y[1]) / 2);
  const size = Math.max(24, Math.min(56, (w - 30) / (0.6 * String(r.score).length)));
  const top = box.y[0] + 26;
  const below = top + size + 18;
  const foot = box.y[1] - 36;
  const score = (
    <span className={styles.score} style={{ left: along(top + size / 2), top, fontSize: size, transform: "translateX(-50%)" }}>
      {shown}
    </span>
  );
  const kind = tile.material.kind;

  if (kind === "light") {
    // The bars at full colour, a short shade under the score and its reels, another under the title.
    const reelsEnd = below + REELS * 9 - 3;
    return (
      <>
        <span className={styles.shadeTop} style={across(box.y[0], reelsEnd + 56)} />
        <span className={styles.shadeFoot} style={across(box.y[1] - h * 0.45, box.y[1])} />
        {score}
        {Array.from({ length: REELS }, (_, j) => {
          const y = below + j * 9;
          return (
            <i key={j} className={styles.reel} style={{ left: along(y + 3) - 3, top: y }}>
              {r.reel === j + 1 && <b style={{ opacity: write }} />}
            </i>
          );
        })}
        <RunUp text={r.title} x={along(foot)} y={foot} size={Math.min(30, w * 0.23)} length={foot - reelsEnd - 40} angle="var(--spine-angle)" write={write} />
      </>
    );
  }

  if (kind === "thread") {
    const people = r.chain?.people ?? [];
    const n = people.length;
    const first = below + 24;
    const last = box.y[1] - 56;
    // Opened under the pointer, the thread moves over to make room for the names.
    const x = cx - PEEK_ROOM * peek;
    return (
      <>
        {score}
        {n > 1 && <span className={styles.thread} data-lost={r.won ? undefined : ""} style={{ left: x, top: first, height: last - first, transform: `scaleY(${write})` }} />}
        {n > 1 &&
          people.map((person, j) => (
            <span key={j} className={styles.knotAt} style={{ left: x, top: lerp(first, last, j / (n - 1)), opacity: clamp(write * n - j) }}>
              <Knot at={j === 0 ? "start" : j === n - 1 ? "end" : "tie"} won={r.won} />
              <span className={styles.knotName} style={{ opacity: peek }}>
                {person}
                {r.chain!.films[j] && <em>↳ {r.chain!.films[j]}</em>}
              </span>
            </span>
          ))}
      </>
    );
  }

  if (kind === "letters") {
    // A sliver of the dictionary's fore-edge under the score; a found word's ribbon hangs out of it.
    const edge = { width: Math.min(92, w - 40), top: below + 6, height: 14 };
    const hangs = edge.top + edge.height - 3;
    const end = box.y[1] - 34;
    return (
      <>
        {score}
        {r.won && <span className={styles.ribbon} style={{ left: cx - RIBBON.width / 2, top: hangs, width: RIBBON.width, height: end - hangs, transform: `scaleY(${write})` }} />}
        <BookEdge rect={{ left: cx - edge.width / 2, top: edge.top, width: edge.width, height: edge.height }} pages={edge.width / 3} />
        {r.won ? (
          <RunUp className={styles.lettered} text={r.title} x={cx} y={end - 22} size={RIBBON.type} length={end - 22 - hangs - 16} angle="-90deg" write={clamp(write * 2 - 1)} lower />
        ) : (
          <RunUp text={r.title} x={cx} y={foot} size={22} length={foot - edge.top - 44} angle="-90deg" write={write} />
        )}
      </>
    );
  }

  return (
    <>
      {kind === "frames" && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.picture}`} style={across(box.y[0], box.y[1])} />}
      {score}
      <RunUp text={r.title || tile.title} x={along(foot)} y={foot} size={Math.min(30, w * 0.23)} length={foot - below - 40} angle="var(--spine-angle)" write={write} />
    </>
  );
}

/** A knot of the thread, in the light when you made it: the start, a link, or the end ring closed with its light around it. */
function Knot({ at: place, won }: { at: "start" | "tie" | "end"; won: boolean }) {
  return <i className={styles.knot} data-at={place} data-lost={won ? undefined : ""} />;
}

/**
 * A finished row's band: the score at its start, then the object laid along it, level (a phone
 * row's cuts lean; what lies in it doesn't): the film's bars with its title, the thread, the ribbon
 * with the word.
 */
function Band({ tile, r, stage, shown, write, middle }: Written & { middle(x: number): number }) {
  const { box, lean, cover, cuts, width } = stage;
  const h = box.y[1] - box.y[0];
  const mid = (box.y[0] + box.y[1]) / 2;
  const start = cuts ? 20 : seamAt(box, lean, mid) + 22;
  const end = cuts ? width - 20 : rightSeamAt(box, lean, mid) - 22;
  const size = Math.min(40, h * 0.6);
  const scoreW = 0.6 * size * String(r.score).length;
  const x = start + scoreW + 18;
  const y = middle((x + end) / 2);
  const kind = tile.material.kind;
  const flat = (text: string, from: number, className = "") => (
    <span className={`${styles.flat} ${className}`} style={{ left: from, top: middle(from + 60), maxWidth: Math.max(0, end - from), opacity: write }}>
      {text}
    </span>
  );

  let object: ReactNode;
  if (kind === "thread") {
    const n = r.chain?.people.length ?? 0;
    object = n > 1 && (
      <>
        <span className={styles.threadAcross} data-lost={r.won ? undefined : ""} style={{ left: x, top: y, width: end - x, transform: `scaleX(${write})` }} />
        {Array.from({ length: n }, (_, j) => (
          <span key={j} className={styles.knotAt} style={{ left: lerp(x, end, j / (n - 1)), top: y, opacity: clamp(write * n - j) }}>
            <Knot at={j === 0 ? "start" : j === n - 1 ? "end" : "tie"} won={r.won} />
          </span>
        ))}
      </>
    );
  } else if (kind === "letters") {
    object = r.won ? (
      <>
        <span className={styles.ribbonAcross} style={{ left: x, top: y - RIBBON.width / 2, width: end - x + 20, height: RIBBON.width, transform: `scaleX(${write})` }} />
        <span className={`${styles.flat} ${styles.lettered}`} style={{ left: x + 14, top: y, fontSize: RIBBON.type, maxWidth: end - x - 40, opacity: clamp(write * 2 - 1), transform: `translateY(${LOWER})` }}>
          {r.title}
        </span>
      </>
    ) : (
      <>
        <BookEdge rect={{ left: x, top: y - 7, width: 40, height: 14 }} pages={13} />
        {flat(r.title, x + 56)}
      </>
    );
  } else {
    object = flat(r.title || tile.title, x);
  }

  return (
    <>
      {kind === "light" && <span className={styles.shadeAlong} style={cover} />}
      {kind === "frames" && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.picture}`} style={cover} />}
      <span className={styles.score} style={{ left: start, top: middle(start + scoreW / 2), fontSize: size, transform: "translateY(-50%)" }}>
        {shown}
      </span>
      {object}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The day's print
// ---------------------------------------------------------------------------------------------

/** Where a poster's writing goes: its lines (`printLines`), the left edge they keep, and how wide they may run. */
function posterText(box: TileBox, lean: number, compact: boolean, cut: number, width: number) {
  const lines = printLines(box, compact, cut);
  const pad = compact ? 20 : Math.min(48, (box.x[1] - box.x[0]) * 0.08);
  const x = compact ? pad : seamAt(box, lean, lines.base) + pad;
  const right = compact ? width - pad : rightSeamAt(box, lean, lines.base) - 24;
  return { lines, x, room: Math.max(120, right - x) };
}

/**
 * The print's one title size: the largest every poster's title fits across its poster at (on two
 * lines where that sets it larger; a phone's on one), so a row's titles read as one line. `boxes`
 * are the field at rest in the print.
 */
export function printTitleSize(tiles: readonly HomeTile[], boxes: readonly TileBox[], lean: number, compact: boolean, cut: number, width: number): number {
  const fits = tiles.flatMap((tile, i) => {
    const title = tile.result?.title;
    if (!title || !boxes[i]) return [];
    const { room } = posterText(boxes[i], lean, compact, cut, width);
    return [Math.max(...(compact ? [1] : [1, 2]).map((lines) => room / (longestLine(title, lines) * TITLE_EM)))];
  });
  return Math.round(Math.max(compact ? 22 : 30, Math.min(compact ? 34 : 64, ...fits)));
}

/**
 * The day's print: a finished game's end card, filling its share. Above, the game's object,
 * resolved; on the row's shared baseline the title (the film, the word; Degrees' chain ends on it);
 * under it the note, how it went and friends' scale, each on a line shared across the row.
 * `columns` are the film's, for its title pressed in its bars.
 */
export function Print({ tile, stage, amount, compact, cut, titleSize, columns }: {
  tile: HomeTile;
  stage: Stage;
  amount: number;
  compact: boolean;
  /** How far a phone row's slanted bottom cut reaches above its box. */
  cut: number;
  titleSize: number;
  columns: readonly Rgb[] | null;
}) {
  const { box, lean, cover, width } = stage;
  const r = tile.result!;
  const m = tile.material;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const { lines, x, room } = posterText(box, lean, compact, cut, width);
  const fade = (from: number) => clamp((amount - from) / (1 - from));
  // Up to two lines for a title on a laptop's poster (one for a word); a phone's row holds one.
  const titleLines = compact || !r.title.includes(" ") ? 1 : 2;
  const titleTop = lines.base - titleSize * titleLines;
  const frames = r.frames && r.frames.length > 1 && h > 260 ? r.frames : null;
  // Colour is what you earn: a film that got away is titled in ink (null while its bars are worked out).
  const fill = m.kind === "light" && r.won ? barsFill(columns, r.title, 7) : undefined;

  return (
    <span className={styles.print} style={{ opacity: clamp(amount * 1.6) }}>
      {m.kind === "light" && r.image && (
        <>
          <SealedImage asset={r.image} className={styles.strip} style={cover} />
          <Foot cover={cover} top={titleTop} fade={compact ? 44 : 120} />
        </>
      )}
      {r.frames && r.image && <SealedImage asset={r.image} className={`${styles.cover} ${styles.wash}`} style={cover} />}
      {r.frames && r.image && h > 260 && <SealedImage asset={r.image} className={styles.still} style={stillBox(box, lean, r.image, titleTop)} />}
      {m.kind !== "light" && !r.frames && <Room kind={m.kind} stage={stage} />}
      {m.kind === "thread" && r.chain && <Chain r={r} box={box} lean={lean} base={lines.base} x={x} room={room} compact={compact} drawn={fade(0.3)} />}
      {m.kind === "letters" && <ShutBook m={m} stage={stage} compact={compact} hangTo={titleTop - (compact ? 6 : 36)} laid={fade(0.4)} />}

      {r.title && (
        // Ink and its lit layer are siblings, set alike: WebKit wraps a clamped box's positioned child on its own.
        <span className={styles.titleBox} style={{ left: x, bottom: onBaseline(lines.base, titleSize, BASELINE + 0.12), fontSize: titleSize, maxWidth: room, opacity: fade(0.35) }}>
          <span className={styles.title} style={{ WebkitLineClamp: titleLines }}>
            {r.title}
          </span>
          {fill !== undefined && (
            <span className={`${styles.title} ${styles.titleLit}`} data-on={fill ? "" : undefined} style={{ WebkitLineClamp: titleLines, ...(fill ? { backgroundImage: fill } : {}) }} aria-hidden>
              {r.title}
            </span>
          )}
        </span>
      )}
      {r.note && (
        <span className={styles.note} style={{ left: x, top: lines.note, maxWidth: room, fontSize: compact ? 14 : 18, opacity: fade(0.4) }}>
          {r.note}
        </span>
      )}
      {frames && (
        <span className={styles.thumbs} style={{ left: x, top: lines.note, opacity: fade(0.4) }}>
          {frames.map((f, j) => (
            <SealedImage key={f.id} asset={f} className={styles.thumb} style={{ outline: j === frames.length - 1 ? "1.5px solid var(--hf-ink)" : "none" }} />
          ))}
        </span>
      )}
      <span className={styles.line} style={{ left: x + 1, top: lines.line, opacity: fade(0.45) }}>
        {r.line} · {r.score}
      </span>
      <span className={styles.scale} style={{ left: x, top: lines.scale, width: Math.max(80, Math.min(300, w * 0.62)), opacity: fade(0.5) }}>
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

/** The film's foot: dark under its title (whose top is `top`), the bars running down into it over `fade` px above. */
function Foot({ cover, top, fade }: { cover: Rect; top: number; fade: number }) {
  const from = top - fade;
  return <span className={styles.foot} style={{ left: cover.left, width: cover.width, top: from, height: Math.max(0, cover.top + cover.height - from), "--fade": `${fade}px` } as CSSProperties} />;
}

/**
 * Degrees' chain as its end card has it, plumb down the poster: a knot beside each name, the films
 * between, the last name on the row's baseline. In the light if you made it; the game's route in
 * plain ink if you gave up. A phone's row sets it as one line of names, knots between.
 */
function Chain({ r, box, lean, base, x, room, compact, drawn }: { r: TileResult; box: TileBox; lean: number; base: number; x: number; room: number; compact: boolean; drawn: number }) {
  const { people, films } = r.chain!;
  const n = people.length;
  if (compact) {
    // Two lines at most: smaller for a long chain.
    const size = Math.max(12, Math.min(17, (2 * room) / (people.join(" · ").length * 0.5)));
    return (
      <span className={styles.chainLine} style={{ left: x, bottom: onBaseline(base, size, 0.15 + BASELINE), fontSize: size, maxWidth: room, opacity: drawn }}>
        {people.map((person, j) => (
          <Fragment key={j}>
            {j > 0 && (
              <>
                {" "}
                <i className={styles.inlineKnot} data-lost={r.won ? undefined : ""} />{" "}
              </>
            )}
            <span>{person}</span>
          </Fragment>
        ))}
      </span>
    );
  }
  const h = box.y[1] - box.y[0];
  const first = box.y[0] + Math.max(64, h * 0.1);
  const step = n > 1 ? (base - first) / (n - 1) : 0;
  // The thread hangs plumb, clear of the seam where it leans furthest in (at the top).
  const kx = seamAt(box, lean, first - 30) + (x - seamAt(box, lean, base)) + 6;
  const nameX = kx + 22;
  const names = rightSeamAt(box, lean, first - 30) - 24 - nameX;
  const size = Math.max(14, Math.min(30, names / (Math.max(...people.map((p) => p.length)) * 0.52), n > 1 ? step / 1.25 : 30));
  const withFilms = n > 1 && step >= size * 1.1 + 40;
  const baseline = (j: number) => first + j * step;
  const knotY = (j: number) => baseline(j) - 0.32 * size;
  return (
    <>
      {n > 1 && <span className={styles.thread} data-lost={r.won ? undefined : ""} style={{ left: kx, top: knotY(0), height: knotY(n - 1) - knotY(0), transform: `scaleY(${drawn})` }} />}
      {people.map((person, j) => {
        const lit = clamp(drawn * n - j);
        return (
          <Fragment key={j}>
            <span className={styles.knotAt} style={{ left: kx, top: knotY(j), opacity: lit }}>
              <Knot at={j === 0 ? "start" : j === n - 1 ? "end" : "tie"} won={r.won} />
            </span>
            <span className={styles.person} style={{ left: nameX, bottom: onBaseline(baseline(j), size), fontSize: size, opacity: lit }}>
              {person}
            </span>
            {withFilms && films[j] && (
              <span className={styles.via} style={{ left: nameX + 2, top: (knotY(j) + knotY(j + 1)) / 2, maxWidth: names, opacity: lit }}>
                {films[j]}
              </span>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Today's dictionary, shut: its fore-edge whole under the lamp, a ribbon at each page you tried
 * (quiet, passed), and the one that found the word bright, hanging long toward it (laid in as the
 * print opens).
 */
function ShutBook({ m, stage, compact, hangTo, laid }: { m: Extract<TileMaterial, { kind: "letters" }>; stage: Stage; compact: boolean; hangTo: number; laid: number }) {
  const { box, lean, width, cuts } = stage;
  const w = box.x[1] - box.x[0];
  const h = box.y[1] - box.y[0];
  const band = compact ? 18 : Math.min(84, h * 0.1);
  const B = compact ? width - 40 : Math.min(420, w - 72);
  const top = compact ? box.y[0] + (cuts ? (lean * width) / 2 : 0) + 12 : box.y[0] + Math.max(64, (hangTo - box.y[0]) * 0.34);
  const cx = compact ? width / 2 : (seamAt(box, lean, top + band / 2) + rightSeamAt(box, lean, top + band / 2)) / 2;
  const left = cx - B / 2;
  const total = Math.max(1, m.total);
  // The found ribbon last, over the others.
  const ribbons = [...m.ribbons].sort((a, b) => Number(a.found) - Number(b.found));
  return (
    <>
      <BookEdge rect={{ left, top, width: B, height: band }} pages={total} />
      {ribbons.map((ribbon, i) => (
        <span
          key={i}
          className={styles.mark}
          data-found={ribbon.found ? "" : undefined}
          style={{
            left: left + ((ribbon.page + 0.5) / total) * B,
            top: top - (compact ? 4 : 8),
            height: ribbon.found ? Math.max(band + 20, hangTo - top) : band + (compact ? 10 : 26),
            ...(ribbon.found ? { transform: `scaleY(${laid})` } : {}),
          }}
        />
      ))}
    </>
  );
}

/**
 * The frame it was named on, at its own proportions (never stretched over a tall third of the
 * screen): as wide as the poster allows, above the title.
 */
function stillBox(box: TileBox, lean: number, image: AssetRef, titleTop: number): CSSProperties {
  const k = (lean * (box.y[1] - box.y[0])) / 2;
  const room = box.x[1] - box.x[0] - 2 * k - 48;
  const width = Math.max(120, Math.min(room, (image.width / image.height) * (titleTop - box.y[0] - 80)));
  const height = (width * image.height) / image.width;
  const top = Math.max(box.y[0] + 24, titleTop - 40 - height);
  return { left: (box.x[0] + box.x[1]) / 2 - width / 2, top, width, height };
}
