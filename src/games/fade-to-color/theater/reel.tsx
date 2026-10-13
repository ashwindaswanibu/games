"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import { Crossfade } from "./crossfade";
import styles from "./theater.module.css";
import { LIGHT_AT, PRESS_EASE, PRESS_MS, UNREEL_EASE, UNREEL_MS } from "./timing";
import { Lens, Viewer, Viewfinder } from "./viewer";

/** One picture on the reel. `key` identifies it; a new key is a new picture. */
export interface ReelFrame {
  key: string;
  src: string;
  alt: string;
  /** Its accent ("r g b"), which tints the light that sweeps it in. */
  accent: string;
}

/**
 * How the reel reaches a new frame: unreeled by a sweep of light, pressed in (the first reel, as the
 * film is rolled: stepped at 24 frames a second behind a hairline head), a quick cut, or at once.
 */
export type ReelMove = "unreel" | "press" | "cut" | "none";

/** The parts of a screen that the reel's moves play on: the reel's own, and on a phone the viewer's. */
export interface Gate {
  screen: HTMLElement;
  cur: HTMLImageElement;
  wipe: HTMLElement;
  next: HTMLImageElement;
  bar: HTMLElement;
  flare: HTMLElement;
}

/**
 * The unreel (or the press) on one screen, on `timing`: the wrapper slides in while the picture in
 * it slides the other way, so the new frame is uncovered in place, and the bar's track crosses with
 * them (it spans the screen, so the bar keeps in step with the wipe even if the screen changes size
 * mid-unreel: the four giving way to the end card). The press has no flare. Every screen's are
 * made together, so they start on the same frame and stay on one clock.
 */
function sweep(gate: Gate, timing: KeyframeAnimationOptions, pressing: boolean): Animation[] {
  const anims = [
    gate.wipe.animate([{ transform: "translate3d(-100%,0,0)" }, { transform: "translate3d(0,0,0)" }], timing),
    gate.next.animate([{ transform: "translate3d(100%,0,0)" }, { transform: "translate3d(0,0,0)" }], timing),
    gate.bar.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(100%,0,0)" }], timing),
  ];
  if (!pressing) anims.push(gate.flare.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 560, easing: "ease-out" }));
  return anims;
}

/**
 * The film strip: sprocket rails with edge print around a 3:1 screen, plus the light it throws
 * (a glow behind it and colour spilling up and down into the room).
 *
 * Changing `frame` plays `move`. The unreel is transforms only, so it stays smooth on any GPU: a
 * wrapper slides in from the left while the image inside it slides the other way, so the new frame
 * appears to be uncovered in place behind a moving bar of light. The press is the same move in 48
 * jumps, with no light behind its head, and the room takes the film's light only once it's done.
 * `onPress` fires as a press starts, `onLight` when the room should take the new frame's colours,
 * `onSettled` when the move has finished.
 *
 * On a phone (`lens`) the viewer comes after the reel's box (see `Viewer`), with a viewfinder on the
 * screen: every move plays on both screens at once, and as a new reel unreels the viewer rides its
 * light across, then runs back to the head.
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
  /** True while the next frame is still on its way: the light waits at the gate. */
  waiting: boolean;
  onPress?(key: string): void;
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
  /** The reel's outer box (the light and the strip), for gliding it between layouts. */
  boxRef?: Ref<HTMLDivElement>;
  /** On a phone: the viewer under the reel, with what it draws over its window and behind it (the win's title and its light, which it holds there). */
  lens?: { overlay?: ReactNode; aura?: ReactNode } | null;
}) {
  const { frame, move, waiting, edgeVariant = "count", boxRef, overlay, aura, edgeTitle, edgeStart, edgeEnd, edgeBottom, spill, leader, lens } = props;
  const [viewer] = useState(() => new Lens());
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
  const latest = useRef({ frame, move, onPress: props.onPress, onLight: props.onLight, onSettled: props.onSettled });
  useLayoutEffect(() => {
    latest.current = { frame, move, onPress: props.onPress, onLight: props.onLight, onSettled: props.onSettled };
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
    // The screens it plays on: the reel's own, and the viewer's while it's on the page.
    const own: Gate = { screen: screen.current!, cur: cur.current!, wipe: wipe.current!, next: next.current!, bar: barTrack.current!, flare: flare.current! };
    const gates = viewer.gate ? [own, viewer.gate] : [own];
    const settle = () => {
      if (cancelled) return;
      setHasPicture(true);
      latest.current.onSettled(target.key);
    };
    const place = async () => {
      const img = own.cur;
      img.src = target.src;
      img.alt = target.alt;
      // Which level this is (the src is an object URL; see src/lib/sealed-assets.ts).
      img.dataset.asset = target.key;
      for (const gate of gates) gate.cur.src = target.src;
      await Promise.all(gates.map((gate) => gate.cur.decode().catch(() => {})));
    };

    async function run() {
      if (move === "none" || (reduce && (move === "unreel" || move === "press") && from === null)) {
        await place();
        // The first picture opens at its head in the viewer.
        if (from === null) viewer.park(0);
        if (move === "press") latest.current.onPress?.(target.key);
        latest.current.onLight(target.key);
        settle();
        return;
      }
      if (move === "cut" || reduce) {
        // A quick cut: the old picture flashes out, the new one comes up. From the leader (a
        // reload mid-play), the picture simply fades up.
        const flash = [{ opacity: 1, filter: "brightness(1)" }, { opacity: 0.15, filter: "brightness(1.7)" }];
        if (from !== null) {
          const out = gates.map((gate) => gate.cur.animate(flash, { duration: reduce ? 1 : 160, easing: "ease-in" }));
          running.current.push(...out);
          await out[0].finished.catch(() => {});
          if (cancelled) return;
        }
        await place();
        if (cancelled) return;
        // A new reel (or the first picture) opens at its head in the viewer; looking back keeps its place.
        if (from === null || move !== "cut") viewer.park(0);
        setHasPicture(true);
        latest.current.onLight(target.key);
        const back = gates.map((gate) =>
          gate.cur.animate(from === null ? [{ opacity: 0 }, { opacity: 1 }] : [...flash].reverse(), {
            duration: reduce ? 1 : from === null ? 700 : 340,
            easing: "ease-out",
          }),
        );
        running.current.push(...back);
        await back[0].finished.catch(() => {});
        settle();
        return;
      }

      // Unreel, or press: the same move, the press stepped and without the flare, and the room
      // taking the film's light only once it's done.
      const pressing = move === "press";
      for (const gate of gates) gate.next.src = target.src;
      own.next.dataset.asset = target.key;
      await Promise.all(gates.map((gate) => gate.next.decode().catch(() => {})));
      if (cancelled) return;
      for (const gate of gates) {
        gate.screen.style.setProperty("--incoming", target.accent);
        gate.screen.dataset.unreeling = "";
        if (pressing) gate.screen.dataset.pressing = "";
      }
      const timing = pressing
        ? { duration: PRESS_MS, easing: PRESS_EASE, fill: "forwards" as const }
        : { duration: UNREEL_MS, easing: UNREEL_EASE, fill: "forwards" as const };
      // The reel's own first (the move ends when its wipe does), then the viewer's, and its ride.
      const animations = gates.flatMap((gate) => sweep(gate, timing, pressing));
      if (gates.length > 1) animations.push(...viewer.ride(timing));
      running.current.push(...animations);
      if (pressing) latest.current.onPress?.(target.key);
      else lightTimer = setTimeout(() => latest.current.onLight(target.key), UNREEL_MS * LIGHT_AT);
      await animations[0].finished.catch(() => {});
      clearTimeout(lightTimer);
      if (cancelled) return;
      latest.current.onLight(target.key);
      await place();
      if (cancelled) return;
      // Show the picture (and take the leader down) before the wipe goes, or the leader can flash for a frame.
      flushSync(() => setHasPicture(true));
      for (const gate of gates) {
        delete gate.screen.dataset.unreeling;
        delete gate.screen.dataset.pressing;
      }
      // The viewer has ridden the light to the film's end: back to the new reel's head.
      if (gates.length > 1) viewer.rewind();
      animations.forEach((a) => a.cancel());
      settle();
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(lightTimer);
      for (const gate of gates) {
        delete gate.screen.dataset.unreeling;
        delete gate.screen.dataset.pressing;
      }
    };
  }, [frameKey, viewer]);

  // A picture can go up before its colours are worked out (see `useLevelArt`): the light still
  // sweeping it in takes its accent as it arrives.
  const accent = frame?.accent ?? null;
  useEffect(() => {
    if (accent === null || frameKey !== shown.current) return;
    for (const el of [screen.current, viewer.gate?.screen]) if (el?.dataset.unreeling !== undefined) el.style.setProperty("--incoming", accent);
  }, [accent, frameKey, viewer]);

  // A viewer that comes onto the page mid-play (the window narrowed to a phone's) takes the picture on screen.
  const lensOn = Boolean(lens);
  useLayoutEffect(() => {
    if (lensOn) viewer.show(cur.current);
  }, [lensOn, viewer]);

  return (
    <>
      <div ref={boxRef} className={styles.reelBox} data-picture={hasPicture || undefined}>
        <div className={styles.spillLight} aria-hidden>
          <Crossfade src={spill} className={styles.spill} />
        </div>
        <div className={styles.glow} aria-hidden />
        {aura}
        <div className={styles.reel}>
          <Rail edgeStart={edgeStart} edgeEnd={edgeEnd} edgeKey={edgeVariant} fresh={edgeVariant !== firstVariant} edgeTitle={edgeTitle} />
          <div ref={screen} className={styles.screen} data-waiting={waiting || undefined} {...(lens ? viewer.reelHandlers : null)}>
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
            {lens && <Viewfinder lens={viewer} />}
          </div>
          <Rail>{edgeBottom}</Rail>
        </div>
      </div>
      {lens && <Viewer lens={viewer} picture={hasPicture} waiting={waiting} leader={leader} overlay={lens.overlay} aura={lens.aura} />}
    </>
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
