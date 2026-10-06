"use client";

import { useState } from "react";
import type { GameUiProps } from "@/core/view";
import type { FilmSearchHit } from "@/games/_movies/schemas";
import { FilmSearch, GuessLog, guessAnnouncement, IrisReveal, LastGuess, LiveStatus, MoviesButton, MoviesStage } from "@/games/_movies/ui";
import { colorBarcode, edgeCode, EDGE_CODE_AFTER_MISSES, type EdgeCode, type Reveal } from "./logic";
import styles from "./color-barcode.module.css";
import { connectGameUi } from "../game-ui-context";

/**
 * Color Barcode's board, on the kit's neutral-gray stage (a colorist's suite: R = G = B around the
 * picture, so the surround doesn't bias how its colors read). The barcode is drawn from the
 * puzzle's colors as a full-width strip of film; nothing is ever drawn over it.
 */
export function ColorBarcodeUi({ view, submitMove, pending }: GameUiProps<typeof colorBarcode>) {
  const { puzzle, state, status, reveal } = view;
  const [error, setError] = useState<string | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const playing = status === "in_progress";
  const used = state.guesses.length;
  const left = puzzle.maxGuesses - used;
  const misses = state.guesses.filter((g) => !g.correct).length;

  async function send(move: Parameters<typeof submitMove>[0]) {
    setError(null);
    setConfirmGiveUp(false);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
  }
  const guess = (film: FilmSearchHit) => send({ type: "guess", filmId: film.id });

  const kicker = playing
    ? `Guess ${used + 1} of ${puzzle.maxGuesses}`
    : status === "won"
      ? `Solved in ${used}`
      : state.gaveUp
        ? "You gave up"
        : "Out of guesses";
  const announcement = state.gaveUp
    ? "You gave up."
    : guessAnnouncement(state.guesses, playing ? `${left} ${left === 1 ? "guess" : "guesses"} left.` : "");

  return (
    <MoviesStage
      title={colorBarcode.name}
      kicker={kicker}
      variant="neutral"
      devFixture={puzzle.fixture}
      compact={playing}
      countdown={playing ? { value: left, label: left === 1 ? "guess left" : "guesses left" } : undefined}
    >
      <Barcode stripes={puzzle.stripes} />

      <EdgeCodePanel code={edgeCode(state)} misses={misses} playing={playing} />

      {!playing && reveal && (
        <IrisReveal revealKey={status}>
          <RevealCard reveal={reveal} won={status === "won"} gaveUp={state.gaveUp} guesses={used} />
        </IrisReveal>
      )}

      {playing && (
        <div className={styles.guessArea}>
          <FilmSearch
            label="Name the film"
            placeholder="Search films"
            onSelect={guess}
            disabled={pending}
            excludeIds={state.guesses.map((g) => g.film.id)}
          />
          <LastGuess entries={state.guesses} />
          {confirmGiveUp ? (
            <div className={styles.confirm} role="group" aria-label="Give up?">
              <p>Give up and see the answer?</p>
              <div className={styles.confirmButtons}>
                <MoviesButton kind="primary" onClick={() => send({ type: "give-up" })} disabled={pending}>
                  Give up
                </MoviesButton>
                <MoviesButton kind="secondary" onClick={() => setConfirmGiveUp(false)} disabled={pending}>
                  Keep guessing
                </MoviesButton>
              </div>
            </div>
          ) : (
            <MoviesButton kind="quiet" block disabled={pending} onClick={() => setConfirmGiveUp(true)}>
              Give up
            </MoviesButton>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      )}

      <GuessLog
        entries={state.guesses}
        label="Your guesses"
        emptyText="No guesses yet. Read the barcode left to right: the opening shot to the last frame."
      />

      <LiveStatus message={announcement} />
    </MoviesStage>
  );
}

/** Consecutive equal stripes merged into runs, so long scenes are one rect. */
function runsOf(stripes: readonly string[]): { start: number; length: number; color: string }[] {
  const runs: { start: number; length: number; color: string }[] = [];
  stripes.forEach((color, i) => {
    const last = runs.at(-1);
    if (last && last.color === color) last.length++;
    else runs.push({ start: i, length: 1, color });
  });
  return runs;
}

/** The barcode as a strip of film: perforated rails above and below, the picture untouched between. */
function Barcode({ stripes }: { stripes: readonly string[] }) {
  const runs = runsOf(stripes);
  return (
    <figure className={styles.film}>
      <div className={styles.rail} aria-hidden />
      <svg
        className={styles.barcode}
        viewBox={`0 0 ${stripes.length} 1`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Today's film as a color barcode: ${stripes.length} stripes, each the average color of one moment, from the first frame on the left to the last on the right.`}
      >
        {runs.map((run) => (
          <rect key={run.start} x={run.start} y={0} width={run.length} height={1} fill={run.color} />
        ))}
      </svg>
      <div className={styles.rail} aria-hidden />
      <figcaption className={styles.axis}>
        <span>
          <span aria-hidden>▸ </span>First frame
        </span>
        <i aria-hidden className={styles.axisLine} />
        <span>{stripes.length} stripes</span>
        <i aria-hidden className={styles.axisLine} />
        <span>
          Last frame<span aria-hidden> ◂</span>
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * A decade's label on the century rule: two digits ("’90"), except at the rule's ends and where a
 * century turns ("1920", "2000", "2020"), so 1920 and 2020 can't be mistaken for each other.
 */
function decadeLabel(decade: number, first: number, last: number): string {
  if (decade === first || decade === last || decade % 100 === 0) return String(decade);
  return `’${String(decade % 100).padStart(2, "0")}`;
}

/** At most one pin per decade cell: the latest guess there, plus how many more. */
function pinsFor(guesses: readonly number[]): { pin: number; more: number } | null {
  const pin = guesses.at(-1);
  return pin === undefined ? null : { pin, more: guesses.length - 1 };
}

function windowText(code: EdgeCode): string {
  const { low, high } = code.window;
  return low === high ? `Released in ${low}` : `Released ${low}–${high}`;
}

/**
 * The edge code: locked until the third miss (a row of notches counts toward it), then the
 * answer's decade on a century rule, and that decade's years with everything the clues have ruled
 * out struck through. Every state is shown by fill, outline and text, never by color alone.
 */
function EdgeCodePanel({ code, misses, playing }: { code: EdgeCode | null; misses: number; playing: boolean }) {
  if (!code) {
    if (!playing) return null;
    const toGo = EDGE_CODE_AFTER_MISSES - misses;
    return (
      <section className={styles.edge} aria-label="Edge code">
        <div className={styles.edgeHead}>
          <h3 className={styles.edgeTitle}>Edge code</h3>
          <p className={styles.edgeNote}>The film&apos;s decade appears after {toGo === 1 ? "one more miss" : `${toGo} more misses`}</p>
        </div>
        <ol className={styles.notches} aria-hidden>
          {Array.from({ length: EDGE_CODE_AFTER_MISSES }, (_, i) => (
            <li key={i} data-filled={i < misses} />
          ))}
        </ol>
      </section>
    );
  }

  return (
    <IrisReveal revealKey={code.decade}>
      <section className={styles.edge} aria-label="Edge code">
        <div className={styles.edgeHead}>
          <h3 className={styles.edgeTitle}>Edge code · the {code.decade}s</h3>
          <p className={styles.edgeNote}>{windowText(code)}</p>
        </div>

        <ol className={styles.century} aria-label="Decades">
          {code.decades.map((d) => {
            const pins = pinsFor(d.guesses);
            return (
              <li key={d.decade} className={styles.decade} data-answer={d.isAnswer}>
                <span className={styles.pins} aria-hidden>
                  {pins && <b>{pins.pin}</b>}
                  {pins && pins.more > 0 && <span className={styles.pinsMore}>+{pins.more}</span>}
                </span>
                <span className={styles.decadeLabel}>
                  <span aria-hidden>{decadeLabel(d.decade, code.decades[0].decade, code.decades.at(-1)!.decade)}</span>
                  <span className={styles.srOnly}>
                    {d.decade}s{d.isAnswer ? ", the film's decade" : ""}
                    {d.guesses.length > 0 ? `, guess ${d.guesses.join(" and ")}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <ol className={styles.years} aria-label={`Years of the ${code.decade}s`}>
          {code.years.map((y) => (
            <li key={y.year} className={styles.year} data-status={y.status}>
              <span className={styles.yearNo} aria-hidden>
                {String(y.year % 100).padStart(2, "0")}
              </span>
              <span className={styles.yearMark} aria-hidden>
                {y.guesses.length > 0 ? y.guesses.map((n) => `#${n}`).join(" ") : y.status === "open" ? "" : "×"}
              </span>
              <span className={styles.srOnly}>
                {y.year}: {y.status === "open" ? "possible" : "ruled out"}
                {y.guesses.length > 0 ? `, guess ${y.guesses.join(" and ")}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </IrisReveal>
  );
}

function RevealCard({ reveal, won, gaveUp, guesses }: { reveal: Reveal; won: boolean; gaveUp: boolean; guesses: number }) {
  const { answer } = reveal;
  return (
    <section className={styles.reveal} aria-label="Today's film">
      <p className={styles.revealKicker}>
        <span aria-hidden>{won ? "✓" : gaveUp ? "⚑" : "✕"}</span> {won ? `Solved in ${guesses}` : "Today's film was"}
      </p>
      <h3 className={styles.revealTitle}>{answer.title}</h3>
      <p className={styles.revealMeta}>
        {[answer.year, answer.directors.length > 0 ? `Directed by ${answer.directors.join(" & ")}` : null].filter(Boolean).join(" · ")}
      </p>
    </section>
  );
}

/** What the play page renders for this game; the game host supplies the props. */
export const ColorBarcodeEntry = connectGameUi(ColorBarcodeUi);
