/**
 * One seekable clock for every sequence on the home (the opening titles, the set-in, FIN): a set of
 * Web Animations created paused and driven together by seeking. A sequence can be scrubbed to any
 * millisecond, played, skipped to the end or cancelled as one thing; nothing moves outside it.
 *
 * The driver seeks on requestAnimationFrame, with a 40 ms timer as backup so a sequence never stalls
 * where frames are throttled (background tabs, power saving): the clock is wall time, not frames.
 *
 * Stop-motion moves use `steps(n, end)`; camera-like moves use the cut / in-out eases.
 */

/** Motion tokens (spec §3.4). Every sequence sits on a 120 BPM grid. */
export const BEAT = 500;
export const S16 = BEAT / 4;
export const S32 = BEAT / 8;
/** Arrivals (Fade to Color's). */
export const EASE = "cubic-bezier(.2,.8,.2,1)";
/** Sheets laid, landings. */
export const EASE_CUT = "cubic-bezier(.16,.9,.2,1)";
/** Travel: FLIP, the disc going home, the cut to the picture. */
export const EASE_IO = "cubic-bezier(.7,0,.2,1)";
/** The disc punch, the numeral slam (transform only). */
export const EASE_PUNCH = "cubic-bezier(.3,1.45,.55,1)";
export const steps = (n: number) => `steps(${n},end)`;

/** A keyframe at an absolute time on the timeline; `easing` applies from this frame to the next. */
export type TimedFrame = readonly [ms: number, frame: Keyframe];

const BACKUP_MS = 40;

export class Timeline {
  private readonly animations: Animation[] = [];
  private end = 0;
  private time = 0;
  private generation = 0;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  get duration(): number {
    return this.end;
  }

  get currentTime(): number {
    return this.time;
  }

  /** Extends the duration (a sequence can end after its last animation, e.g. on a hold frame). */
  extendTo(ms: number): void {
    this.end = Math.max(this.end, ms);
  }

  /** Adds an animation starting `at` ms in. Created paused at the current time. */
  add(el: Element | null | undefined, keyframes: Keyframe[], o: { at: number; duration: number; easing?: string; fill?: FillMode }): Animation | null {
    if (!el) return null;
    const duration = Math.max(1, o.duration);
    const animation = el.animate(keyframes, { delay: o.at, duration, easing: o.easing ?? "linear", fill: o.fill ?? "both" });
    animation.pause();
    animation.currentTime = this.time;
    this.animations.push(animation);
    this.end = Math.max(this.end, o.at + duration);
    return animation;
  }

  /**
   * Keyframes at absolute times: `[[t0, frame], [t1, frame] …]`. `easing` is the default between
   * frames; a frame's own `easing` overrides it for the segment that follows.
   */
  key(el: Element | null | undefined, frames: readonly TimedFrame[], easing = "linear"): Animation | null {
    if (!el || frames.length === 0) return null;
    const t0 = frames[0][0];
    const t1 = frames[frames.length - 1][0];
    const span = Math.max(1, t1 - t0);
    return this.add(
      el,
      frames.map(([t, frame]) => ({ easing, ...frame, offset: (t - t0) / span })),
      { at: t0, duration: span },
    );
  }

  /** A hard cut: the element is visible only in [inMs, outMs); hidden (by its own CSS) outside. */
  cut(el: Element | null | undefined, inMs: number, outMs: number): Animation | null {
    return this.add(el, [{ visibility: "visible" }, { visibility: "visible" }], { at: inMs, duration: outMs - inMs, fill: "none" });
  }

  /**
   * Hard cuts: the element is visible exactly inside each [in, out) window (out may be Infinity) and
   * hidden outside them, whatever its own CSS says. One animation per element: call it once.
   */
  visible(el: Element | null | undefined, windows: readonly (readonly [number, number])[]): Animation | null {
    const frames: [number, Keyframe][] = [[0, { visibility: "hidden", easing: steps(1) }]];
    for (const [a, b] of windows) {
      frames.push([Math.max(0, a), { visibility: "visible", easing: steps(1) }]);
      if (Number.isFinite(b)) frames.push([b, { visibility: "hidden", easing: steps(1) }]);
    }
    // Close on the last value a millisecond later, so the animation never ends on an implicit
    // (underlying) keyframe: a cut at 0 must hold, not fall back to the element's own CSS.
    const [lastAt, lastFrame] = frames[frames.length - 1];
    frames.push([lastAt + 1, { visibility: lastFrame.visibility }]);
    return this.key(el, frames);
  }

  /** A hard cut in at `ms` that holds. */
  show(el: Element | null | undefined, ms: number): Animation | null {
    return this.visible(el, [[ms, Infinity]]);
  }

  /**
   * A hard cut in at `ms`, by opacity: for the page's own content, which stays in the document's
   * text (and so readable by anything that reads it) while it waits to be pasted up.
   */
  reveal(el: Element | null | undefined, ms: number): Animation | null {
    return this.key(el, [
      [0, { opacity: 0, easing: steps(1) }],
      [Math.max(0, ms), { opacity: 1, easing: steps(1) }],
      [Math.max(0, ms) + 1, { opacity: 1 }],
    ]);
  }

  seek(ms: number): void {
    this.time = Math.max(0, Math.min(ms, this.end));
    for (const animation of this.animations) animation.currentTime = this.time;
  }

  /** Plays from `from` (default: where it is) at `rate`; resolves when it reaches the end, or never if stopped. */
  play(opts: { from?: number; rate?: number } = {}): Promise<void> {
    this.stop();
    const generation = this.generation;
    const from = opts.from ?? this.time;
    const rate = opts.rate ?? 1;
    const started = performance.now();
    return new Promise<void>((resolve) => {
      const step = () => {
        if (generation !== this.generation) return;
        cancelAnimationFrame(this.raf);
        clearTimeout(this.timer);
        const t = from + rate * (performance.now() - started);
        const done = rate > 0 ? t >= this.end : t <= 0;
        this.seek(done ? (rate > 0 ? this.end : 0) : t);
        if (done) {
          this.generation++;
          resolve();
          return;
        }
        this.raf = requestAnimationFrame(step);
        this.timer = setTimeout(step, BACKUP_MS);
      };
      this.raf = requestAnimationFrame(step);
      this.timer = setTimeout(step, BACKUP_MS);
    });
  }

  /** Freezes where it is. A pending `play()` promise never resolves. */
  stop(): void {
    this.generation++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
  }

  /** Stops and removes every animation: elements return to their own styles. */
  cancel(): void {
    this.stop();
    for (const animation of this.animations) animation.cancel();
    this.animations.length = 0;
    this.end = 0;
    this.time = 0;
  }
}
