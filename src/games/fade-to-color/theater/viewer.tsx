"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Gate } from "./reel";
import styles from "./theater.module.css";
import { DOWN, SETTLE } from "./timing";

/** How much of the film's run the viewer shows at once: a third, three times larger than the reel. */
const SPAN = 1 / 3;
/** The furthest its window can start: the film's last third. */
const END = 1 - SPAN;
/** An arrow key moves the viewer a sixth of the film, over this long. */
const STEP = 1 / 6;
const STEP_MS = 320;
/** Once a reel has unreeled, the viewer runs back to its head over this long. */
const REWIND_MS = 900;

/** The stylesheet's compact layout: the viewer is drawn only there. */
const COMPACT = "(max-width: 640px)";

const clamp = (at: number) => Math.min(END, Math.max(0, at));
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The viewer's film and the reel's viewfinder at `at`, each in its own percentages (the film is three screens wide, the viewfinder a third of one). */
const filmAt = (at: number) => `translate3d(${(-at * 100).toFixed(4)}%,0,0)`;
const finderAt = (at: number) => `translate3d(${(at * 300).toFixed(4)}%,0,0)`;

/** True on a phone (the compact layout). False on the server, so the page hydrates as a laptop's would. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, () => window.matchMedia(COMPACT).matches, () => false);
}

function subscribeCompact(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Where the viewer is on the film, and everything that moves it. `at` is where its window starts,
 * as a fraction of the film's run (0, the head, to 2/3, the last third). At rest it's written on
 * the viewer's film and on the reel's viewfinder as transforms, in their own percentages, so a
 * resize or a glide never needs a rewrite; animations may be carrying them past it.
 *
 * The player moves it by dragging the viewer (the film follows the finger, 1:1), by dragging or
 * pressing the reel (the viewfinder follows the finger: 3:1), or with the arrow keys on the
 * viewer. It stays where it's left: no inertia. A drag only notes `at` and asks for a frame; the
 * frame writes the transforms. A new reel moves it on its own (`ride`, then `rewind`), unless the
 * player takes it in the meantime.
 */
export class Lens {
  private at = SPAN;
  private film: HTMLElement | null = null;
  private finder: HTMLElement | null = null;
  private slider: HTMLElement | null = null;
  private parts: Gate | null = null;
  private onRest: ((at: number) => void) | null = null;
  private frame = 0;
  private drag: { id: number; x: number; from: number; rate: number } | null = null;
  /** The player has moved the viewer since the reel last began to unreel. */
  private taken = false;

  /** Pointer handlers for the viewer itself, and for the reel's screen. */
  readonly viewerHandlers = this.handlers("viewer");
  readonly reelHandlers = this.handlers("reel");

  /** The viewer's screen, for the reel to play its moves on, while the viewer is on the page. */
  get gate(): Gate | null {
    return this.parts;
  }

  /** The viewer, mounted (or gone): itself (the slider), its film, its screen, and whom to tell where it comes to rest. */
  attach(viewer: { slider: HTMLElement; film: HTMLElement; gate: Gate; onRest(at: number): void } | null): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.slider = viewer?.slider ?? null;
    this.film = viewer?.film ?? null;
    this.parts = viewer?.gate ?? null;
    this.onRest = viewer?.onRest ?? null;
    this.drag = null;
    this.write();
  }

  attachFinder(el: HTMLElement | null): void {
    this.finder = el;
    this.write();
  }

  /** Shows what the reel's screen shows (`img`, its picture), if it has one yet: for a viewer that comes onto the page mid-play. */
  show(img: HTMLImageElement | null): void {
    const src = img?.getAttribute("src");
    if (this.parts && src) this.parts.cur.src = src;
  }

  /** At once to `at` (a new picture's head), stopping anything under way. */
  park(at: number): void {
    this.hold();
    this.at = clamp(at);
    this.write();
    this.onRest?.(this.at);
  }

  /**
   * Rides the light across as a reel unreels, on the reel's own `timing` (the same clock, so they
   * move as one): the window waits where it is until the light reaches its middle, then keeps it
   * there, the film running past as through a gate, until it meets the film's end. The keyframes
   * are placed in the light's own progress, so under the light's easing they track it exactly.
   */
  ride(timing: KeyframeAnimationOptions): Animation[] {
    this.hold();
    this.taken = false;
    if (!this.film) return [];
    const from = this.at;
    const points = [
      [0, from],
      [from + SPAN / 2, from],
      [1 - SPAN / 2, END],
      [1, END],
    ] as const;
    const anims = [this.film.animate(points.map(([offset, at]) => ({ offset, transform: filmAt(at) })), timing)];
    if (this.finder) anims.push(this.finder.animate(points.map(([offset, at]) => ({ offset, transform: finderAt(at) })), timing));
    return anims;
  }

  /** The new reel is in: from the end of the ride back to its head, unless the player took the viewer meanwhile. */
  rewind(): void {
    if (!this.film) return;
    this.hold();
    if (!this.taken) this.glide(0, REWIND_MS, DOWN);
  }

  readonly onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keys: Record<string, number> = { ArrowLeft: this.at - STEP, ArrowRight: this.at + STEP, Home: 0, End: END };
    const to = keys[event.key];
    if (to === undefined) return;
    // The viewer's own: they don't also step through the reels (the theater listens on the window).
    event.preventDefault();
    event.stopPropagation();
    this.taken = true;
    this.glide(to, STEP_MS, SETTLE);
  };

  private handlers(kind: "viewer" | "reel") {
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => this.down(event, kind),
      onPointerMove: (event: PointerEvent<HTMLElement>) => this.move(event),
      onPointerUp: (event: PointerEvent<HTMLElement>) => this.up(event),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => this.up(event),
      // A mouse would otherwise pick up the picture itself (a native drag), which ends the pointer's.
      onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
    };
  }

  private down(event: PointerEvent<HTMLElement>, kind: "viewer" | "reel"): void {
    if (!event.isPrimary || event.button !== 0 || !this.film) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    this.hold();
    this.taken = true;
    if (kind === "reel") {
      // Pressed outside the viewfinder: it comes to the finger first, centred on it.
      const x = (event.clientX - box.left) / box.width;
      if (x < this.at || x > this.at + SPAN) {
        this.at = clamp(x - SPAN / 2);
        this.write();
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // On the viewer a finger's pixel is a third as much of the run (its film is three screens
    // wide), and the film goes the finger's way, so the window goes the other.
    const rate = kind === "viewer" ? -1 / (box.width * 3) : 1 / box.width;
    this.drag = { id: event.pointerId, x: event.clientX, from: this.at, rate };
  }

  private move(event: PointerEvent<HTMLElement>): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    this.at = clamp(drag.from + (event.clientX - drag.x) * drag.rate);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.write();
    });
  }

  private up(event: PointerEvent<HTMLElement>): void {
    if (this.drag?.id !== event.pointerId) return;
    this.drag = null;
    this.write();
    this.onRest?.(this.at);
  }

  /** Stops anything moving the viewer, leaving it where it is on screen. */
  private hold(): void {
    const film = this.film;
    if (!film) return;
    const moving = [...film.getAnimations(), ...(this.finder?.getAnimations() ?? [])];
    if (moving.length === 0) return;
    const shift = new DOMMatrixReadOnly(getComputedStyle(film).transform).m41;
    moving.forEach((anim) => anim.cancel());
    if (film.offsetWidth) this.at = clamp(-shift / film.offsetWidth);
    this.write();
  }

  /** From where it is on screen to `to`, over `ms` (at once with reduced motion). */
  private glide(to: number, ms: number, easing: string): void {
    this.hold();
    const from = this.at;
    this.at = clamp(to);
    this.write();
    this.onRest?.(this.at);
    if (!this.film || reducedMotion() || Math.abs(this.at - from) < 1e-4) return;
    const timing = { duration: ms, easing };
    this.film.animate([{ transform: filmAt(from) }, { transform: filmAt(this.at) }], timing);
    this.finder?.animate([{ transform: finderAt(from) }, { transform: finderAt(this.at) }], timing);
  }

  private write(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.film?.style.setProperty("transform", filmAt(this.at));
    this.finder?.style.setProperty("transform", finderAt(this.at));
    // Where the window is, for what's registered to it (the win's title card, see `TitleCard`).
    this.slider?.style.setProperty("--at", this.at.toFixed(4));
  }
}

/** The viewer's place on the film, in words, for screen readers. */
function placeText(percent: number): string {
  if (percent <= 0) return "The head of the reel";
  if (percent >= 100) return "The tail of the reel";
  return `${percent}% of the way along the reel`;
}

/**
 * The viewer (phones only): under the reel, the same reel three times larger, a third of its run
 * at a time, on its own film with thin rails, as if under the editing bench's lens. The film slides
 * through it (see `Lens`); the reel above marks the third in view (`Viewfinder`). The reel plays
 * every move on its screen in step with its own (see `Reel`), so its pictures are drawn here but
 * never set from here. `overlay` sits over the window, still while the film moves (the win's
 * title, which the viewer holds on a phone); `aura` is light thrown behind it.
 */
export function Viewer(props: { lens: Lens; picture: boolean; waiting: boolean; leader?: ReactNode; overlay?: ReactNode; aura?: ReactNode }) {
  const { lens, picture, waiting, leader, overlay, aura } = props;
  const slider = useRef<HTMLDivElement>(null);
  const film = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLImageElement>(null);
  const wipe = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLImageElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const flare = useRef<HTMLDivElement>(null);
  // Where it rests, in percent of the way along (the slider's value); in between it moves without React.
  const [rest, setRest] = useState(50);

  useLayoutEffect(() => {
    lens.attach({
      slider: slider.current!,
      film: film.current!,
      gate: { screen: screen.current!, cur: cur.current!, wipe: wipe.current!, next: next.current!, bar: bar.current!, flare: flare.current! },
      onRest: (at) => setRest(Math.round((at / END) * 100)),
    });
    return () => lens.attach(null);
  }, [lens]);

  return (
    <div className={styles.lensBox}>
      {aura}
      <div
        ref={slider}
        className={styles.lens}
        role="slider"
        tabIndex={0}
        aria-label="Today's reel, magnified; drag or use arrow keys to move along it"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rest}
        aria-valuetext={placeText(rest)}
        onKeyDown={lens.onKeyDown}
        {...lens.viewerHandlers}
      >
        <div ref={film} className={styles.lensFilm}>
          <div className={styles.lensRail} />
          <div ref={screen} className={`${styles.screen} ${styles.lensScreen}`} data-waiting={waiting || undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin asset drawn and animated by hand */}
            <img ref={cur} className={styles.frame} alt="" hidden={!picture} />
            {!picture && leader}
            <div ref={wipe} className={styles.wipe} aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img ref={next} className={styles.frame} alt="" />
            </div>
            <div ref={flare} className={styles.flare} aria-hidden />
            <div ref={bar} className={styles.lightbarTrack} aria-hidden>
              <div className={styles.lightbar} />
            </div>
          </div>
          <div className={styles.lensRail} />
        </div>
        {overlay && <div className={`${styles.screen} ${styles.lensGate}`}>{overlay}</div>}
      </div>
    </div>
  );
}

/** On the reel, the third that's in the viewer: four corner marks, no box. */
export function Viewfinder({ lens }: { lens: Lens }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    lens.attachFinder(el.current);
    return () => lens.attachFinder(null);
  }, [lens]);
  return <div ref={el} className={styles.viewfinder} aria-hidden />;
}
