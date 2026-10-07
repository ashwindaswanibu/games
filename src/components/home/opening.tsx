"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { cueAt } from "@/core/daylight";
import type { HomeCue, HomeView } from "@/core/home-view";
import { Barrel, CutLetters, Globe, Spiral } from "./bucket-art";
import type { HomeComposition } from "./composition";
import { DialMarks, DialPaper } from "./dial";
import { watchFrames } from "./frames";
import { readClock } from "./game-clock";
import { BEAT, EASE, EASE_CUT, EASE_IO, EASE_PUNCH, S16, S32, steps, Timeline } from "./timeline";
import styles from "./moments.module.css";

/** The day winds from midnight to now in twelve stop-motion frames. */
const FRAMES = 12;
/** The disc punches in: its paper, ring, ticks, hand and pin all on this frame. */
const DISC_IN = 60;
const SWEEP_FROM = BEAT; // 500
const SWEEP_TO = BEAT * 3; // 1500
const NOW_AT = 1500;
const WORDS_AT = 1750;
const MOVIES_AT = 2000;
const GEO_AT = 2250;
const CHESS_AT = 2500;
const HOME_AT = 2750;
const END = 4000;

const NIGHT_INK = "oklch(0.935 0.015 81)";
const DAY_INK = "oklch(0.21 0.01 67)";

/** "8:40 AM" in New York. */
function wallClock(now: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(now));
}

/**
 * M1 · The opening titles (spec §8.2), 4.0 s, once a day per device and on Replay. One disc is the
 * thread: the day winds on it from midnight to now while the room cuts through every light it
 * passes; it is the O of WORDS, the Binder barrel, the globe, the Vertigo spiral; then the home is
 * pasted up around it and it travels home to the dial, the last disc. Any input skips to the end.
 */
export function Opening({
  view,
  comp,
  now,
  freezeAt,
  frames,
  onEnd,
}: {
  view: HomeView;
  comp: HomeComposition;
  now: number;
  freezeAt: number | null;
  frames: boolean;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => {
    onEndRef.current = onEnd;
  });

  const plan = useMemo(() => {
    const reading = readClock(view.clock, now);
    const start = Date.parse(view.clock.dayStartsAt);
    const length = Date.parse(view.clock.rollsOverAt) - start;
    const sweep = Array.from({ length: FRAMES + 1 }, (_, k) => (reading.gone * k) / FRAMES);
    // The room's light on each frame of the wind: night at midnight, then whatever the day passes.
    const cues: HomeCue[] = sweep.map((g, k) => (k === 0 ? "night" : cueAt(start + g * length, view.clock)));
    return { gone: reading.gone, sweep, cues, stamp: wallClock(now) };
  }, [view.clock, now]);

  const word = comp.wordsCard;
  const o = word.letters.find((l) => l.char === "O") ?? word.letters[0];
  const vb = word.viewBox.split(" ").map(Number);
  const wordVars = {
    "--vb-x": vb[0],
    "--vb-y": vb[1],
    "--vb-w": vb[2],
    "--vb-h": vb[3],
    "--o-x": o.cx,
    "--o-y": o.cy,
    "--o-left": o.cx - vb[0],
    "--o-right": vb[0] + vb[2] - o.cx,
  } as CSSProperties;

  useLayoutEffect(() => {
    const overlay = ref.current;
    const home = overlay?.closest<HTMLElement>("[data-home]");
    if (!overlay || !home) return;
    window.scrollTo(0, 0);
    const T = new Timeline();
    const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = home) => root.querySelector<E>(sel);
    const qa = <E extends Element = HTMLElement>(sel: string, root: ParentNode = home) => [...root.querySelectorAll<E>(sel)];

    // ---- The room: night, then a hard cut on the frame where the day passes each light ----------
    // Each frame's cut lands half a millisecond early, so a frozen frame on a boundary is never blank.
    const frameAt = (k: number) => SWEEP_FROM + (k * (SWEEP_TO - SWEEP_FROM)) / FRAMES - (k > 0 ? 0.5 : 0);
    for (const layer of qa("[data-room] [data-c]")) {
      const c = layer.dataset.c as HomeCue;
      const keys: [number, Keyframe][] = [[0, { opacity: plan.cues[0] === c ? 1 : 0, easing: steps(1) }]];
      for (let k = 1; k <= FRAMES; k++) keys.push([frameAt(k), { opacity: plan.cues[k] === c ? 1 : 0, easing: steps(1) }]);
      keys.push([END, { opacity: plan.cues[FRAMES] === c ? 1 : 0 }]);
      T.key(layer, keys);
    }
    T.show(q("[data-room-light]"), HOME_AT);

    // ---- S0 · the slate: the disc punches in; the cast is billed ---------------------------------
    const disc = q("[data-op-disc]", overlay);
    const discInk = (k: number) => (plan.cues[k] === "night" ? NIGHT_INK : DAY_INK);
    const HOME_LEAVE = HOME_AT + 4 * S16; // 3250
    const HOME_LAND = HOME_LEAVE + 300;
    if (disc) {
      T.visible(disc, [
        [DISC_IN, WORDS_AT],
        [HOME_AT, HOME_LAND],
      ]);
      // Ring and ticks follow the room they sit in.
      const inkKeys: [number, Keyframe][] = [[0, { color: discInk(0), easing: steps(1) }]];
      for (let k = 1; k <= FRAMES; k++) inkKeys.push([frameAt(k), { color: discInk(k), easing: steps(1) }]);
      inkKeys.push([END, { color: discInk(FRAMES) }]);
      T.key(disc, inkKeys);
    }
    T.visible(q("[data-op-cast]", overlay), [[BEAT / 2, BEAT]]);

    // ---- S1 · the day runs: the paper is cut away frame by frame, the hand steps with it ---------
    // (A child's own visibility outlives its parent's, so the last frame carries the disc's windows.)
    qa("[data-op-frame]", overlay).forEach((g, k) => {
      T.visible(
        g,
        k < FRAMES
          ? [[k === 0 ? DISC_IN : frameAt(k), frameAt(k + 1)]]
          : [
              [frameAt(k), WORDS_AT],
              [HOME_AT, HOME_LAND],
            ],
      );
    });
    T.key(
      q("[data-op-hand]", overlay),
      [
        [SWEEP_FROM, { transform: "rotate(0deg)", easing: steps(FRAMES) }],
        [SWEEP_TO, { transform: `rotate(${(plan.gone * 360).toFixed(2)}deg)` }],
      ],
    );
    T.visible(q("[data-op-stamp]", overlay), [[NOW_AT, WORDS_AT]]);

    // ---- S2 · Words: the disc is the O; the camera pulls back as the letters are pasted ----------
    const words = q("[data-card='words']", overlay);
    T.visible(words, [[WORDS_AT, MOVIES_AT]]);
    const wordSvg = q("svg", words ?? overlay);
    const oGlyph = words?.querySelector(`[data-letter="${word.letters.indexOf(o)}"]`);
    if (disc && wordSvg && oGlyph) {
      const d = disc.getBoundingClientRect();
      const g = oGlyph.getBoundingClientRect();
      const k = g.height > 0 ? d.height / g.height : 1;
      T.key(wordSvg, [
        [WORDS_AT, { transform: `scale(${k.toFixed(3)})`, easing: EASE_CUT }],
        [MOVIES_AT - 10, { transform: "scale(1)" }],
      ]);
    }
    qa("[data-letter]", words ?? overlay).forEach((letter) => {
      const i = Number(letter.getAttribute("data-letter"));
      if (letter === oGlyph) return;
      const order = word.letters.filter((l) => l !== o).indexOf(word.letters[i]);
      const at = WORDS_AT + Math.max(0, order) * S32;
      T.visible(letter, [[at, MOVIES_AT]]);
      T.key(letter.firstElementChild, [
        [at, { transform: "scale(1.08)", easing: steps(2) }],
        [at + 120, { transform: "scale(1)" }],
      ]);
    });

    // ---- S3 · Movies: the O is the gun barrel; the title lands on the off-beat --------------------
    const movies = q("[data-card='movies']", overlay);
    T.visible(movies, [[MOVIES_AT, GEO_AT]]);
    const moviesTitle = q("[data-op-title]", movies ?? overlay);
    T.visible(moviesTitle, [[MOVIES_AT + S32, GEO_AT]]);
    T.key(moviesTitle, [
      [MOVIES_AT + S32, { transform: "translateY(6%)", easing: EASE }],
      [MOVIES_AT + S32 + 200, { transform: "translateY(0)" }],
    ]);

    // ---- S4 · Geography: the barrel is a globe at the vanishing point; the lines rush out --------
    const geo = q("[data-card='geography']", overlay);
    T.visible(geo, [[GEO_AT, CHESS_AT]]);
    T.key(q("[data-op-rays]", geo ?? overlay), [
      [GEO_AT, { transform: "scale(.2)", easing: EASE_CUT }],
      [GEO_AT + 180, { transform: "scale(1)" }],
    ]);
    qa("[data-op-geo-letter]", geo ?? overlay).forEach((letter, i) => {
      T.visible(letter, [[GEO_AT + Math.min(3, Math.floor(i / 2)) * S32, CHESS_AT]]);
    });

    // ---- S5 · Chess: the globe is the Vertigo spiral, turning; CHESS slides in ------------------
    const chess = q("[data-card='chess']", overlay);
    T.visible(chess, [[CHESS_AT, HOME_AT]]);
    T.key(q("[data-op-spiral]", chess ?? overlay), [
      [CHESS_AT, { transform: "rotate(0deg)" }],
      [HOME_AT, { transform: "rotate(90deg)" }],
    ]);
    T.key(q("[data-op-title]", chess ?? overlay), [
      [CHESS_AT, { transform: "translateX(-4%)", easing: EASE_CUT }],
      [CHESS_AT + 220, { transform: "translateX(0)" }],
    ]);

    // ---- S6 · the home, pasted up in place --------------------------------------------------------
    const stage = q("[data-stage]");
    T.reveal(stage, HOME_AT);
    const strip = q("[data-op='hero-strip']");
    T.reveal(strip, HOME_AT);
    T.key(strip, [
      [HOME_AT, { transform: "translateY(-30%)", easing: EASE_CUT }],
      [HOME_AT + 200, { transform: "translateY(0)" }],
    ]);
    T.reveal(q("[data-op='weekday']"), HOME_AT);
    qa("[data-op='month-letter']").forEach((letter, i) => {
      const at = HOME_AT + i * S32;
      T.reveal(letter, at);
      T.key(letter, [
        [at, { transform: "scale(1.12)", easing: steps(2) }],
        [at + 140, { transform: "scale(1)" }],
      ]);
    });
    const numeral = q("[data-op='numeral']");
    T.reveal(numeral, HOME_AT + S16);
    T.key(numeral, [
      [HOME_AT + S16, { transform: "scale(1.22)", easing: EASE_PUNCH }],
      [HOME_AT + S16 + 140, { transform: "scale(1)" }],
    ]);
    T.reveal(q("[data-op='numeral-plate']"), HOME_AT + S16 + S32);
    // Sheets laid top to bottom, a 16th apart.
    qa("[data-op='credits'] > *").forEach((sheet, i) => {
      const at = HOME_AT + 2 * S16 + i * S16;
      T.reveal(sheet, at);
      T.key(sheet, [
        [at, { transform: "translateY(28px)", easing: EASE_CUT }],
        [at + 380, { transform: "translateY(0)" }],
      ]);
    });
    // The disc travels home: the dial in the title is the last disc to land.
    const dial = q("[data-stage] [data-dial]");
    if (disc && dial) {
      const a = disc.getBoundingClientRect();
      const b = dial.getBoundingClientRect();
      const k = b.width / Math.max(1, a.width);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      T.key(disc, [
        [0, { transform: "translate(0px, 0px) scale(0.9)", easing: steps(1) }],
        [DISC_IN, { transform: "translate(0px, 0px) scale(0.9)", easing: EASE_PUNCH }],
        [170, { transform: "translate(0px, 0px) scale(1)" }],
        [HOME_LEAVE, { transform: "translate(0px, 0px) scale(1)", easing: EASE_IO }],
        [HOME_LAND, { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(4)})` }],
      ]);
      T.reveal(dial, HOME_LAND);
    }
    const band = q("[data-op='band']");
    T.key(band, [
      [HOME_AT + BEAT + BEAT / 2, { transform: `rotate(${comp.band.rotate}) scaleX(0)`, easing: EASE_CUT }],
      [HOME_AT + BEAT + BEAT / 2 + 260, { transform: `rotate(${comp.band.rotate}) scaleX(1)` }],
    ]);
    // The countdown cuts in on 16ths: its label, then hours, minutes, seconds.
    const COUNT_AT = 3625;
    T.reveal(q("[data-op='count-label']"), COUNT_AT);
    const digits = qa("[data-digit]");
    const colons = qa("[data-op='count'] > :not([data-digit])");
    digits.forEach((d, i) => T.reveal(d, COUNT_AT + Math.floor(i / 2) * S16));
    colons.forEach((c, i) => T.reveal(c, COUNT_AT + (i + 1) * S16));
    T.reveal(q("[data-op='count-city']"), COUNT_AT + 2 * S16);
    // The chrome, the presence line and the billing come up last.
    for (const el of [q("[data-op='strip']"), q("[data-op='presence']"), q("[data-op='billing']"), q("[data-app-chrome]")]) {
      T.key(el, [
        [END - 250, { opacity: 0, easing: EASE }],
        [END, { opacity: 1 }],
      ]);
    }
    T.extendTo(END);

    // ---- Run ---------------------------------------------------------------------------------------
    const layers = [disc, words, movies, geo, chess, stage, strip, numeral, band].filter(Boolean) as HTMLElement[];
    if (freezeAt !== null) {
      T.seek(freezeAt);
      return () => T.cancel();
    }
    for (const el of layers) el.style.willChange = "transform";
    const stopFrames = frames ? watchFrames("opening") : null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      T.seek(END);
      stopFrames?.();
      for (const el of layers) el.style.willChange = "";
      T.cancel();
      onEndRef.current();
    };
    // A tap or click skips, and only skips: the page under the opening is inert while it plays,
    // and the click that follows the press is swallowed, since by then the page is live again (it
    // must not press Replay, or follow a link, under the finger).
    let swallowing = false;
    let swallowEnd: ReturnType<typeof setTimeout> | undefined;
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stopSwallowing();
    };
    const stopSwallowing = () => {
      clearTimeout(swallowEnd);
      window.removeEventListener("click", swallow, { capture: true });
    };
    const skip = (e: Event) => {
      if (!done && !swallowing && e.type !== "wheel") {
        swallowing = true;
        window.addEventListener("click", swallow, { capture: true });
        swallowEnd = setTimeout(stopSwallowing, 600);
      }
      finish();
    };
    // A key skips; Space or Enter must not also press whatever has focus (the Replay button).
    const skipKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") e.preventDefault();
      finish();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("keydown", skipKey, { capture: true });
    window.addEventListener("pointerdown", skip, opts);
    window.addEventListener("wheel", skip, opts);
    window.addEventListener("touchstart", skip, opts);
    void T.play().then(finish);
    return () => {
      window.removeEventListener("keydown", skipKey, { capture: true });
      window.removeEventListener("pointerdown", skip, opts);
      window.removeEventListener("wheel", skip, opts);
      window.removeEventListener("touchstart", skip, opts);
      // The swallow outlives the overlay (the click comes after it has gone); it ends on its own.
      for (const el of layers) el.style.willChange = "";
      stopFrames?.(false);
      T.cancel();
    };
    // Built once per run (the parent keys each run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bucketName = (id: string) => view.buckets.find((b) => b.id === id)?.name ?? id;
  const geoLetters = [...bucketName("geography")];
  const castLine = view.cast.join(" · ");

  return (
    <div ref={ref} className={styles.opening} aria-hidden="true" style={wordVars}>
      <div className={`${styles.card} ${styles.cardWords}`} data-card="words">
        <CutLetters word={word} className={styles.cardWord} />
      </div>
      <div className={`${styles.card} ${styles.cardMovies}`} data-card="movies">
        <Barrel className={styles.discBox} />
        <span className={styles.moviesTitle} data-op-title="">
          {bucketName("movies")}
        </span>
      </div>
      <div className={`${styles.card} ${styles.cardGeo}`} data-card="geography">
        <svg className={styles.rays} viewBox="0 0 1000 1000" preserveAspectRatio="none" data-op-rays="">
          <path d={raysPath()} fill="none" stroke="var(--sheet-cream)" strokeWidth="1" opacity="0.45" vectorEffect="non-scaling-stroke" />
        </svg>
        <Globe className={styles.discBox} />
        <span className={styles.geoTitle}>
          {geoLetters.map((ch, i) => (
            <span key={i} data-op-geo-letter="">
              {ch}
            </span>
          ))}
        </span>
      </div>
      <div className={`${styles.card} ${styles.cardChess}`} data-card="chess">
        <span className={styles.spiralBox} data-op-spiral="">
          <Spiral className={styles.spiral} />
        </span>
        <span className={styles.chessTitle} data-op-title="">
          {bucketName("chess")}
        </span>
      </div>
      {castLine && (
        <div className={styles.cast} data-op-cast="">
          <span className={styles.castNames}>{castLine}</span>
          <i className={styles.present}>present</i>
        </div>
      )}
      <div className={`${styles.discBox} ${styles.disc}`} data-op-disc="">
        <svg viewBox="-50 -50 100 100" className={styles.discSvg}>
          {plan.sweep.map((g, k) => (
            <g key={k} data-op-frame="" className={styles.frame}>
              <DialPaper gone={g} rimSeed={comp.dialSeed} />
            </g>
          ))}
          <DialMarks ink="currentColor" />
          <line x1="0" y1="2" x2="0" y2="-54" stroke="var(--glint)" strokeWidth="2.4" data-op-hand="" style={{ transform: `rotate(${(plan.gone * 360).toFixed(2)}deg)` }} />
          <circle r="3.4" fill="var(--sheet-ink)" />
        </svg>
      </div>
      <div className={styles.stamp} data-op-stamp="">
        <b>{plan.stamp}</b>
        <span>New York</span>
      </div>
    </div>
  );
}

/** North by Northwest for the Geography card: lines from the vanishing point (the globe) to the edges, and rules tightening toward it. */
let rays: string | null = null;
function raysPath(): string {
  if (rays) return rays;
  const vx = 500;
  const vy = 440;
  let d = "";
  for (let i = -16; i <= 16; i++) {
    const x = 500 + i * 90;
    d += `M${vx} ${vy}L${x} 1000`;
  }
  for (let i = -6; i <= 6; i++) {
    d += `M${vx} ${vy}L${i < 0 ? 0 : 1000} ${vy + Math.abs(i) * 90}`;
  }
  for (let i = 1; i <= 9; i++) {
    const y = vy + (1000 - vy) * (i / 9) ** 1.8;
    d += `M0 ${y.toFixed(1)}L1000 ${y.toFixed(1)}`;
  }
  rays = d;
  return d;
}
