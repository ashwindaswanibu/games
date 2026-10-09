"use client";

import { useCallback, useState, type CSSProperties } from "react";
import type { Portrait } from "@/games/_movies/schemas";
import { stretch, threadGeometry, type Thread, type ThreadKnot, type ThreadSegment } from "./thread";
import styles from "./screen.module.css";

/**
 * How the board is playing right now. `intro`: the thread is drawn in for the first time, seen
 * live. `win`: the end was just reached; a light runs the thread from end to end. `reveal`: the
 * shortest route, drawn in after giving up. `still`: as it is.
 */
export type BoardMode = "intro" | "win" | "reveal" | "still";

/**
 * The thread across the room (down it, on a phone): the start actor at one end and the end actor
 * at the other, a knot for each co-star between, and on each stretch the film it passes through.
 * Everything sits where `threadGeometry` puts it and glides there when the chain changes (a link
 * tied, undone, or the thread sagging with slack).
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
}) {
  const { thread, mode, variant, label, portraitOf } = props;
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

  return (
    <div
      ref={measure}
      className={styles.board}
      data-vertical={vertical || undefined}
      data-mode={mode}
      data-variant={variant}
      data-settled={settled || undefined}
      data-reached={thread.reached || undefined}
      style={vertical && geometry ? { height: geometry.height } : undefined}
    >
      {geometry && (
        <>
          <div className={styles.lines} aria-hidden>
            {thread.segments.map((segment, i) => {
              const s = stretch(geometry.points[i]!, geometry.points[i + 1]!);
              return (
                <span
                  key={segment.key}
                  className={styles.segment}
                  data-kind={segment.kind}
                  data-ghost={(segment.ghost !== null && segment.film === null) || undefined}
                  data-fresh={(segment.kind === "tied" && fresh(segment.key)) || undefined}
                  style={{ "--x": `${s.x}px`, "--y": `${s.y}px`, "--len": `${s.length}px`, "--angle": `${s.angle}deg`, "--i": i } as CSSProperties}
                >
                  <span className={styles.segmentLine} />
                </span>
              );
            })}
          </div>
          <ol className={styles.knots} aria-label={label}>
            {thread.knots.map((knot, i) => {
              const at = geometry.points[i]!;
              const into = i > 0 ? thread.segments[i - 1]! : null;
              const mid = i > 0 ? midpoint(geometry.points[i - 1]!, at) : null;
              const angle = i > 0 && !vertical ? stretch(geometry.points[i - 1]!, at).angle : 0;
              const room = vertical ? null : Math.max(84, geometry.spacing - 18);
              return (
                <li key={knot.key} className={styles.knotItem} data-fresh={(knot.person !== null && i > 0 && into?.kind === "tied" && fresh(into.key)) || undefined}>
                  {into && mid && <FilmLabel segment={into} at={mid} angle={angle} width={room} index={i - 1} />}
                  <Knot knot={knot} index={i} x={at.x} y={at.y} width={room} last={i === thread.knots.length - 1} portraitOf={portraitOf} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The film a stretch passes through, riding just above it (beside it, down a phone). */
function FilmLabel({ segment, at, angle, width, index }: { segment: ThreadSegment; at: { x: number; y: number }; angle: number; width: number | null; index: number }) {
  const film = segment.film ?? segment.ghost;
  if (!film) return null;
  const ghost = segment.film === null;
  return (
    <span
      className={styles.film}
      data-ghost={ghost || undefined}
      data-draft={segment.draft || undefined}
      style={{ "--x": `${at.x}px`, "--y": `${at.y}px`, "--angle": `${angle}deg`, "--w": width ? `${width}px` : undefined, "--i": index } as CSSProperties}
    >
      <span className={styles.srOnly}>{ghost ? "Hint: through " : segment.draft ? "Chosen film: " : "via "}</span>
      <span className={styles.filmTitle}>{film.title}</span>
      {film.year && !ghost && <span className={styles.filmYear}> {film.year}</span>}
    </span>
  );
}

/**
 * A knot: a person tied into the chain (the two ends large), or a place still to tie. With a face,
 * the two ends' are large and low-key behind their names, like a title card's; a co-star's sits on
 * the knot. Faces are toned to the room while playing and take their colour when the end is reached.
 */
function Knot(props: { knot: ThreadKnot; index: number; x: number; y: number; width: number | null; last: boolean; portraitOf: (personId: number) => Portrait | null }) {
  const { knot, index, x, y, width, last, portraitOf } = props;
  const end = knot.kind === "start" || (knot.kind === "end" && last);
  const side = knot.kind === "start" ? "start" : end ? "end" : undefined;
  const style = { "--x": `${x}px`, "--y": `${y}px`, "--w": width ? `${width}px` : undefined, "--i": index } as CSSProperties;
  const who = knot.person ?? knot.ghost;
  const face = who ? portraitOf(who.id) : null;
  return (
    <>
      <span className={styles.knot} data-kind={knot.kind} style={style} aria-hidden />
      {face && <Face key={face.src} src={face.src} side={side} ghost={!knot.person} style={style} />}
      {knot.person ? (
        <span className={end ? styles.endName : styles.name} data-side={side} data-face={face !== null || undefined} style={style}>
          {end && (
            <span className={styles.endLabel} aria-hidden>
              {knot.kind === "start" ? "From" : "To"}
            </span>
          )}
          <span className={styles.srOnly}>{knot.kind === "start" ? "Start: " : knot.kind === "end" ? "End: " : ""}</span>
          {knot.person.name}
        </span>
      ) : knot.ghost ? (
        <span className={styles.name} data-ghost data-face={face !== null || undefined} style={style}>
          <span className={styles.srOnly}>Hint: </span>
          {knot.ghost.name}
        </span>
      ) : (
        <span className={styles.srOnly}>{knot.kind === "open" ? "Next link, to make" : "A link still to make"}</span>
      )}
    </>
  );
}

/** A face, faded in once it has loaded (until then, and if it never does, the knot shows alone). */
function Face({ src, side, ghost, style }: { src: string; side: "start" | "end" | undefined; ghost: boolean; style: CSSProperties }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={styles.face} data-side={side} data-ghost={ghost || undefined} data-loaded={loaded || undefined} style={style} aria-hidden>
      {/* A small, already cropped WebP from our own route: next/image would only add a hop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" decoding="async" onLoad={() => setLoaded(true)} />
    </span>
  );
}
