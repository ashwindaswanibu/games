"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { BucketId } from "@/core/game";
import type { HomeGame } from "@/core/home-view";
import { labelText, resultSentence } from "./credit";
import { watchFrames } from "./frames";
import { Mark } from "./mark";
import { buildMark } from "./mark-geometry";
import { BUCKET_TIER } from "./palette";
import { cubicBezier, EASE, EASE_CUT, steps, Timeline } from "./timeline";
import { LG_ASCENT, LG_DESCENT } from "./type-metrics";
import styles from "./moments.module.css";
import paper from "./paper.module.css";

const LAY = 220;
const FLY = 340;
const FLY_CURVE = [0.65, 0, 0.2, 1] as const;
const FLY_EASE = `cubic-bezier(${FLY_CURVE.join(",")})`;
const flyEase = cubicBezier(...FLY_CURVE);
/**
 * The paper starts down this long after the copies start to travel, on the copies' own ease, so it
 * never uncovers the sheet faster than they shrink away from it.
 */
const PULL_DELAY = 70;
const PHONE = "(max-width: 760px)";
/** On a phone the card waits until this much of its credit is in view, clear of the tab bar. */
const IN_VIEW = 0.95;

/** A label's width in League Gothic ems, near enough to fit it: figures and capitals ~.36em, spaces ~.2em. */
function labelEm(text: string): number {
  let em = 0;
  for (const ch of text) em += ch === " " ? 0.2 : ch === "·" ? 0.25 : 0.37;
  return Math.max(1, em);
}

/** The set-in's beats (spec §8.3) for a mark of `pieces` pieces. */
export function setInBeats(pieces: number) {
  const s = Math.min(72, 360 / Math.max(1, pieces));
  const last = 300 + Math.max(0, pieces - 1) * s;
  const label = Math.max(640, last + 190);
  const hold = Math.max(1000, label + 360);
  return { s, last, label, hold, land: hold + FLY, end: hold + 600 };
}

/** League Gothic set on one line: its baseline, half the leading below the box's top plus the ascent. */
function baselineOf(box: DOMRect, fontPx: number): number {
  return box.top + (box.height - (LG_ASCENT + LG_DESCENT) * fontPx) / 2 + LG_ASCENT * fontPx;
}

interface Flight {
  el: HTMLElement;
  /** The transform at landing. */
  to: string;
  /** How far through its travel (0–1) the copy's foot has risen above `y` (1 if it never does). */
  clears: (y: number) => number;
}

/**
 * One copy's travel (FLIP): the transform that moves `el`, about its own transform-origin, so that
 * `from` (itself, or the drawing inside it) lands on `to`. A mark lands box on box, scaled by height.
 * A label lands letters on letters: scaled by font size, left edges and baselines matched (the card
 * and the credit set their labels at different line heights, so their boxes differ, their letters
 * must not). Measured on untransformed layout.
 */
function flightTo(el: HTMLElement | null, from: Element | null, to: Element | null, match: "box" | "letters"): Flight | null {
  if (!el || !from || !to) return null;
  const e = el.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const c = to.getBoundingClientRect();
  const [ox, oy] = getComputedStyle(el).transformOrigin.split(" ").map(parseFloat);
  const origin = { x: e.left + (ox || 0), y: e.top + (oy || 0) };
  let k: number;
  let start: { x: number; y: number };
  let end: { x: number; y: number };
  if (match === "box") {
    k = c.height / Math.max(1, a.height);
    start = { x: a.left, y: a.top };
    end = { x: c.left, y: c.top };
  } else {
    const fa = parseFloat(getComputedStyle(from).fontSize);
    const fc = parseFloat(getComputedStyle(to).fontSize);
    k = fc / Math.max(1, fa);
    start = { x: a.left, y: baselineOf(a, fa) };
    end = { x: c.left, y: baselineOf(c, fc) };
  }
  const tx = end.x - origin.x - k * (start.x - origin.x);
  const ty = end.y - origin.y - k * (start.y - origin.y);
  // Translate and scale interpolate on their own, so the foot moves linearly with the progress p.
  const foot = (p: number) => origin.y + p * ty + (1 + p * (k - 1)) * (e.bottom - origin.y);
  const clears = (y: number) => {
    if (foot(0) <= y) return 0;
    if (foot(1) > y) return 1;
    return (foot(0) - y) / (foot(0) - foot(1));
  };
  return { el, to: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(4)})`, clears };
}

/** The set-in's final beat on the band: the game's chip fills (`steps(3)`, 240 ms) and the count steps as it completes. */
function bandBeat(t: Timeline, home: HTMLElement, gameId: string, at: number): void {
  const chip = home.querySelector(`[data-chip="${gameId}"] > b`);
  t.show(chip, at);
  t.key(chip, [
    [at, { transform: "scaleY(0)", easing: steps(3) }],
    [at + 240, { transform: "scaleY(1)" }],
  ]);
  home.querySelectorAll("[data-band-n] [data-n-now]").forEach((el) => t.show(el, at + 240));
  home.querySelectorAll("[data-band-n] [data-n-before]").forEach((el) => t.visible(el, [[0, at + 240]]));
  t.extendTo(at + 240);
}

/**
 * M2 · The set-in (spec §8.3), about 1.6 s, once per finished game: the bucket's sheet becomes the
 * result's title card for a beat. A fresh cut of the bucket's paper is laid over its sheet; the
 * game's name, its empty form, then the pieces, printed or cut, one by one; the label cut big in
 * the day's hand and the result in words. Then the card is pulled away (its name and aside go with
 * it, and a card taller than its sheet is first cut back to the sheet) while the mark and the label
 * travel into the credit, the band's chip fills and the count steps. Not skippable; a click lands
 * it at once (and a click on the card does nothing else).
 *
 * The card is two layers laid out alike: the paper (plate, paper, name, aside), which is pulled
 * away and cut back, and the flight (mark, label), which is never cut. Each holds the other's parts
 * as hidden spacers, so both lay out exactly the same.
 */
export function SetIn({
  game,
  bucket,
  date,
  cut,
  freezeAt,
  frames,
  onEnd,
  onBandSettled,
}: {
  game: HomeGame;
  bucket: BucketId;
  date: string;
  cut: string;
  freezeAt: number | null;
  frames: boolean;
  onEnd: (sentence: string) => void;
  /** The band took its final beat early (the credit is out of view on a phone): it may show the day as it is. */
  onBandSettled: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  const onBandSettledRef = useRef(onBandSettled);
  useLayoutEffect(() => {
    onEndRef.current = onEnd;
    onBandSettledRef.current = onBandSettled;
  });
  const result = game.result;
  // The same seed as the credit's own mark, so the copy lands exactly on it.
  const model = useMemo(() => buildMark(game.form, game.state, result?.marks ?? null, `${date}:${game.id}`), [game.form, game.state, result, date, game.id]);
  const sentence = resultSentence(game);

  useLayoutEffect(() => {
    const card = ref.current;
    const col = card?.parentElement;
    const home = card?.closest<HTMLElement>("[data-home]");
    const credit = home?.querySelector<HTMLElement>(`[data-credit="${game.id}"]`);
    const sheet = credit?.closest<HTMLElement>("[data-sheet]");
    if (!card || !col || !home || !credit || !sheet) {
      onEndRef.current(sentence);
      return;
    }

    let T: Timeline | null = null;
    /** The band's beat, played on its own when the card has to wait for its credit (phone). */
    let early: Timeline | null = null;
    let stopFrames: ((keep?: boolean) => void) | null = null;
    let done = false;
    const finish = () => {
      if (done || !T) return;
      done = true;
      window.removeEventListener("click", land, { capture: true });
      T.seek(T.duration);
      stopFrames?.();
      card.style.willChange = "";
      onEndRef.current(sentence);
    };

    // A click lands it at once. A click on the card is taken whole (it must not open the game hidden
    // under it); one elsewhere lands it and then does its own job. A click, not a press: a touch
    // that scrolls the page never ends in one.
    const land = (e: MouseEvent) => {
      if (done || !T) return;
      const r = card.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        e.preventDefault();
        e.stopPropagation();
      }
      finish();
    };
    window.addEventListener("click", land, { capture: true });

    const build = (bandDone: boolean) => {
      // The card's footprint: the column's width, at least the sheet and a little more, top-aligned
      // to the sheet and shifted up if it would pass the column's foot.
      const phone = window.matchMedia(PHONE).matches;
      const vh = window.innerHeight;
      let height = Math.max(sheet.offsetHeight + (phone ? 0 : 12), (phone ? 0.52 : 0.46) * vh);
      let top = sheet.offsetTop - 6;
      if (top + height > col.offsetHeight) top = Math.max(-6, col.offsetHeight - height);
      if (phone) {
        // A phone plays the card where it is seen: between the top of the screen and the tab bar,
        // shifted up over the band if it must (it is pulled away before the band's beat), and still
        // holding the credit, where the mark and the label land.
        const colTop = col.getBoundingClientRect().top;
        const bar = home.querySelector<HTMLElement>('[data-app-chrome="bottom-nav"]');
        const ceil = 6;
        const floor = (bar?.getBoundingClientRect().top ?? vh) - 6;
        height = Math.min(height, floor - ceil);
        let view = Math.min(Math.max(colTop + top, ceil), floor - height);
        const creditFoot = credit.getBoundingClientRect().bottom;
        if (view + height < creditFoot) view = Math.min(floor - height, creditFoot - height);
        top = view - colTop;
      }
      card.style.top = `${top}px`;
      card.style.height = `${height}px`;
      card.style.setProperty("--label-size", `min(clamp(84px, 20vh, 200px), ${(0.42 * height).toFixed(0)}px)`);

      const sheetLayer = card.querySelector<HTMLElement>("[data-si-layer='paper']");
      const flight = card.querySelector<HTMLElement>("[data-si-layer='flight']");
      if (!sheetLayer || !flight) {
        onEndRef.current(sentence);
        return;
      }
      const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel);
      const paperEls = [q(sheetLayer, "[data-si-paper]"), q(sheetLayer, "[data-si-plate]")];
      const name = q(sheetLayer, "[data-si-name]");
      const aside = q(sheetLayer, "[data-si-aside]");
      const markWrap = q(flight, "[data-si-mark]");
      const cardSvg = markWrap?.querySelector("svg") ?? null;
      const label = q(flight, "[data-si-label]");
      const creditSvg = credit.querySelector("[data-op='mark'] svg");
      const creditLabel = credit.querySelector<HTMLElement>("[data-op='label'] > :first-child");

      const pieces = [...flight.querySelectorAll<SVGGElement>("[data-piece]")];
      const b = setInBeats(pieces.length);
      const t = new Timeline();
      T = t;

      // The card is laid.
      t.show(card, 0);
      t.key(card, [
        [0, { transform: "translateX(-3%)", easing: EASE_CUT }],
        [LAY, { transform: "translateX(0)" }],
      ]);
      t.visible(name, [[200, Infinity]]);
      t.visible(markWrap, [[250, b.land]]);
      // The pieces: what you spent is printed, what you earned is cut.
      const unit = (cardSvg?.getBoundingClientRect().height ?? 40) / model.h;
      pieces.forEach((p, i) => {
        const at = 300 + i * b.s;
        const earned = p.dataset.kind === "earned";
        // (Each piece's own window ends with the card's: a child's visibility outlives its parent's.)
        t.visible(p, [[at, b.land]]);
        t.key(
          p,
          earned
            ? [
                [at, { transform: "scale(1.45) rotate(-8deg)", easing: steps(2) }],
                [at + 150, { transform: "scale(1) rotate(0deg)" }],
              ]
            : [
                [at, { transform: `translateY(${(-0.22 * unit).toFixed(1)}px)`, easing: EASE }],
                [at + 140, { transform: "translateY(0px)" }],
              ],
        );
      });
      // Slots never needed: their keylines hard-swap to hairlines.
      const swap = b.last + 150;
      t.visible(flight.querySelector("[data-keyline]"), [[250, Math.min(swap, b.land)]]);
      flight.querySelectorAll("[data-unused], [data-join]").forEach((el) => t.visible(el, [[swap, b.land]]));
      // The label, cut big; the result in words.
      t.visible(label, [[b.label, b.land]]);
      t.key(label, [
        [b.label, { transform: "scale(1.1)", easing: steps(2) }],
        [b.label + 150, { transform: "scale(1)" }],
      ]);
      t.visible(aside, [[b.label + 120, Infinity]]);

      // The card is pulled down and away, its name and aside with it (they fade as it goes). A card
      // taller than its own sheet is cut back to the sheet first, so it never wipes across the next.
      const pull = Math.round(1.05 * (paperEls[0]?.offsetHeight ?? height));
      for (const el of [...paperEls, name, aside])
        t.key(el, [
          [b.hold + PULL_DELAY, { transform: "translateY(0px)", easing: FLY_EASE }],
          [b.land, { transform: `translateY(${pull}px)` }],
        ]);
      for (const el of [name, aside])
        t.key(el, [
          [b.hold, { opacity: 1 }],
          [b.hold + 140, { opacity: 0 }],
        ]);

      // Measured as things stand at H (the lay and the label's beat are over by then): the mark and
      // the label travel into the credit, landing exactly where the credit's own take over.
      t.seek(b.hold);
      const flights = [flightTo(markWrap, cardSvg, creditSvg, "box"), flightTo(label, label, creditLabel, "letters")].filter((f) => f !== null);
      // A card that hangs past its sheet (and the sheet's plate) loses that part in one cut: once the
      // copies have risen out of it and as the paper's edge reaches it, so the copies are never
      // printed on the next sheet and the paper never wipes across it.
      const line = sheet.getBoundingClientRect().bottom + 9;
      const overhang = Math.floor(card.getBoundingClientRect().bottom - line);
      const pullFrom = b.hold + PULL_DELAY;
      const edgeAt = pullFrom + flyEase.when((line - (paperEls[0]?.getBoundingClientRect().top ?? line)) / pull) * (b.land - pullFrom);
      const clearAt = Math.max(b.hold, ...flights.map((f) => b.hold + flyEase.when(f.clears(line)) * FLY));
      const cutAt = Math.round(Math.min(b.land, Math.max(edgeAt, clearAt)));
      t.seek(0);
      for (const f of flights) {
        // Forwards only: before H the copy keeps its own beats (the label's scale 1.1 → 1).
        t.add(f.el, [{ transform: "translate(0px, 0px) scale(1)" }, { transform: f.to }], { at: b.hold, duration: FLY, easing: FLY_EASE, fill: "forwards" });
      }
      if (overhang > 0)
        t.key(sheetLayer, [
          [0, { clipPath: "inset(0px 0px 0px 0px)", easing: steps(1) }],
          [cutAt, { clipPath: `inset(0px 0px ${overhang}px 0px)` }],
        ]);

      // Hard swap: the credit's own mark and label take over.
      credit.querySelectorAll("[data-op='mark'] [data-result], [data-op='label']").forEach((el) => t.show(el, b.land));
      t.visible(credit.querySelector("[data-op='mark'] [data-keyline]"), [[0, b.land]]);
      // Final beat: the chip fills, the count steps; the result line and "How everyone did" rise.
      if (!bandDone) bandBeat(t, home, game.id, b.land + 20);
      [credit.querySelector("[data-op='line']"), credit.querySelector("[data-op='how']")].forEach((el, i) => {
        if (!el) return;
        const at = b.land + 20 + i * 60;
        t.show(el, at);
        t.key(el, [
          [at, { opacity: 0, transform: "translateY(6px)", easing: EASE }],
          [at + 240, { opacity: 1, transform: "translateY(0px)" }],
        ]);
      });
      t.extendTo(b.end);

      if (freezeAt !== null) {
        t.seek(freezeAt);
        return;
      }
      card.style.willChange = "transform";
      stopFrames = frames ? watchFrames("set-in") : null;
      void t.play().then(finish);
    };

    // On a phone, wait until the credit is in view, all of it and clear of the tab bar (its result
    // line and "How everyone did" sit at its foot), then play. The band at the top can't wait for a
    // credit below the fold (it would go on showing the day as it stood before): when the credit
    // starts out of view, the band takes its beat now and the card plays when it is reached.
    let io: IntersectionObserver | null = null;
    if (window.matchMedia(PHONE).matches && freezeAt === null) {
      const bar = home.querySelector<HTMLElement>('[data-app-chrome="bottom-nav"]');
      const inset = Math.ceil(bar?.getBoundingClientRect().height ?? 0);
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= IN_VIEW)) {
            io?.disconnect();
            io = null;
            build(early !== null);
          } else if (!early) {
            const beat = new Timeline();
            early = beat;
            bandBeat(beat, home, game.id, 0);
            void beat.play().then(() => onBandSettledRef.current());
          }
        },
        { threshold: [IN_VIEW], rootMargin: `0px 0px -${inset}px 0px` },
      );
      io.observe(credit);
    } else build(false);

    return () => {
      io?.disconnect();
      early?.cancel();
      window.removeEventListener("click", land, { capture: true });
      card.style.willChange = "";
      stopFrames?.(false);
      T?.cancel();
    };
    // Built once per set-in (the parent keys it by game).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return null;
  const tier = BUCKET_TIER[bucket];
  const text = labelText(result.label);
  /** The card's contents; each layer shows its own parts (`data-si-*`) and keeps the other's as hidden spacers. */
  const body = (layer: "paper" | "flight") => {
    const own = (part: "name" | "mark" | "label" | "aside") => (layer === (part === "mark" || part === "label" ? "flight" : "paper") ? { [`data-si-${part}`]: "" } : {});
    return (
      <div className={styles.cardBody}>
        <span className={styles.cardName} {...own("name")}>
          {game.name}
        </span>
        <span className={styles.cardMark} {...own("mark")}>
          <Mark model={model} style={{ "--mark-u": `min(clamp(40px, 8vh, 84px), calc(86cqi / ${model.w.toFixed(3)}))` } as CSSProperties} />
        </span>
        <span className={styles.cardResult}>
          <span className={styles.bigLabel} {...own("label")} style={{ "--label-em": labelEm(text) } as CSSProperties}>
            <span className={styles.bigLabelPlate}>{text}</span>
            {text}
          </span>
          <span className={styles.aside} {...own("aside")}>
            {result.line && <span className={styles.asideLine}>{result.line}</span>}
            <span className={styles.asidePts}>{result.score} pts</span>
          </span>
        </span>
      </div>
    );
  };
  return (
    <div ref={ref} className={`${styles.setIn} ${paper[bucket]}`} data-tier={tier} style={{ "--cut": cut } as CSSProperties} aria-hidden="true">
      <div className={styles.cardLayer} data-si-layer="paper">
        <span className={styles.cardPlate} data-si-plate="" />
        <span className={styles.cardPaper} data-si-paper="" />
        {body("paper")}
      </div>
      <div className={styles.cardLayer} data-si-layer="flight">
        {body("flight")}
      </div>
    </div>
  );
}

