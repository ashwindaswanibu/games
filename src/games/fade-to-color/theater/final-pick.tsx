"use client";

import { useState } from "react";
import type { FilmRef } from "@/games/_movies/schemas";
import { OPTION_COUNT, PICK_SCORE } from "../logic";
import styles from "./theater.module.css";

/**
 * The last chance, after a wrong guess on reel 10: one pick from four films. Like a guess, it's two
 * steps (choose a film, then Pick), so a slip of the mouse doesn't spend it. A film already guessed
 * is shown but can't be chosen.
 */
export function FinalPick(props: { options: readonly FilmRef[]; guessedIds: readonly number[]; disabled: boolean; onPick(film: FilmRef): void }) {
  const { options, guessedIds, disabled, onPick } = props;
  const [chosen, setChosen] = useState<number | null>(null);
  const film = options.find((f) => f.id === chosen) ?? null;

  return (
    <div className={styles.finalPick}>
      <p className={styles.kicker} id="final-pick-label">
        One chance · {PICK_SCORE} pts
      </p>
      <div className={styles.optionGrid} role="radiogroup" aria-labelledby="final-pick-label" data-count={OPTION_COUNT}>
        {options.map((option) => {
          const guessed = guessedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={chosen === option.id}
              className={styles.optionTile}
              disabled={disabled || guessed}
              onClick={() => setChosen(option.id)}
            >
              <span className={styles.optionTileTitle}>{option.title}</span>
              <span className={styles.optionTileMeta}>{guessed ? "Already guessed" : (option.year ?? "")}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className={styles.go} disabled={disabled || !film} onClick={() => film && onPick(film)}>
        Pick
      </button>
    </div>
  );
}
