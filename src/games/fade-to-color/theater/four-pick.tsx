"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FilmRef } from "@/games/_movies/schemas";
import { Letters, letterStep } from "./letters";
import styles from "./theater.module.css";

/** A pick on its way: the film chosen, and (once it has landed) whether it was the one. */
export interface PickResolve {
  filmId: number;
  /** Null until the result lands: the later of 1200ms after the press and the server's answer. */
  result: { right: boolean; answerId: number } | null;
  /** The four are fading away for the unreel to the last reel. */
  leaving: boolean;
}

/** How long the result holds before the film rolls on: after the last letter of a right pick lands, and after a wrong pick's answer is up. */
const HOLD_RIGHT_MS = 300;
const HOLD_WRONG_MS = 700;
/** The right pick's letters each take the barcode over 900ms, starting 45ms apart, the whole wave at most 600ms. */
const LIT_MS = 900;
const LIT_STEP_MS = 45;
const LIT_SPREAD_MS = 600;
/** The wrong pick dims (600ms) while the answer comes back up in ink (600ms, from 200ms). */
const WRONG_MS = 800;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The four: the answer and three look-alikes, in their stored order, and one pick worth `worth`.
 * Like a guess it's two steps (choose a tile, then Pick), so a slip doesn't spend it. A film already
 * guessed arrives dark with the reel it was guessed on, and can't be chosen. The tiles are lit only
 * by the room's light (`--accent`), never by their own film's colours: that would be a clue.
 *
 * `live` plays the stop's rise (the tiles come up left to right); a reload shows them at rest.
 * `resolve` plays the pick: the other three titles fade letter by letter while the room dips; when
 * the result lands, a right pick's title fills with the film's barcode letter by letter, and a wrong
 * one dims to black while the answer comes back up in ink. `onDone` fires when the result has been
 * held long enough to read, for the film to roll on.
 */
export function FourPick(props: {
  options: readonly FilmRef[];
  /** Films already guessed, with the reel each was guessed on. */
  guessed: ReadonlyMap<number, number>;
  worth: number;
  disabled: boolean;
  live: boolean;
  /** Today's barcode as light (a data URL): what a right pick's title fills with. */
  fill: string | null;
  resolve: PickResolve | null;
  onPick(film: FilmRef): void;
  onDone(): void;
}) {
  const { options, guessed, worth, disabled, live, fill, resolve, onPick, onDone } = props;
  const [choice, setChoice] = useState<number | null>(null);
  const tiles = useRef(new Map<number, HTMLButtonElement>());
  const locked = resolve !== null;
  const chosenId = resolve?.filmId ?? choice;
  const film = options.find((f) => f.id === chosenId) ?? null;
  const open = options.filter((f) => !guessed.has(f.id));
  const result = resolve?.result ?? null;

  // Once the result is in, hold it, then let the film roll on.
  const doneRef = useRef(onDone);
  useLayoutEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!result || !film) return;
    const reduce = reducedMotion();
    const n = [...film.title].filter((ch) => ch.trim()).length;
    const lit = (n > 1 ? Math.min(LIT_SPREAD_MS, LIT_STEP_MS * (n - 1)) : 0) + LIT_MS;
    const wait = reduce ? HOLD_WRONG_MS : result.right ? lit + HOLD_RIGHT_MS : WRONG_MS + HOLD_WRONG_MS;
    const timer = setTimeout(() => doneRef.current(), wait);
    return () => clearTimeout(timer);
    // Once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function choose(id: number, focus: boolean) {
    setChoice(id);
    if (focus) tiles.current.get(id)?.focus();
  }

  // Arrow keys move the choice through the films that can be chosen; Escape clears it.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (locked) return;
    if (event.key === "Escape") {
      if (choice === null) return;
      event.preventDefault();
      event.stopPropagation();
      setChoice(null);
      return;
    }
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || open.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const focused = Number((document.activeElement as HTMLElement | null)?.dataset.film);
    const from = choice ?? (Number.isFinite(focused) ? focused : null);
    const at = open.findIndex((f) => f.id === from);
    const next = at === -1 ? (step > 0 ? 0 : open.length - 1) : (at + step + open.length) % open.length;
    choose(open[next]!.id, true);
  }

  // One tile takes Tab: the chosen one, or the first that can be chosen.
  const tabStop = chosenId !== null && open.some((f) => f.id === chosenId) ? chosenId : (open[0]?.id ?? null);

  return (
    <div className={styles.four} data-live={live || undefined} data-resolving={locked || undefined} data-leaving={resolve?.leaving || undefined}>
      <p className={styles.kicker} id="four-label">
        One pick · {worth} pts
      </p>
      <div className={styles.fourRow}>
        <div className={styles.optionGrid} role="radiogroup" aria-labelledby="four-label" onKeyDown={onKeyDown}>
          {options.map((option, k) => {
            const reel = guessed.get(option.id);
            const isChosen = option.id === chosenId;
            const fate = !resolve
              ? undefined
              : isChosen
                ? result
                  ? result.right
                    ? "lit"
                    : "black"
                  : "held"
                : result && !result.right && option.id === result.answerId
                  ? "ink"
                  : "out";
            const n = [...option.title].filter((ch) => ch.trim()).length;
            const style = {
              "--k": k,
              // The other titles fade over 700ms in all; a right pick's letters light 45ms apart.
              "--out-step": `${letterStep(n, 1000, 400)}ms`,
              "--lit-step": `${letterStep(n, LIT_STEP_MS, LIT_SPREAD_MS)}ms`,
            } as CSSProperties;
            return (
              <button
                key={option.id}
                ref={(el) => {
                  if (el) tiles.current.set(option.id, el);
                  else tiles.current.delete(option.id);
                }}
                type="button"
                role="radio"
                aria-checked={isChosen}
                aria-label={reel !== undefined ? `${option.title}, guessed on reel ${reel}` : option.year ? `${option.title}, ${option.year}` : option.title}
                data-film={option.id}
                data-guessed={reel !== undefined || undefined}
                data-fate={fate}
                tabIndex={option.id === tabStop ? 0 : -1}
                className={styles.optionTile}
                style={style}
                disabled={reel !== undefined || (disabled && !locked)}
                aria-disabled={locked || undefined}
                onClick={() => {
                  if (!locked) choose(option.id, false);
                }}
              >
                <span className={styles.tileTitle}>
                  <Letters text={option.title} className={styles.tileInk} />
                  {fate === "lit" && <LitTitle text={option.title} fill={fill} />}
                </span>
                <span className={styles.optionTileMeta}>{reel !== undefined ? `Guessed · reel ${reel}` : (option.year ?? "")}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className={`${styles.go} ${styles.pickButton}`} disabled={disabled || locked || !film} onClick={() => film && onPick(film)}>
          Pick
        </button>
      </div>
    </div>
  );
}

/**
 * A right pick's title in the film's light: the barcode, spread across the whole title as on the
 * end card, cut into letters so it can rise one letter at a time. Laid out once, when it lands.
 */
function LitTitle({ text, fill }: { text: string; fill: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    for (const letter of root.querySelectorAll<HTMLElement>(`.${styles.litLetters} .${styles.letter}`)) {
      const r = letter.getBoundingClientRect();
      letter.style.backgroundSize = `${box.width}px ${box.height}px`;
      letter.style.backgroundPosition = `${box.left - r.left}px ${box.top - r.top}px`;
    }
  }, []);
  const style = fill ? ({ "--fill": `url(${fill})` } as CSSProperties) : undefined;
  return (
    <span ref={ref} className={styles.tileLit} style={style} aria-hidden data-fill={fill ? "" : undefined}>
      <span className={styles.tileHalo}>{text}</span>
      <Letters text={text} className={styles.litLetters} />
    </span>
  );
}
