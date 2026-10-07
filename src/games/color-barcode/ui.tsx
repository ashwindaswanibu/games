"use client";

import { useState } from "react";
import type { GameUiProps } from "@/core/view";
import { spokenGuess } from "@/games/_movies/clue-text";
import {
  FilmSearch,
  GuessLog,
  LastGuess,
  type GuessLogEntry,
  LiveStatus,
  MoviesButton,
  MoviesStage,
  PuzzleImage,
  RevealStrip,
  type RevealStep,
  type RevealStepStatus,
} from "@/games/_movies/ui";
import styles from "./color-barcode.module.css";
import { colorBarcode, guessedFilmIds, isSkip, LEVEL_COUNT, levelsInView, MAX_GUESSES, type LevelRef, type State, type Turn } from "./logic";
import { connectGameUi } from "../game-ui-context";

/**
 * A deliberately plain Color Barcode board: the current level, a strip to look back at earlier
 * ones, the search, and the films already tried. No clues of any kind: a wrong guess only reveals
 * the next level. The real board (the in-place "wow" transition between
 * levels, the ambient colour from each level's `average`/`dominant`) is being designed with the
 * owner; this keeps the game playable against the ten-level model until then.
 */

type Props = GameUiProps<typeof colorBarcode>;

/** Turns as the kit's guess log reads them: a guess with no clue chips, or a skip. */
function logEntries(turns: readonly Turn[]): GuessLogEntry[] {
  return turns.map((t) => (isSkip(t) ? t : { ...t, clues: [] }));
}

function turnStatus(turn: Turn): RevealStepStatus {
  if (isSkip(turn)) return "skipped";
  return turn.correct ? "solved" : "missed";
}

function levelStatuses(state: State, playing: boolean): RevealStepStatus[] {
  return Array.from({ length: LEVEL_COUNT }, (_, i) => {
    const turn = state.turns[i];
    if (turn) return turnStatus(turn);
    if (!playing) return "seen";
    return i === state.turns.length ? "current" : "locked";
  });
}

/** The play ended because the player skipped the last level rather than missing it. */
function gaveUp(state: State, status: string): boolean {
  const last = state.turns.at(-1);
  return status === "lost" && last !== undefined && isSkip(last);
}

function announcement(state: State, playing: boolean, quit: boolean): string {
  const last = state.turns.at(-1);
  if (!last) return "";
  if (quit) return "You gave up.";
  const left = MAX_GUESSES - state.turns.length;
  const next = playing ? ` Level ${state.turns.length + 1} of ${LEVEL_COUNT} is showing. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : "";
  return `${spokenGuess(isSkip(last) ? last : { ...last, clues: [] })}${next}`;
}

export function ColorBarcodeUi({ view, submitMove, pending }: Props) {
  const { puzzle, state, status, reveal } = view;
  const playing = status === "in_progress";
  const levels: LevelRef[] = reveal?.levels ?? levelsInView(puzzle, state);
  const statuses = levelStatuses(state, playing);
  const quit = gaveUp(state, status);
  const latest = playing ? state.turns.length : Math.max(0, state.turns.length - 1);
  const onLastLevel = playing && state.turns.length === MAX_GUESSES - 1;
  const attemptsLeft = MAX_GUESSES - state.turns.length;
  const entries = logEntries(state.turns);

  // Looking back at an earlier level lasts until the next level is earned or the play ends.
  const viewKey = `${status}:${levels.length}`;
  const [picked, setPicked] = useState<{ index: number; viewKey: string } | null>(null);
  const shown = picked && picked.viewKey === viewKey && picked.index < levels.length ? picked.index : latest;
  const select = (index: number) => setPicked({ index, viewKey });

  const [error, setError] = useState<string | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);

  async function send(move: { type: "guess"; filmId: number } | { type: "skip" }) {
    setError(null);
    setConfirmGiveUp(false);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
  }

  const kicker = playing
    ? `Attempt ${state.turns.length + 1} of ${MAX_GUESSES}`
    : status === "won"
      ? `Named on level ${state.turns.length}`
      : quit
        ? `You gave up on level ${state.turns.length}`
        : "Out of attempts";
  const steps: RevealStep[] = statuses.map((s, i) => ({ label: `Level ${i + 1}`, status: s }));
  const level = levels[shown];
  const alt = reveal ? `Level ${shown + 1} of ${LEVEL_COUNT} of ${reveal.film.title}` : `Level ${shown + 1} of ${LEVEL_COUNT} of today's film`;

  return (
    <MoviesStage
      title={colorBarcode.name}
      kicker={kicker}
      variant="neutral"
      devFixture={puzzle.fixture}
      compact={playing}
      countdown={playing ? { value: attemptsLeft, label: attemptsLeft === 1 ? "attempt left" : "attempts left" } : undefined}
    >
      <div className={styles.board}>
        {reveal && (
          <section className={styles.reveal} aria-label="Today's film">
            <p>
              <span aria-hidden>{status === "won" ? "✓" : quit ? "⚑" : "✕"}</span>{" "}
              {status === "won" ? `You named it on level ${state.turns.length}` : "Today's film was"}
            </p>
            <h3 className={styles.revealTitle}>{reveal.film.title}</h3>
            <p>{[reveal.film.year, reveal.film.directors.length ? `Directed by ${reveal.film.directors.join(" & ")}` : null].filter(Boolean).join(" · ")}</p>
            {reveal.credit && (
              <p className={styles.credit}>
                Frames: <a href={reveal.credit.url} target="_blank" rel="noreferrer">{reveal.credit.source}</a>
              </p>
            )}
          </section>
        )}

        <p className={styles.levelHead}>
          <span>
            Level {shown + 1} / {LEVEL_COUNT}
          </span>
          {playing && shown !== latest && (
            <button type="button" onClick={() => select(latest)}>
              Back to level {latest + 1}
            </button>
          )}
        </p>
        {level && <PuzzleImage key={level.id} asset={level} alt={alt} />}
        <div className={styles.levels}>
          <RevealStrip steps={steps} selectedIndex={shown} onSelect={select} label="Levels" />
        </div>

        {playing && (
          <div className={styles.controls}>
            <FilmSearch
              label="Name the film"
              placeholder="Search films"
              disabled={pending}
              excludeIds={guessedFilmIds(state)}
              onSelect={(film) => void send({ type: "guess", filmId: film.id })}
            />
            <LastGuess entries={entries} />
            {onLastLevel ? (
              confirmGiveUp ? (
                <div className={styles.confirm} role="group" aria-label="Give up?">
                  <p>Give up and see the answer?</p>
                  <div className={styles.confirmActions}>
                    <MoviesButton kind="primary" disabled={pending} onClick={() => void send({ type: "skip" })}>
                      Give up
                    </MoviesButton>
                    <MoviesButton kind="secondary" disabled={pending} onClick={() => setConfirmGiveUp(false)}>
                      Keep guessing
                    </MoviesButton>
                  </div>
                </div>
              ) : (
                <MoviesButton kind="quiet" block disabled={pending} onClick={() => setConfirmGiveUp(true)}>
                  Give up
                </MoviesButton>
              )
            ) : (
              <MoviesButton kind="secondary" block disabled={pending} onClick={() => void send({ type: "skip" })}>
                <span aria-hidden>»</span>&nbsp;Skip to level {state.turns.length + 2}
              </MoviesButton>
            )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </div>
        )}

        <section className={styles.log} aria-label="Your guesses">
          <h3>Your guesses</h3>
          <GuessLog entries={entries} gaveUp={quit} emptyText="No guesses yet. Each miss or skip reveals the next level." />
        </section>
      </div>

      <LiveStatus message={announcement(state, playing, quit)} />
    </MoviesStage>
  );
}

/** What the play page renders for this game; the game host supplies the props. */
export const ColorBarcodeEntry = connectGameUi(ColorBarcodeUi);
