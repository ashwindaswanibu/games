"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { Crossfade } from "./crossfade";
import styles from "./theater.module.css";
import { LIGHT_AT, UNREEL_EASE, UNREEL_MS } from "./timing";

/** One picture on the reel. `key` identifies it; a new key is a new picture. */
export interface ReelFrame {
  key: string;
  src: string;
  alt: string;
  /** Its accent ("r g b"), which tints the light that sweeps it in. */
  accent: string;
}

/** How the reel reaches a new frame: unreeled by a sweep of light, a quick cut, or at once. */
export type ReelMove = "unreel" | "cut" | "none";


/**
 * The film strip: sprocket rails with edge print around a 3:1 screen, plus the light it throws
 * (a glow behind it and colour spilling up and down into the room) and its reflection on the floor.
 *
 * Changing `frame` plays `move`. The unreel is transforms only, so it stays smooth on any GPU: a
 * wrapper slides in from the left while the image inside it slides the other way, so the new frame
 * appears to be uncovered in place behind a moving bar of light. `onLight` fires when the room
 * should take the new frame's colours, `onSettled` when the move has finished.
 */
export function Reel(props: {
  frame: ReelFrame | null;
  move: ReelMove;
  /** Edge print along the top rail. */
  edgeStart: string;
  edgeEnd: string;
  /**
   * What `edgeEnd` says, apart from the reel number: `count` (`REEL 04 ◂ 10`), `held` (the film was
   * stopped: `REEL 04 ◂ HELD`) or `runout` (the reels ran out: `REEL 10 ◂ RUN-OUT`). A change after
   * the first render prints the new label in, once.
   */
  edgeVariant?: "count" | "held" | "runout";
  /** Edge print along the bottom rail (the frames' source, once the film is known). */
  edgeBottom?: ReactNode;
  /** The barcode as light (a data URL), spilling into the room around the reel. */
  spill: string | null;
  reflection: string | null;
  /** True while the next frame is still on its way: the light waits at the gate. */
  waiting: boolean;
  onLight(key: string): void;
  onSettled(key: string): void;
  /** Drawn on the screen before the first frame: the leader. */
  leader?: ReactNode;
  /** Drawn over the picture, under the unreel's sweep (the win's title card). */
  overlay?: ReactNode;
  /** More light behind the reel, beside its own glow (the title's, as the film names itself). */
  aura?: ReactNode;
  /** A second label stacked on `edgeEnd`, for the win to print in ("Main title"); hidden until then. */
  edgeTitle?: string | null;
  /** The reel's outer box (the light, the strip and its reflection), for gliding it between layouts. */
  boxRef?: Ref<HTMLDivElement>;
}) {
  const { frame, move, waiting, edgeVariant = "count", boxRef, overlay, aura, edgeTitle, edgeStart, edgeEnd, edgeBottom, spill, reflection, leader } = props;
  // The label the page opened with is simply there; a later one prints in.
  const [firstVariant] = useState(edgeVariant);
  const screen = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLImageElement>(null);
  const wipe = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLImageElement>(null);
  const barTrack = useRef<HTMLDivElement>(null);
  const flare = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  // The leader stays up until the first frame has fully unreeled over it.
  const [hasPicture, setHasPicture] = useState(false);
  const running = useRef<Animation[]>([]);
  // The effect below runs once per new frame; it reads the latest props through this ref, so a
  // re-render mid-move (the room relighting, art arriving) never restarts or cancels it.
  const latest = useRef({ frame, move, onLight: props.onLight, onSettled: props.onSettled });
  useLayoutEffect(() => {
    latest.current = { frame, move, onLight: props.onLight, onSettled: props.onSettled };
  });
  const frameKey = frame?.key ?? null;

  useEffect(() => {
    const { frame: incoming, move } = latest.current;
    if (!incoming || incoming.key === shown.current) return;
    const target: ReelFrame = incoming;
    const from = shown.current;
    shown.current = target.key;
    let cancelled = false;
    let lightTimer: ReturnType<typeof setTimeout> | undefined;

    // A move that arrives mid-move finishes the old one at once.
    running.current.forEach((a) => a.cancel());
    running.current = [];

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const settle = () => {
      if (cancelled) return;
      setHasPicture(true);
      latest.current.onSettled(target.key);
    };
    const place = async () => {
      const img = cur.current!;
      img.src = target.src;
      img.alt = target.alt;
      // Which level this is (the src is an object URL; see src/lib/sealed-assets.ts).
      img.dataset.asset = target.key;
      await img.decode().catch(() => {});
    };

    async function run() {
      if (move === "none" || (reduce && move === "unreel" && from === null)) {
        await place();
        latest.current.onLight(target.key);
        settle();
        return;
      }
      if (move === "cut" || reduce) {
        // A quick cut: the old picture flashes out, the new one comes up. From the leader (a
        // reload mid-play), the picture simply fades up.
        const img = cur.current!;
        const flash = [{ opacity: 1, filter: "brightness(1)" }, { opacity: 0.15, filter: "brightness(1.7)" }];
        if (from !== null) {
          const out = img.animate(flash, { duration: reduce ? 1 : 160, easing: "ease-in" });
          running.current.push(out);
          await out.finished.catch(() => {});
          if (cancelled) return;
        }
        await place();
        if (cancelled) return;
        setHasPicture(true);
        latest.current.onLight(target.key);
        const back = img.animate(from === null ? [{ opacity: 0 }, { opacity: 1 }] : [...flash].reverse(), {
          duration: reduce ? 1 : from === null ? 700 : 340,
          easing: "ease-out",
        });
        running.current.push(back);
        await back.finished.catch(() => {});
        settle();
        return;
      }

      // Unreel.
      const nxt = next.current!;
      nxt.src = target.src;
      nxt.dataset.asset = target.key;
      await nxt.decode().catch(() => {});
      if (cancelled) return;
      screen.current!.style.setProperty("--incoming", target.accent);
      screen.current!.dataset.unreeling = "";
      const timing = { duration: UNREEL_MS, easing: UNREEL_EASE, fill: "forwards" as const };
      const animations = [
        wipe.current!.animate([{ transform: "translate3d(-100%,0,0)" }, { transform: "translate3d(0,0,0)" }], timing),
        nxt.animate([{ transform: "translate3d(100%,0,0)" }, { transform: "translate3d(0,0,0)" }], timing),
        // The bar's track spans the screen, so the bar crosses it in step with the wipe even if the
        // screen changes size mid-unreel (the four giving way to the end card).
        barTrack.current!.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(100%,0,0)" }], timing),
        flare.current!.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 560, easing: "ease-out" }),
      ];
      running.current.push(...animations);
      lightTimer = setTimeout(() => latest.current.onLight(target.key), UNREEL_MS * LIGHT_AT);
      await animations[0].finished.catch(() => {});
      clearTimeout(lightTimer);
      if (cancelled) return;
      latest.current.onLight(target.key);
      await place();
      if (cancelled) return;
      // Show the picture (and take the leader down) before the wipe goes, or the leader can flash for a frame.
      flushSync(() => setHasPicture(true));
      delete screen.current!.dataset.unreeling;
      animations.forEach((a) => a.cancel());
      settle();
    }

    void run();
    const el = screen.current;
    return () => {
      cancelled = true;
      clearTimeout(lightTimer);
      if (el) delete el.dataset.unreeling;
    };
  }, [frameKey]);

  return (
    <div ref={boxRef} className={styles.reelBox}>
      <div className={styles.spillLight} aria-hidden>
        <Crossfade src={spill} className={styles.spill} />
      </div>
      <div className={styles.glow} aria-hidden />
      {aura}
      <div className={styles.reel}>
        <Rail edgeStart={edgeStart} edgeEnd={edgeEnd} edgeKey={edgeVariant} fresh={edgeVariant !== firstVariant} edgeTitle={edgeTitle} />
        <div ref={screen} className={styles.screen} data-waiting={waiting || undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin asset drawn and animated by hand */}
          <img ref={cur} className={styles.frame} alt="" hidden={!hasPicture} />
          {!hasPicture && leader}
          {overlay}
          <div ref={wipe} className={styles.wipe} aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img ref={next} className={styles.frame} alt="" />
          </div>
          <div ref={flare} className={styles.flare} aria-hidden />
          <div ref={barTrack} className={styles.lightbarTrack} aria-hidden>
            <div className={styles.lightbar} />
          </div>
        </div>
        <Rail>{edgeBottom}</Rail>
      </div>
      <div className={styles.reflection} aria-hidden>
        <Crossfade src={reflection} className={styles.reflectionImage} />
      </div>
    </div>
  );
}

/**
 * A sprocket rail with its edge print: two labels at the ends, or one (`children`) at the right.
 * A new `edgeKey` replaces the end label with a fresh one, printed in when `fresh`. `edgeTitle`
 * stacks a second label in the end label's place, unseen until it's printed in. Each label carries
 * `data-edge` (`start`, `end`, `title`, `bottom`), for the win to dim and print by.
 */
function Rail(props: { edgeStart?: string; edgeEnd?: string; edgeKey?: string; fresh?: boolean; edgeTitle?: string | null; children?: ReactNode }) {
  const { edgeStart, edgeEnd, edgeKey, fresh, edgeTitle, children } = props;
  return (
    <div className={styles.rail}>
      <div className={styles.holes} />
      {edgeStart !== undefined && (
        <span className={styles.edge} data-edge="start">
          {edgeStart}
        </span>
      )}
      {edgeEnd !== undefined && (
        <span className={styles.edgeStack}>
          <span key={edgeKey} className={styles.edge} data-edge="end" data-fresh={fresh || undefined}>
            {edgeEnd}
          </span>
          {edgeTitle && (
            <span className={styles.edge} data-edge="title">
              {edgeTitle}
            </span>
          )}
        </span>
      )}
      {children && (
        <span className={`${styles.edge} ${styles.edgeEnd}`} data-edge="bottom">
          {children}
        </span>
      )}
    </div>
  );
}
