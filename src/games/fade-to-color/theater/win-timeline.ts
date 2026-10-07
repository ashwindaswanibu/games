"use client";

import { useEffect, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { LEVEL_COUNT } from "../logic";
import { swallowClickOf } from "./click-guard";
import styles from "./theater.module.css";
import { DOWN, exitBeats, HOLD_MS, LETTER_MS, openingBeats, PRINT_RUN_STEP_MS, RISE, SETTLE, UNREEL_EASE, UNREEL_MS } from "./timing";

/*
 * The win: "Title Matte". You name the film and the film says its name back.
 *
 * Every part of it is a Web Animation (opacity and transform only) on one shared clock, built once
 * up front, so a tap can finish all of it at once; the few changes React has to make (the console
 * swapping to the end card, the reel taking its last picture) are cues on the same clock. The
 * beats, in ms from the server's answer (named on reel 3; spec: recommendation §2):
 *
 *   0–680       Heard: the actions step back, your words take the film's light, a line of it runs under them.
 *   600–1500    House down: the room, the header, the strip and the guess line go; "Color" stays lit.
 *   700–2100    Fade to black, except the name: the title, cut out of the picture, is all that's left.
 *   2100–2800   MAIN TITLE prints on the rail.  2100–2400: the beat, nothing moves.
 *   2400–≤3900  Color: the letters fade from picture to the film's colours, left to right.
 *   3000–4200   Heartbeat: one swell of light as the name completes, settling into a halo.
 *   –4400       Hold.
 *   4400–5650   The film rolls on: the last reel unreels over the card; the prints you didn't need develop.
 *   4900        The room takes the last reel's light; the reel glides into the end layout.
 *   5000–6300   The end card rises. Interactive at 5.0s.
 *
 * Named on the last reel, the card lifts off the picture instead (no print run). If the last reel's
 * picture isn't in by the hold, the card holds for it a while, then lifts off the picture on screen.
 * With reduced motion: no card at all; the last reel fades up, then the end card, as one block.
 */

/** How long the card waits (after the hold) for the last reel's picture before lifting off the one on screen. */
export const LAST_REEL_WAIT_MS = 2500;

export type WinStage = "heard" | "rolling" | "lit" | "credits" | "done";

/** A typed win being played, from the server's answer to the end card at rest. */
export interface WinCelebration {
  /** The reel the film was named on (1–10). */
  reel: number;
  /** The reel on screen when it was named (0-based), and its picture: what the title is cut from. */
  shown: number;
  picture: string;
  title: string;
  /**
   * `heard` until the film rolls on; `rolling` as the last reel unreels; `lit` from the moment the
   * room takes its light (the console is the end card's, still inert); `credits` once the end card
   * takes clicks; `done` at rest.
   */
  stage: WinStage;
  /** How the card leaves: unreeled over by the last reel (`roll`), or lifted off the picture on screen (`lift`). */
  exit: "roll" | "lift" | null;
  /** The card has done its work; the screen can show the reel itself again. */
  cardGone: boolean;
  reduced: boolean;
}

type Point = readonly [at: number, value: string | number, easing?: string];

const clock = () => (document.timeline.currentTime as number | null) ?? performance.now();

/**
 * Animations on one clock: every one starts at the same zero, so they stay in step whatever the
 * main thread does, and cues (timed changes only script can make) ride the same clock, as
 * zero-length animations whose finish runs them. Cues always run in order.
 */
export class Timeline {
  private readonly zero = clock();
  private readonly anims: Animation[] = [];
  private readonly markers: Animation[] = [];
  private readonly cues: { at: number; run: () => void; done: boolean }[] = [];

  constructor(private readonly marker: Element) {}

  /** ms since zero. */
  get now(): number {
    return clock() - this.zero;
  }

  /** Animates one property of `el` through `points` ([ms, value, easing to the next]); holds the ends. */
  track(el: Element | null | undefined, prop: "opacity" | "transform", points: readonly Point[], fill: FillMode = "both"): void {
    if (!el || points.length === 0) return;
    let last = -Infinity;
    const times = points.map(([t]) => (last = Math.max(t, last + 1)));
    const from = times[0]!;
    const span = Math.max(1, times.at(-1)! - from);
    const frames: Keyframe[] = points.map(([, value, easing], i) => ({ offset: (times[i]! - from) / span, [prop]: value, easing: easing ?? "linear" }));
    // One point: that value, held.
    if (frames.length === 1) frames.push({ ...frames[0], offset: 1 });
    const anim = el.animate(frames, { duration: span, delay: from, fill });
    anim.startTime = this.zero;
    this.anims.push(anim);
  }

  cue(at: number, run: () => void): void {
    const entry = { at, run, done: false };
    this.cues.push(entry);
    const anim = this.marker.animate(null, { duration: 0, delay: Math.max(0, at) });
    anim.startTime = this.zero;
    anim.onfinish = () => this.runUpTo(entry.at);
    this.markers.push(anim);
  }

  private runUpTo(at: number): void {
    for (;;) {
      const next = this.pending()[0];
      if (!next || next.at > at) return;
      next.done = true;
      next.run();
    }
  }

  private pending() {
    return this.cues.filter((c) => !c.done).sort((a, b) => a.at - b.at);
  }

  /** Runs every cue still to come, in order, including any they add. */
  flush(): void {
    this.runUpTo(Infinity);
  }

  /** Stops everything (each property falls back to its stylesheet value); `keep` spares some targets. */
  cancel(keep: (target: Element) => boolean = () => false): void {
    for (const anim of this.anims) {
      const target = (anim.effect as KeyframeEffect | null)?.target;
      if (!target || !keep(target)) anim.cancel();
    }
    this.markers.forEach((m) => m.cancel());
  }
}

/**
 * Plays the win (`win`, set by the theater on a live in_progress → won) over the theater's own
 * elements, found under `root` by class and `data-win`. Moves `win` through its stages with
 * `setWin`, synchronously, so each change is on the page before the animations that need it.
 * `ready` is true once the last reel's picture is decoded and its art is in. `instant` is set while
 * a skip runs, for the layout to snap rather than glide.
 *
 * Until the end card takes clicks, a tap or a key press finishes it: everything jumps to the end
 * card, and that first event goes no further (so it can't also press what's under it).
 */
export function useWinTimeline(props: {
  win: WinCelebration | null;
  setWin: Dispatch<SetStateAction<WinCelebration | null>>;
  root: RefObject<HTMLElement | null>;
  ready: boolean;
  /** Today's barcode as light, graded (a data URL): the title's colours, for its light. */
  fill: string | null;
  /** The last reel's accent ("r g b"), for the light that sweeps it in. */
  lastAccent: string | null;
  instant: RefObject<boolean>;
}): void {
  const { win, setWin, root, ready, instant } = props;
  const started = win !== null;
  const live = useRef({ ready, fill: props.fill, lastAccent: props.lastAccent, onReady: () => {} });
  useLayoutEffect(() => {
    live.current.ready = ready;
    live.current.fill = props.fill;
    live.current.lastAccent = props.lastAccent;
  });
  useLayoutEffect(() => {
    // The win as it began (its reel, picture and title don't change while it plays).
    const at = win;
    const el = root.current;
    if (!started || !at || !el) return;
    const tl = new Timeline(el);
    const q = (selector: string) => el.querySelector<HTMLElement>(selector);
    const part = (name: string) => q(`[data-win="${name}"]`);
    const cls = (name: string) => q(`.${name}`);
    const set = (patch: Partial<WinCelebration>) => flushSync(() => setWin((w) => (w ? { ...w, ...patch } : w)));
    const lastReel = at.shown === LEVEL_COUNT - 1;

    let exited = false;
    let finished = false;
    let waiting = false;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;

    // The room and the header, as the house goes down and comes back up.
    const house = [cls(styles.back), cls(styles.dateline), cls(styles.wmFade), q('[data-edge="start"]'), q('[data-edge="end"]'), cls(styles.contact), cls(styles.status)];
    const room: [HTMLElement | null, number, number][] = [
      // element, its light at rest, its light with the house down
      [cls(styles.washLight), 0.15, 0.02],
      [cls(styles.beam), 1, 0.08],
      [cls(styles.spillLight), 0.3, 0],
      [cls(styles.glow), 1, 0],
      [cls(styles.reflection), 0.28, 0],
    ];

    function hold() {
      if (lastReel) return startExit("lift");
      if (live.current.ready) return startExit("roll");
      waiting = true;
      waitTimer = setTimeout(() => startExit("lift"), LAST_REEL_WAIT_MS);
    }
    // The last reel came in while the card was holding for it.
    live.current.onReady = () => {
      if (waiting) queueMicrotask(() => startExit("roll"));
    };

    if (at.reduced) {
      // No heard beat, no card: the guess line holds still while the last reel fades up, then the
      // end card takes its place.
      tl.cue(0, hold);
    } else {
      const beats = openingBeats([...at.title].filter((ch) => ch.trim()).length);
      const units = layoutCard(el);

      // 0 · Heard. The actions and the film's byline step back; your words take the film's light and
      //     a line of it runs along under them, left to right: a tiny unreel that says "yes".
      tl.track(part("heard-actions"), "opacity", [[0, 1, "ease-out"], [260, 0]]);
      tl.track(part("heard-byline"), "opacity", [[0, 1, "ease-out"], [260, 0]]);
      tl.track(part("heard-ink"), "opacity", [[0, 1, RISE], [420, 0]]);
      tl.track(part("heard-lit"), "opacity", [[0, 0, RISE], [520, 1]]);
      tl.track(part("heard-line"), "transform", [[60, "scaleX(0)", UNREEL_EASE], [680, "scaleX(1)"]]);

      // 1 · The house goes down: the guess line drops away, the header, edge print, strip and status
      //     go almost to black, and the room's light leaves with them. The wordmark's "Color" stays lit.
      tl.track(part("heard"), "opacity", [[beats.house, 1, DOWN], [1200, 0]]);
      tl.track(part("heard"), "transform", [[beats.house, "translate3d(0,0,0)", DOWN], [1200, "translate3d(0,6px,0)"]]);
      for (const item of house) tl.track(item, "opacity", [[beats.house, 1, DOWN], [1400, 0.06]]);
      for (const [item, rest, down] of room) tl.track(item, "opacity", [[beats.house, rest, DOWN], [1500, down]]);

      // 2 · Fade to black, except the name. The black comes down over the picture; the title, cut out
      //     of that same picture above it, is what's left. Then the rail prints its name for it.
      tl.track(part("dip"), "opacity", [[beats.dip, 0, DOWN], [beats.black, 1]]);
      tl.track(q('[data-edge="title"]'), "opacity", [[beats.black, 0, "ease"], [beats.black + 700, 1]]);

      // 3 · A beat on the bare cut-out, then Color: each letter fades from picture to the film's
      //     colours, left to right, and the title's own light rises with it.
      let lit = beats.color;
      for (const unit of units) {
        const start = beats.color + Number(unit.dataset.at) * beats.step;
        lit = Math.max(lit, start + LETTER_MS);
        tl.track(unit, "opacity", [[start, 0.002, RISE], [start + LETTER_MS, 1]]);
      }
      tl.track(part("matte"), "opacity", [[lit - 1, 1], [lit, 0]]);
      tl.track(part("aura-spill"), "opacity", [[beats.color, 0, RISE], [lit + 300, 0.12]]);
      tl.track(part("aura-glow"), "opacity", [[beats.color, 0, RISE], [lit + 300, 1]]);

      // 4 · Heartbeat: one swell of light as the name completes, settling into a close halo.
      tl.track(part("bloom"), "opacity", [[lit - 900, 0.002, "ease-in"], [lit - 200, 0.2, "ease-out"], [lit + 300, 0]]);
      tl.track(part("bloom"), "transform", [[lit - 900, "scale(1.03)", SETTLE], [lit + 300, "scale(1)"]]);
      tl.track(part("halo"), "opacity", [[lit - 600, 0.002, RISE], [lit + 400, 0.3]]);
      void drawTitleLight(el, live.current.fill);

      // 5 · Hold, then the film rolls on.
      tl.cue(lit + HOLD_MS, hold);
    }

    function startExit(kind: "roll" | "lift") {
      if (exited || !at) return;
      exited = true;
      waiting = false;
      clearTimeout(waitTimer);
      set({ exit: kind });
      const E = Math.max(0, tl.now);
      const x = exitBeats(kind, at.reduced);
      const L = E + x.light;
      const card = cls(styles.titleCard);
      if (live.current.lastAccent) card?.style.setProperty("--incoming", live.current.lastAccent);

      if (at.reduced) {
        if (kind === "roll") tl.track(part("wipe"), "opacity", [[E, 0, "ease"], [E + x.light, 1]]);
      } else if (kind === "roll") {
        // The last reel unreels over the card, the reel's own sweep of light leading it.
        tl.track(part("wipe"), "transform", [[E, "translate3d(-100%,0,0)", UNREEL_EASE], [E + UNREEL_MS, "translate3d(0,0,0)"]]);
        tl.track(part("next"), "transform", [[E, "translate3d(100%,0,0)", UNREEL_EASE], [E + UNREEL_MS, "translate3d(0,0,0)"]]);
        tl.track(part("bar"), "transform", [[E, "translate3d(0,0,0)", UNREEL_EASE], [E + UNREEL_MS, "translate3d(100%,0,0)"]]);
        tl.track(part("bar"), "opacity", [[E - 1, 0], [E, 1], [E + UNREEL_MS - 1, 1], [E + UNREEL_MS, 0]]);
        tl.track(part("flare"), "opacity", [[E, 0, "ease-out"], [E + 280, 1, "ease-out"], [E + 560, 0]]);
        tl.track(cls(styles.contact), "opacity", [[E, 0.06, "ease"], [E + UNREEL_MS, 1]]);
        // The reels you didn't need develop in order, under a playhead that lands on the last.
        tl.cue(E, () => {
          set({ stage: "rolling" });
          runPlayhead(E);
        });
      } else {
        // Already on the last reel (or it never came): the title goes and the black lifts off the picture.
        tl.track(part("card"), "opacity", [[E, 1, DOWN], [E + 600, 0]]);
        tl.track(part("dip"), "opacity", [[E + 200, 1, RISE], [E + 1200, 0]]);
        tl.track(cls(styles.contact), "opacity", [[E, 0.06, "ease"], [E + 1000, 1]]);
      }

      tl.cue(L, () => relight(E, L, x));
      // Once the end card takes clicks, a tap is the player's again (no longer a skip).
      tl.cue(E + x.interactive, () => {
        set({ stage: "credits" });
        detach();
      });
      tl.cue(E + x.cardGone, () => set({ cardGone: true }));
      tl.cue(E + x.done, finish);
    }

    // The room takes the last reel's light and the house comes back up; the console, invisible,
    // swaps to the end card (inert) and the reel glides into the end layout.
    function relight(E: number, L: number, x: ReturnType<typeof exitBeats>) {
      set({ stage: "lit" });
      if (at!.reduced) {
        const credits = cls(styles.creditsWrap);
        tl.track(credits, "opacity", [[E + x.creditsFrom, 0.002, "ease"], [E + x.creditsTo, 1]]);
        tl.track(credits, "transform", [[E + x.creditsFrom, "none"]]);
        return;
      }
      for (const item of [cls(styles.back), cls(styles.dateline), cls(styles.wmFade), q('[data-edge="start"]')]) tl.track(item, "opacity", [[L, 0.06, "ease"], [L + 1000, 1]]);
      // The reel's own label takes the rail back from "Main title": one out, then the other in.
      tl.track(q('[data-edge="title"]'), "opacity", [[L, 1, DOWN], [L + 300, 0]]);
      tl.track(q('[data-edge="end"]'), "opacity", [[L + 250, 0.06, RISE], [L + 700, 1]]);
      tl.track(q('[data-edge="bottom"]'), "opacity", [[L + 300, 0, "ease"], [L + 1300, 1]]);
      for (const [item, rest, down] of room) tl.track(item, "opacity", [[L, down, "ease"], [L + 1400, rest]]);
      tl.track(part("aura-spill"), "opacity", [[L, 0.12, "ease"], [L + 1100, 0]]);
      tl.track(part("aura-glow"), "opacity", [[L, 1, "ease"], [L + 1100, 0]]);
      const credits = cls(styles.creditsWrap);
      tl.track(credits, "opacity", [[E + x.creditsFrom, 0.002, "ease"], [E + x.creditsTo, 1]]);
      tl.track(credits, "transform", [[E + x.creditsFrom, "translate3d(0,10px,0)", SETTLE], [E + x.creditsTo, "translate3d(0,0,0)"]]);
    }

    // The playhead: the on-screen print's ring, jumping print to print to the last.
    function runPlayhead(E: number) {
      const strip = cls(styles.contact);
      const head = part("playhead");
      if (!strip || !head || !at) return;
      const prints = [...strip.querySelectorAll<HTMLElement>(`.${styles.printImage}`)];
      const first = prints[at.shown];
      if (!first) return;
      const box = strip.getBoundingClientRect();
      const r0 = first.getBoundingClientRect();
      Object.assign(head.style, { left: `${r0.left - box.left}px`, top: `${r0.top - box.top}px`, width: `${r0.width}px`, height: `${r0.height}px` });
      const points: Point[] = prints.slice(at.shown).map((print, k) => [E + k * PRINT_RUN_STEP_MS, `translate3d(${print.getBoundingClientRect().left - r0.left}px,0,0)`, "steps(1, end)"]);
      tl.track(head, "transform", points);
    }

    function finish() {
      if (finished) return;
      finished = true;
      // Back to the stylesheet everywhere (every last value is its resting one), except on the card,
      // which holds its last frame until the reel beneath it has its picture.
      tl.cancel((target) => target.closest(`.${styles.titleCard}`) !== null);
      set({ stage: "done" });
      detach();
    }

    // A tap or a key: straight to the end card.
    function skip(event: Event) {
      if (finished) return;
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey || ["Shift", "Meta", "Control", "Alt"].includes(event.key))) return;
      event.preventDefault();
      event.stopPropagation();
      // A key press makes no click (its default is prevented); a tap or a press of the main button does.
      if (event instanceof PointerEvent && event.button === 0) swallowClickOf(event);
      instant.current = true;
      try {
        if (!exited) startExit(lastReel || !live.current.ready ? "lift" : "roll");
        tl.flush();
        for (const anim of el!.getAnimations({ subtree: true })) {
          if (anim.effect?.getComputedTiming().endTime !== Infinity) anim.finish();
        }
      } finally {
        instant.current = false;
      }
    }

    window.addEventListener("pointerdown", skip, { capture: true });
    window.addEventListener("keydown", skip, { capture: true });
    const shared = live.current;
    function detach() {
      window.removeEventListener("pointerdown", skip, { capture: true });
      window.removeEventListener("keydown", skip, { capture: true });
    }

    return () => {
      detach();
      clearTimeout(waitTimer);
      shared.onReady = () => {};
      if (!finished) tl.cancel();
    };
    // Once per win: everything it needs is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  useEffect(() => {
    if (ready) live.current.onReady();
  }, [ready]);
}

/**
 * Sizes the title card from the screen's width, stepping down until the title fits in two-thirds of
 * the screen's height; then gives each lit unit its slice of the one barcode spread across the
 * whole title. The size is kept in the screen's own units (`cqw`) and every slice in `em`, so when
 * the reel takes the end layout mid-roll (one relayout, then a glide) the card keeps its proportions
 * on the screen. Returns the units.
 */
function layoutCard(root: HTMLElement): HTMLElement[] {
  const card = root.querySelector<HTMLElement>(`.${styles.card}`);
  const lit = root.querySelector<HTMLElement>('[data-win="lit"]');
  const screen = card?.closest<HTMLElement>(`.${styles.screen}`);
  if (!card || !lit || !screen) return [];
  const { clientWidth: sw, clientHeight: sh } = screen;
  // On a phone the card is the only thing lit in a short screen: the title takes a little more of it.
  let size = sw * (sw < 640 ? 0.1 : 0.078);
  for (;;) {
    card.style.setProperty("--card-fs", `${((size / sw) * 100).toFixed(3)}cqw`);
    if (lit.offsetHeight <= sh * 0.66 || size < 14) break;
    size *= 0.92;
  }
  const units = [...lit.querySelectorAll<HTMLElement>("[data-at]")];
  const box = lit.getBoundingClientRect();
  const em = (px: number) => `${(px / size).toFixed(4)}em`;
  for (const unit of units) {
    const r = unit.getBoundingClientRect();
    unit.style.backgroundSize = `${em(box.width)} ${em(box.height)}`;
    unit.style.backgroundPosition = `${em(box.left - r.left)} ${em(box.top - r.top)}`;
  }
  return units;
}

/**
 * The title as light, drawn once into two tiny canvases in the barcode's colours and scaled up by
 * the compositor (the upscale does most of the softening; no live blur): `bloom`, wide and soft,
 * the one swell as the colour arrives; `halo`, close and faint, the glow the title keeps.
 */
async function drawTitleLight(root: HTMLElement, fill: string | null): Promise<void> {
  const lit = root.querySelector<HTMLElement>('[data-win="lit"]');
  const bloom = root.querySelector<HTMLCanvasElement>('[data-win="bloom"]');
  const halo = root.querySelector<HTMLCanvasElement>('[data-win="halo"]');
  if (!fill || !lit || !bloom || !halo) return;
  const bands = new Image();
  bands.src = fill;
  try {
    await bands.decode();
  } catch {
    return;
  }
  if (!lit.isConnected) return;
  drawLight(lit, bands, bloom, { scale: 12, spread: 1.4, sigma: 2.2, passes: 3 });
  drawLight(lit, bands, halo, { scale: 6, spread: 0.7, sigma: 1.6, passes: 2 });
}

function drawLight(lit: HTMLElement, bands: HTMLImageElement, target: HTMLCanvasElement, opts: { scale: number; spread: number; sigma: number; passes: number }) {
  const { scale: S, spread, sigma, passes } = opts;
  const style = getComputedStyle(lit);
  const size = parseFloat(style.fontSize);
  const box = lit.getBoundingClientRect();
  const pad = size * spread;
  const w = Math.ceil((box.width + pad * 2) / S);
  const h = Math.ceil((box.height + pad * 2) / S);
  target.width = w;
  target.height = h;
  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${size / S}px ${style.fontFamily}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  const ascent = ctx.measureText("D").fontBoundingBoxAscent;
  for (const unit of lit.querySelectorAll<HTMLElement>("[data-at]")) {
    const r = unit.getBoundingClientRect();
    ctx.fillText(unit.textContent ?? "", (r.left - box.left + pad) / S, (r.top - box.top + pad) / S + ascent);
  }
  ctx.globalCompositeOperation = "source-in";
  ctx.drawImage(bands, pad / S, 0, box.width / S, h);
  ctx.globalCompositeOperation = "source-over";
  const image = ctx.getImageData(0, 0, w, h);
  blur(image.data, w, h, sigma, passes);
  ctx.putImageData(image, 0, 0);
  // In ems of the title's size (see `layoutCard`), centred on the title by margins (its transform is animated).
  const em = (px: number) => `${(px / size).toFixed(4)}em`;
  target.style.width = em(w * S);
  target.style.height = em(h * S);
  const card = lit.parentElement!.getBoundingClientRect();
  target.style.marginLeft = em(box.left + box.width / 2 - (card.left + card.width / 2) - (w * S) / 2);
  target.style.marginTop = em(box.top + box.height / 2 - (card.top + card.height / 2) - (h * S) / 2);
}

/**
 * A soft blur of a small RGBA image, in place: three box blurs (close to a gaussian of `sigma`),
 * on premultiplied colour so the edges don't darken, then the light stacked `passes` times over
 * itself (as drawing it again would). Done by hand, so it looks the same in every browser.
 */
function blur(data: Uint8ClampedArray, w: number, h: number, sigma: number, passes: number) {
  const r = Math.max(1, Math.round((-1 + Math.sqrt(1 + 4 * sigma * sigma)) / 2));
  const n = w * h;
  const px = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3]! / 255;
    px[i * 4] = data[i * 4]! * a;
    px[i * 4 + 1] = data[i * 4 + 1]! * a;
    px[i * 4 + 2] = data[i * 4 + 2]! * a;
    px[i * 4 + 3] = a;
  }
  const tmp = new Float32Array(n * 4);
  const pass = (src: Float32Array, dst: Float32Array, len: number, lines: number, stride: number, step: number) => {
    const span = 2 * r + 1;
    for (let line = 0; line < lines; line++) {
      const base = line * stride;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) if (k >= 0 && k < len) sum += src[(base + k * step) * 4 + c]!;
        for (let i = 0; i < len; i++) {
          dst[(base + i * step) * 4 + c] = sum / span;
          const out = i - r;
          const into = i + r + 1;
          if (out >= 0) sum -= src[(base + out * step) * 4 + c]!;
          if (into < len) sum += src[(base + into * step) * 4 + c]!;
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(px, tmp, w, h, w, 1);
    pass(tmp, px, h, w, 1, w);
  }
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3]!;
    const alpha = 1 - (1 - Math.min(1, a)) ** passes;
    data[i * 4] = a > 0 ? px[i * 4]! / a : 0;
    data[i * 4 + 1] = a > 0 ? px[i * 4 + 1]! / a : 0;
    data[i * 4 + 2] = a > 0 ? px[i * 4 + 2]! / a : 0;
    data[i * 4 + 3] = alpha * 255;
  }
}
