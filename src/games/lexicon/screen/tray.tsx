"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./screen.module.css";

/**
 * The nine letters and the guess line. A guess is set from the letters themselves: tap a letter
 * (or type it) and it moves up into the line, leaving a gap in the row; Backspace puts it back.
 * Enter (or Guess) plays the word. Shuffle reorders the row, to see new words in it. Keys work
 * anywhere on the page unless something else is being typed into or a question is open.
 */
export function Tray(props: {
  letters: string;
  /** Letters in today's word: blank slots under the line. */
  length: number;
  disabled: boolean;
  /** Whether keys belong to the tray right now (no question or panel open). */
  listening: boolean;
  /** Shake the line: the last word was refused. */
  refused: number;
  onGuess(word: string): Promise<boolean>;
}) {
  const { letters, length, disabled, listening, refused, onGuess } = props;
  // The row's order (indexes into `letters`), and the letters set in the line (indexes, in order).
  const [order, setOrder] = useState(() => [...letters].map((_, i) => i));
  const [set, setSet] = useState<number[]>([]);
  const word = set.map((i) => letters[i]).join("");
  // What the key handler (registered once) reads.
  const latest = useRef({ set, word, disabled, order, onGuess });
  useEffect(() => {
    latest.current = { set, word, disabled, order, onGuess };
  });

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
    if (off || w.length === 0) return;
    if (await guess(w)) setSet([]);
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
    <div className={styles.tray}>
      <div className={styles.line} data-shake={refused || undefined} key={refused}>
        <p className={styles.typed} aria-live="polite" aria-label={word ? `Your guess: ${word}` : "Type a word from today's letters"}>
          {word}
          <span className={styles.caret} aria-hidden />
          {!word && <span className={styles.typedHint}>a word from the letters</span>}
        </p>
        <span className={styles.slots} aria-label={`Today's word has ${length} letters`}>
          {Array.from({ length }, (_, i) => (
            <span key={i} />
          ))}
        </span>
      </div>

      <div className={styles.row} role="group" aria-label="Today's letters">
        {order.map((i) => (
          <button
            key={i}
            type="button"
            className={styles.letter}
            data-set={set.includes(i) || undefined}
            disabled={disabled || set.includes(i)}
            onClick={() => add(i)}
            aria-label={`Add ${letters[i]!.toUpperCase()}`}
          >
            {letters[i]}
          </button>
        ))}
      </div>

      <div className={styles.keys}>
        <button type="button" className={styles.quiet} onClick={shuffle} disabled={disabled} aria-label="Shuffle the letters">
          ↻ Shuffle
        </button>
        <button type="button" className={styles.quiet} onClick={() => setSet((s) => s.slice(0, -1))} disabled={disabled || set.length === 0} aria-label="Take back a letter">
          ⌫
        </button>
        <span className={styles.keysGap} />
        <button type="button" className={styles.go} onClick={() => void play()} disabled={disabled || word.length < 3}>
          Guess
        </button>
      </div>
    </div>
  );
}
