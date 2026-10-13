"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useLetterFlip } from "./flip";
import styles from "./screen.module.css";

/**
 * The guess line, the nine letters and the keys. A guess is set from the letters themselves: tap a
 * letter (or type it) and it flies up into the line, leaving its cell empty; Backspace sends it
 * home, Escape sends them all. Enter (or Guess) plays the word, and an accepted word rises out of
 * the line toward the book as its ribbon lays in. Space (or Shuffle) reorders the row, to see new
 * words in it. Keys work anywhere on the page unless something else is being typed into or a
 * question is open. Today's word's length isn't told (owner, 2026-10-12).
 */
export function Tray(props: {
  letters: string;
  disabled: boolean;
  /** Whether keys belong to the tray right now (no question or panel open). */
  listening: boolean;
  /** Shake the line: the last word was refused. */
  refused: number;
  /** What the next guess scores if it finds the word. */
  worth: number;
  onGuess(word: string): Promise<boolean>;
  /** Asks before giving up (the screen holds the question). */
  onGiveUp(): void;
}) {
  const { letters, disabled, listening, refused, worth, onGuess, onGiveUp } = props;
  // The row's order (indexes into `letters`), and the letters set in the line (indexes, in order).
  const [order, setOrder] = useState(() => [...letters].map((_, i) => i));
  const [set, setSet] = useState<number[]>([]);
  const word = set.map((i) => letters[i]).join("");
  // What the key handler (registered once) reads.
  const latest = useRef({ set, word, disabled, order, onGuess });
  useEffect(() => {
    latest.current = { set, word, disabled, order, onGuess };
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef<HTMLParagraphElement>(null);
  // Set as a played word leaves the line, so its letters fade back into the row instead of flying.
  const playedRef = useRef(false);
  // A word is on its way (asked, or rising out of the line): Enter again mustn't play it twice.
  const playingRef = useRef(false);
  useLetterFlip(rootRef, playedRef);

  function add(i: number) {
    setSet((s) => (s.includes(i) || s.length >= letters.length ? s : [...s, i]));
  }

  function addLetter(ch: string) {
    setSet((s) => {
      const free = [...letters].findIndex((l, i) => l === ch && !s.includes(i));
      return free < 0 ? s : [...s, free];
    });
  }

  async function play() {
    const { word: w, disabled: off, onGuess: guess } = latest.current;
    if (off || w.length === 0 || playingRef.current) return;
    playingRef.current = true;
    try {
      if (!(await guess(w))) return;
      // The word rises out of the line toward the book, then the line clears.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const rise = still
        ? null
        : typedRef.current?.animate(
            [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: "translateY(-22px)" },
            ],
            { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" },
          );
      await rise?.finished.catch(() => {});
      playedRef.current = true;
      // Cleared in the same frame the rise lets go, so the word never flashes back.
      flushSync(() => setSet([]));
      rise?.cancel();
    } finally {
      playingRef.current = false;
    }
  }

  function shuffle() {
    const current = latest.current.order;
    let next = current;
    // A shuffle that changes nothing looks broken.
    for (let tries = 0; tries < 5 && next.join() === current.join(); tries++) {
      next = [...current];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
    }
    setOrder(next);
  }

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof Element && target.closest('[role="dialog"]'))) return;
      if (/^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        addLetter(event.key.toLowerCase());
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setSet((s) => s.slice(0, -1));
      } else if (event.key === "Escape") {
        setSet([]);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void play();
      } else if (event.key === " ") {
        event.preventDefault();
        shuffle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `addLetter`, `play` and `shuffle` read state through setters and `latest`, so they're never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, letters]);

  return (
    <div className={styles.tray} ref={rootRef}>
      <div className={styles.line}>
        {/* Refused: the line shakes. Keyed, so each refusal shakes it again. */}
        <div className={styles.shake} data-shake={refused || undefined} key={refused}>
          <p ref={typedRef} className={styles.typed} aria-live="polite" aria-label={word ? `Your guess: ${word}` : "Type a word from today's letters"}>
            {set.map((i) => (
              <span key={i} data-flip={`line:${i}`}>
                {letters[i]}
              </span>
            ))}
            {!word && (
              <>
                <span className={styles.caret} aria-hidden />
                <span className={styles.typedHint}>a word from the letters</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className={styles.row} role="group" aria-label="Today's letters">
        {order.map((i, k) => (
          <button
            key={i}
            type="button"
            className={styles.letter}
            data-set={set.includes(i) || undefined}
            disabled={disabled || set.includes(i)}
            onClick={() => add(i)}
            aria-label={`Add ${letters[i]!.toUpperCase()}`}
            style={{ "--k": k } as CSSProperties}
          >
            <span data-flip={`cell:${i}`}>{letters[i]}</span>
          </button>
        ))}
      </div>

      <div className={styles.keys}>
        <button type="button" className={styles.quiet} onClick={shuffle} disabled={disabled} aria-label="Shuffle the letters">
          Shuffle
        </button>
        <button type="button" className={styles.quiet} onClick={() => setSet((s) => s.slice(0, -1))} disabled={disabled || set.length === 0} aria-label="Take back a letter">
          Back
        </button>
        <span className={styles.keysRule} aria-hidden />
        <button type="button" className={`${styles.quiet} ${styles.giveUpInRow}`} onClick={onGiveUp} disabled={disabled}>
          Give up
        </button>
        <span className={styles.keysGap} />
        <button type="button" className={styles.go} onClick={() => void play()} disabled={disabled || word.length < 3} aria-label={`Guess, worth ${worth} points`}>
          Guess<span className={styles.worthTag}>{worth}</span>
        </button>
      </div>
      <div className={styles.giveUpRow}>
        <button type="button" className={styles.quiet} onClick={onGiveUp} disabled={disabled}>
          Give up
        </button>
      </div>
    </div>
  );
}
