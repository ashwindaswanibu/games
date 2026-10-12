"use client";

import { useCallback, useState, type CSSProperties } from "react";
import type { Portrait } from "@/games/_movies/schemas";
import { endNameSize, lightTimes, stretch, threadGeometry, twoLines, type Point, type Thread, type ThreadKnot, type ThreadSegment } from "./thread";
import styles from "./screen.module.css";

/**
 * How the board is playing right now. `intro`: the thread is drawn in for the first time, seen
 * live. `win`: the end was just reached; a light runs the thread from end to end. `reveal`: the
 * shortest route, drawn in after giving up. `still`: as it is.
 */
export type BoardMode = "intro" | "win" | "reveal" | "still";

/** From this board width the link being made is written on the thread itself; narrower, it stays in the console. */
const WRITE_ON_THREAD_FROM = 900;
/** Half the width of the hits a field on the thread drops, and a margin: how far in from the board's edges they stay. */
const HITS_HALF = 198;

/**
 * The thread across the room (down it, on a phone): the start actor at one end and the end actor
 * at the other, set as title cards above the line, a knot for each co-star between (their face
 * hanging under it), and on each stretch the film it passes through. Everything sits where
 * `threadGeometry` puts it and glides there when the chain changes (a link tied, undone, or the
 * thread sagging with slack).
 *
 * On a wide screen the link being made is written on the thread (`line`): the film's field on the
 * open stretch, then the co-star's under the open knot. The console's line is drawn into the slot
 * the board leaves there.
 *
 * Read as a list, in chain order: each person, after the film that reached them.
 */
export function Board(props: {
  thread: Thread;
  mode: BoardMode;
  /** Whose chain it is: the player's, or our shortest route (drawn quieter). */
  variant: "yours" | "ours";
  label: string;
  /** A person's face, once known (null: none, or not yet). */
  portraitOf: (personId: number) => Portrait | null;
  /** The play is on its last move: the end ring takes the warm light. */
  lastMove?: boolean;
  /** Start was pressed: the notes on the unlit thread make way for today's pair. */
  starting?: boolean;
  /** The link being made, while playing: which step it's at (its film, or its co-star). */
  line?: "film" | "cast" | null;
  /** Where the board hands over the slot it leaves on the thread for that line (null: none). */
  hostLine?: (el: HTMLElement | null) => void;
  /** Puts the chosen film back: on the thread, the film riding the open stretch is that control. */
  onChangeFilm?: () => void;
}) {
  const { thread, mode, variant, label, portraitOf, lastMove = false, starting = false, line = null, hostLine, onChangeFilm } = props;
  // Ties on the board when it first drew; any tied since draw themselves in.
  const [first] = useState(() => new Set(thread.segments.filter((s) => s.kind === "tied").map((s) => s.key)));
  const fresh = (key: string) => !first.has(key);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // The board's size, kept up to date; transitions start only once it's been measured and drawn.
  const [settled, setSettled] = useState(false);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry!.contentRect;
      setBox((prev) => (prev && prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const geometry = box ? threadGeometry(thread.knots.length, thread.slack, box) : null;
  const vertical = geometry?.vertical ?? false;
  const stretches = geometry ? thread.segments.map((_, i) => stretch(geometry.points[i]!, geometry.points[i + 1]!)) : [];
  // When the light reaches each part of the thread on a win.
  const light = lightTimes(stretches.map((s) => s.length));
  const room = geometry && !vertical ? Math.max(84, geometry.spacing - 18) : null;

  // Where the link being made is written: the open stretch (its film), then under the knot it ties (its co-star).
  const open = thread.segments.findIndex((s) => s.kind === "open");
  const slot = geometry && box && line && hostLine && !vertical && box.width >= WRITE_ON_THREAD_FROM && open >= 0 ? slotOn(line, geometry.points, open, box.width) : null;

  return (
    <div
      ref={measure}
      className={styles.board}
      data-vertical={vertical || undefined}
      data-mode={mode}
      data-variant={variant}
      data-settled={settled || undefined}
      data-reached={thread.reached || undefined}
      data-last-move={lastMove || undefined}
      data-starting={starting || undefined}
      data-writing={slot ? true : undefined}
      style={geometry ? ({ "--spacing": `${geometry.spacing}px`, height: vertical ? geometry.height : undefined } as CSSProperties) : undefined}
    >
      {geometry && (
        <>
          <div className={styles.lines} aria-hidden>
            {thread.segments.map((segment, i) => {
              const s = stretches[i]!;
              const lit = light.segments[i]!;
              return (
                <span
                  key={segment.key}
                  className={styles.segment}
                  data-kind={segment.kind}
                  data-ghost={(segment.ghost !== null && segment.film === null) || undefined}
                  data-fresh={(segment.kind === "tied" && fresh(segment.key)) || undefined}
                  style={
                    {
                      "--x": `${s.x}px`,
                      "--y": `${s.y}px`,
                      "--len": `${s.length}px`,
                      "--angle": `${s.angle}deg`,
                      "--i": i,
                      "--lit-at": `${lit.at}ms`,
                      "--lit-for": `${lit.for}ms`,
                    } as CSSProperties
                  }
                >
                  <span className={styles.segmentLine} />
                  <span className={styles.segmentLit} />
                  <span className={styles.segmentBead} />
                </span>
              );
            })}
          </div>
          <ol className={styles.knots} aria-label={label}>
            {thread.knots.map((knot, i) => {
              const at = geometry.points[i]!;
              const into = i > 0 ? thread.segments[i - 1]! : null;
              const mid = i > 0 ? midpoint(geometry.points[i - 1]!, at) : null;
              const angle = i > 0 && !vertical ? stretches[i - 1]!.angle : 0;
              return (
                <li key={knot.key} className={styles.knotItem} data-fresh={(knot.person !== null && i > 0 && into?.kind === "tied" && fresh(into.key)) || undefined}>
                  {into && mid && (
                    <FilmLabel
                      segment={into}
                      at={mid}
                      angle={angle}
                      width={room}
                      index={i - 1}
                      litAt={light.films[i - 1]!}
                      hosting={slot?.step === "film" && open === i - 1}
                      onChange={slot ? onChangeFilm : undefined}
                    />
                  )}
                  <Knot
                    knot={knot}
                    index={i}
                    at={at}
                    width={room}
                    last={i === thread.knots.length - 1}
                    boardWidth={box!.width}
                    litAt={light.knots[i]!}
                    hosting={slot?.step === "cast" && open + 1 === i}
                    portraitOf={portraitOf}
                  />
                </li>
              );
            })}
          </ol>
          {slot && (
            <div
              key={`${slot.step}:${open}`}
              ref={hostLine}
              className={styles.slot}
              data-step={slot.step}
              data-edge={slot.edge}
              style={
                {
                  "--x": `${slot.at.x}px`,
                  "--y": `${slot.at.y}px`,
                  "--w": `${room}px`,
                  "--shift": `${slot.shift}px`,
                } as CSSProperties
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Where the link being made is written, with the stretch `open` the one being made: its film on
 * that stretch's middle, its co-star under the knot it ties (right-aligned under the end ring).
 * `shift` keeps the hits the field drops inside the board.
 */
function slotOn(step: "film" | "cast", points: readonly Point[], open: number, boardWidth: number) {
  const at = step === "film" ? midpoint(points[open]!, points[open + 1]!) : points[open + 1]!;
  const edge = step === "cast" && open + 1 === points.length - 1 ? ("end" as const) : undefined;
  const shift = Math.max(0, HITS_HALF - at.x) + Math.min(0, boardWidth - HITS_HALF - at.x);
  return { step, at, edge, shift };
}

/**
 * The film a stretch passes through, riding just above it (beside it, down a phone). Before the
 * play, the stretch's note. The film chosen for the link being made, written on the thread, is
 * the control that puts it back (`onChange`).
 */
function FilmLabel(props: {
  segment: ThreadSegment;
  at: Point;
  angle: number;
  width: number | null;
  index: number;
  litAt: number;
  /** The link's field is written on this stretch. */
  hosting: boolean;
  onChange?: () => void;
}) {
  const { segment, at, angle, width, index, litAt, hosting, onChange } = props;
  const film = segment.film ?? segment.ghost;
  const style = {
    "--x": `${at.x}px`,
    "--y": `${at.y}px`,
    "--angle": `${angle}deg`,
    "--w": width ? `${width}px` : undefined,
    "--i": index,
    "--lit-at": `${litAt}ms`,
  } as CSSProperties;
  if (!film) {
    return segment.note ? (
      <span key="note" className={styles.film} data-note style={style} aria-hidden>
        {segment.note}
      </span>
    ) : null;
  }
  const ghost = segment.film === null;
  const title = (
    <>
      <span className={styles.filmTitle}>{film.title}</span>
      {film.year && !ghost && <span className={styles.filmYear}> {film.year}</span>}
    </>
  );
  return (
    <span className={styles.film} data-ghost={ghost || undefined} data-draft={segment.draft || undefined} data-hosting={hosting || undefined} style={style}>
      <span className={styles.srOnly}>{ghost ? "Hint: through " : segment.draft ? "Chosen film: " : "via "}</span>
      {segment.draft && onChange ? (
        <button type="button" className={styles.filmButton} onClick={onChange} aria-label={`Change the film (${film.title})`}>
          {title}
          <span className={styles.filmClear} aria-hidden>
            ×
          </span>
        </button>
      ) : (
        title
      )}
    </span>
  );
}

/**
 * A knot: a person tied into the chain (the two ends as title cards), or a place still to tie.
 * With a face, the two ends' are large and low-key behind their names; a co-star's hangs under the
 * knot, their name across its chin. Faces are silver while playing and take their colour as the
 * light reaches them. Before the play, a knot carries its note instead.
 */
function Knot(props: {
  knot: ThreadKnot;
  index: number;
  at: Point;
  width: number | null;
  last: boolean;
  boardWidth: number;
  litAt: number;
  /** The co-star's field is written under this knot. */
  hosting: boolean;
  portraitOf: (personId: number) => Portrait | null;
}) {
  const { knot, index, at, width, last, boardWidth, litAt, hosting, portraitOf } = props;
  const end = knot.kind === "start" || (knot.kind === "end" && last);
  const side = knot.kind === "start" ? "start" : end ? "end" : undefined;
  const style = { "--x": `${at.x}px`, "--y": `${at.y}px`, "--w": width ? `${width}px` : undefined, "--i": index, "--lit-at": `${litAt}ms` } as CSSProperties;
  const who = knot.person ?? knot.ghost;
  const face = who ? portraitOf(who.id) : null;
  const label = end && (
    <span className={styles.endLabel} aria-hidden>
      {knot.kind === "start" ? "From" : "To"}
    </span>
  );
  return (
    <>
      <span className={styles.knot} data-kind={knot.kind} style={style} aria-hidden />
      {face && <Face key={face.src} src={face.src} side={side} ghost={!knot.person} style={style} />}
      {knot.person ? (
        <span
          className={end ? styles.endName : styles.name}
          data-side={side}
          data-face={face !== null || undefined}
          style={end ? ({ ...style, "--end-size": `${endNameSize(knot.person.name, boardWidth)}px` } as CSSProperties) : style}
        >
          {label}
          <span className={styles.srOnly}>{knot.kind === "start" ? "Start: " : knot.kind === "end" ? "End: " : ""}</span>
          {end ? <EndLines name={knot.person.name} /> : knot.person.name}
        </span>
      ) : knot.ghost ? (
        <span className={styles.name} data-ghost data-face={face !== null || undefined} data-hosting={hosting || undefined} style={style}>
          <span className={styles.srOnly}>Hint: </span>
          {knot.ghost.name}
        </span>
      ) : knot.note ? (
        <span key="note" className={end ? styles.endName : styles.name} data-side={side} data-note style={style} aria-hidden>
          {label}
          {end ? <EndLines name={knot.note} /> : knot.note}
        </span>
      ) : (
        <span className={styles.srOnly}>{knot.kind === "open" ? "Next link, to make" : "A link still to make"}</span>
      )}
    </>
  );
}

/** An end's name on its title card's two lines (read as the one name: the lines are joined by a space). */
function EndLines({ name }: { name: string }) {
  const [one, two] = twoLines(name);
  return (
    <>
      <span className={styles.endLine}>{one}</span>
      {two !== undefined && (
        <>
          {" "}
          <span className={styles.endLine}>{two}</span>
        </>
      )}
    </>
  );
}

/**
 * A face, faded in once it has loaded (until then, and if it never does, the knot shows alone): a
 * silver print, with the colour print over it that the light develops on a win.
 */
function Face({ src, side, ghost, style }: { src: string; side: "start" | "end" | undefined; ghost: boolean; style: CSSProperties }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={styles.face} data-side={side} data-ghost={ghost || undefined} data-loaded={loaded || undefined} style={style} aria-hidden>
      {/* A small, already cropped WebP from our own route: next/image would only add a hop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.faceBase} src={src} alt="" decoding="async" onLoad={() => setLoaded(true)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.faceColour} src={src} alt="" decoding="async" />
    </span>
  );
}
