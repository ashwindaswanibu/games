"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { BucketId } from "@/core/game";
import type { HomeGame } from "@/core/home-view";
import { labelText, resultSentence } from "./credit";
import { watchFrames } from "./frames";
import { Mark } from "./mark";
import { buildMark } from "./mark-geometry";
import { BUCKET_TIER } from "./palette";
import { EASE, EASE_CUT, steps, Timeline } from "./timeline";
import styles from "./moments.module.css";
import paper from "./paper.module.css";

const LAY = 220;
const FLY = 340;
const FLY_EASE = "cubic-bezier(.65,0,.2,1)";
const PHONE = "(max-width: 760px)";

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

/**
 * M2 · The set-in (spec §8.3), about 1.6 s, once per finished game: the bucket's sheet becomes the
 * result's title card for a beat. A fresh cut of the bucket's paper is laid over its sheet; the
 * game's name, its empty form, then the pieces, printed or cut, one by one; the label cut big in
 * the day's hand and the result in words. Then the card is pulled away and the mark and the label
 * travel down into the credit, the band's chip fills and the count steps. Not skippable; a click
 * lands it at once.
 */
export function SetIn({
  game,
  bucket,
  date,
  cut,
  freezeAt,
  frames,
  onEnd,
}: {
  game: HomeGame;
  bucket: BucketId;
  date: string;
  cut: string;
  freezeAt: number | null;
  frames: boolean;
  onEnd: (sentence: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => {
    onEndRef.current = onEnd;
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
    let stopFrames: ((keep?: boolean) => void) | null = null;
    let done = false;
    const finish = () => {
      if (done || !T) return;
      done = true;
      T.seek(T.duration);
      stopFrames?.();
      card.style.willChange = "";
      onEndRef.current(sentence);
    };

    const build = () => {
      // The card's footprint: the column's width, at least the sheet and a little more, top-aligned
      // to the sheet and shifted up if it would pass the column's foot.
      const phone = window.matchMedia(PHONE).matches;
      const vh = window.innerHeight;
      const height = Math.max(sheet.offsetHeight + (phone ? 0 : 12), (phone ? 0.52 : 0.46) * vh);
      let top = sheet.offsetTop - 6;
      if (top + height > col.offsetHeight) top = Math.max(-6, col.offsetHeight - height);
      card.style.top = `${top}px`;
      card.style.height = `${height}px`;
      card.style.setProperty("--label-size", `min(clamp(84px, 20vh, 200px), ${(0.42 * height).toFixed(0)}px)`);

      const q = (sel: string) => card.querySelector<HTMLElement>(sel);
      const paperEls = [q("[data-si-paper]"), q("[data-si-plate]")];
      const name = q("[data-si-name]");
      const markWrap = q("[data-si-mark]");
      const cardSvg = markWrap?.querySelector("svg") ?? null;
      const label = q("[data-si-label]");
      const aside = q("[data-si-aside]");
      const creditSvg = credit.querySelector("[data-op='mark'] svg");
      const creditLabel = credit.querySelector<HTMLElement>("[data-op='label'] > :first-child");

      const pieces = [...card.querySelectorAll<SVGGElement>("[data-piece]")];
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
      t.visible(card.querySelector("[data-keyline]"), [[250, Math.min(swap, b.land)]]);
      card.querySelectorAll("[data-unused], [data-join]").forEach((el) => t.visible(el, [[swap, b.land]]));
      // The label, cut big; the result in words.
      t.visible(label, [[b.label, b.land]]);
      t.key(label, [
        [b.label, { transform: "scale(1.1)", easing: steps(2) }],
        [b.label + 150, { transform: "scale(1)" }],
      ]);
      t.visible(aside, [[b.label + 120, Infinity]]);

      // The card is pulled away; the mark and the label travel into the credit.
      for (const el of paperEls)
        t.key(el, [
          [b.hold, { transform: "translateY(0%)", easing: EASE_CUT }],
          [b.land, { transform: "translateY(105%)" }],
        ]);
      for (const el of [name, aside])
        t.key(el, [
          [b.hold, { opacity: 1 }],
          [b.hold + 140, { opacity: 0 }],
        ]);
      const fly = (from: Element | null, to: Element | null) => {
        if (!from || !to) return;
        const a = from.getBoundingClientRect();
        const c = to.getBoundingClientRect();
        const k = c.height / Math.max(1, a.height);
        (from as HTMLElement).style.transformOrigin = "0 0";
        t.key(from, [
          [b.hold, { transform: "translate(0px, 0px) scale(1)", easing: FLY_EASE }],
          [b.land, { transform: `translate(${(c.left - a.left).toFixed(1)}px, ${(c.top - a.top).toFixed(1)}px) scale(${k.toFixed(4)})` }],
        ]);
      };
      fly(markWrap, creditSvg);
      fly(label, creditLabel);

      // Hard swap: the credit's own mark and label take over.
      credit.querySelectorAll("[data-op='mark'] [data-result], [data-op='label']").forEach((el) => t.show(el, b.land));
      t.visible(credit.querySelector("[data-op='mark'] [data-keyline]"), [[0, b.land]]);
      // Final beat: the chip fills, the count steps; the result line and "How everyone did" rise.
      const chip = home.querySelector(`[data-chip="${game.id}"] > b`);
      t.show(chip, b.land + 20);
      t.key(chip, [
        [b.land + 20, { transform: "scaleY(0)", easing: steps(3) }],
        [b.end, { transform: "scaleY(1)" }],
      ]);
      home.querySelectorAll("[data-band-n] [data-n-now]").forEach((el) => t.show(el, b.end));
      home.querySelectorAll("[data-band-n] [data-n-before]").forEach((el) => t.visible(el, [[0, b.end]]));
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

    // A click lands it at once.
    const land = () => finish();
    window.addEventListener("pointerdown", land, { capture: true, passive: true });

    // On a phone, wait until the credit is in view (≥ 60%), then play.
    let io: IntersectionObserver | null = null;
    if (window.matchMedia(PHONE).matches && freezeAt === null) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.intersectionRatio >= 0.6)) {
            io?.disconnect();
            io = null;
            build();
          }
        },
        { threshold: [0.6] },
      );
      io.observe(credit);
    } else build();

    return () => {
      io?.disconnect();
      window.removeEventListener("pointerdown", land, { capture: true });
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
  return (
    <div ref={ref} className={`${styles.setIn} ${paper[bucket]}`} data-tier={tier} style={{ "--cut": cut } as CSSProperties} aria-hidden="true">
      <span className={styles.cardPlate} data-si-plate="" />
      <span className={styles.cardPaper} data-si-paper="" />
      <div className={styles.cardBody}>
        <span className={styles.cardName} data-si-name="">
          {game.name}
        </span>
        <span className={styles.cardMark} data-si-mark="">
          <Mark model={model} style={{ "--mark-u": `min(clamp(40px, 8vh, 84px), calc(86cqi / ${model.w.toFixed(3)}))` } as CSSProperties} />
        </span>
        <span className={styles.cardResult}>
          <span className={styles.bigLabel} data-si-label="" style={{ "--label-em": labelEm(text) } as CSSProperties}>
            <span className={styles.bigLabelPlate}>{text}</span>
            {text}
          </span>
          <span className={styles.aside} data-si-aside="">
            {result.line && <span className={styles.asideLine}>{result.line}</span>}
            <span className={styles.asidePts}>{result.score} pts</span>
          </span>
        </span>
      </div>
    </div>
  );
}

