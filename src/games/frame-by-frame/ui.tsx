"use client";

import { useState } from "react";
import type { AssetRef } from "@/core/assets";
import type { GameUiProps } from "@/core/view";
import { spokenGuess } from "@/games/_movies/clue-text";
import {
  FilmSearch,
  GuessLog,
  IrisReveal,
  LastGuess,
  LiveStatus,
  MoviesButton,
  MoviesStage,
  PuzzleImage,
  RevealStrip,
  type RevealStep,
  type RevealStepStatus,
} from "@/games/_movies/ui";
import styles from "./frame-by-frame.module.css";
import { FRAME_COUNT, frameByFrame, framesInView, guessedFilmIds, isSkip, type State, type Turn } from "./logic";
import { connectGameUi } from "../game-ui-context";

type Props = GameUiProps<typeof frameByFrame>;

/** Every frame shares one 16:9 screen, so wider and narrower frames are letterboxed or pillarboxed. */
const SCREEN_RATIO = 16 / 9;

function turnStatus(turn: Turn): RevealStepStatus {
  if (isSkip(turn)) return "skipped";
  return turn.correct ? "solved" : "missed";
}

/** The strip's statuses: played frames carry their verdict; the rest are current, locked or (once over) seen. */
function frameStatuses(state: State, playing: boolean): RevealStepStatus[] {
  return Array.from({ length: FRAME_COUNT }, (_, i) => {
    const turn = state.turns[i];
    if (turn) return turnStatus(turn);
    if (!playing) return "seen";
    return i === state.turns.length ? "current" : "locked";
  });
}

type StatusWord = { glyph: string; word: string };

const STATUS_WORD: Record<RevealStepStatus, StatusWord> = {
  solved: { glyph: "✓", word: "Named" },
  missed: { glyph: "✕", word: "Missed" },
  skipped: { glyph: "»", word: "Skipped" },
  seen: { glyph: "·", word: "Unplayed" },
  current: { glyph: "●", word: "Now" },
  locked: { glyph: "", word: "Locked" },
};

const GAVE_UP: StatusWord = { glyph: "⚑", word: "Gave up" };

const pad = (n: number) => String(n).padStart(2, "0");

/** The play ended because the player gave up (skipped the last frame) rather than missing it. */
function gaveUp(state: State, status: string): boolean {
  const last = state.turns.at(-1);
  return status === "lost" && last !== undefined && isSkip(last);
}

/** One sentence for screen readers after each move: the verdict, the clues a miss earned, what's next. */
function announcement(state: State, playing: boolean, quit: boolean): string {
  const last = state.turns.at(-1);
  if (!last) return "";
  if (quit) return "You gave up.";
  const next = playing ? ` Frame ${state.turns.length + 1} of ${FRAME_COUNT} is showing.` : "";
  return `${spokenGuess(last)}${next}`;
}

export function FrameByFrameUi({ view, submitMove, pending }: Props) {
  const { puzzle, state, status, reveal } = view;
  const playing = status === "in_progress";
  const frames: AssetRef[] = reveal?.frames ?? framesInView(puzzle, state);
  const statuses = frameStatuses(state, playing);
  const quit = gaveUp(state, status);
  const words = statuses.map((s, i) => (quit && i === state.turns.length - 1 ? GAVE_UP : STATUS_WORD[s]));
  // The frame being played (or, once over, the last one played).
  const latest = playing ? state.turns.length : Math.max(0, state.turns.length - 1);
  const onLastFrame = playing && state.turns.length === FRAME_COUNT - 1;

  // A flip back through earlier frames lasts until the next frame is earned or the play ends.
  const viewKey = `${status}:${frames.length}`;
  const [picked, setPicked] = useState<{
    index: number;
    viewKey: string;
  } | null>(null);
  const shown = picked && picked.viewKey === viewKey && picked.index < frames.length ? picked.index : latest;
  const select = (index: number) => setPicked({ index, viewKey });

  const [error, setError] = useState<string | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);

  async function send(move: { type: "guess"; filmId: number } | { type: "skip" }) {
    setError(null);
    setConfirmGiveUp(false);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
  }

  const framesLeft = FRAME_COUNT - state.turns.length;
  const kicker = playing
    ? `Frame ${latest + 1} of ${FRAME_COUNT}`
    : status === "won"
      ? `Named on frame ${state.turns.length}`
      : quit
        ? `You gave up on frame ${state.turns.length}`
        : "The reel ran out";

  const steps: RevealStep[] = statuses.map((s, i) => ({
    label: `Frame ${i + 1}`,
    status: s,
  }));
  const altFor = (index: number) =>
    reveal ? `Frame ${index + 1} of ${FRAME_COUNT} from ${reveal.film.title}` : `Frame ${index + 1} of ${FRAME_COUNT} from today's film`;
  const frame = frames[shown];

  return (
    <MoviesStage
      title={frameByFrame.name}
      kicker={kicker}
      devFixture={puzzle.fixture}
      compact={playing}
      countdown={
        playing
          ? {
              value: framesLeft,
              label: framesLeft === 1 ? "frame left" : "frames left",
            }
          : undefined
      }
    >
      {reveal && (
        <header className={styles.titleCard} aria-label="Today's film">
          <p className={styles.cardKicker}>
            <span aria-hidden>{status === "won" ? "✓" : quit ? "⚑" : "✕"}</span>{" "}
            {status === "won" ? `You named it on frame ${state.turns.length}` : "Today's film was"}
          </p>
          <p className={styles.cardTitle}>{reveal.film.title}</p>
          <p className={styles.cardMeta}>
            {[reveal.film.year, reveal.film.directors.length ? `Directed by ${reveal.film.directors.join(" & ")}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>
      )}

      <div className={styles.viewer}>
        <div className={styles.caption}>
          <p className={styles.frameNo}>
            <span className={styles.frameNoLabel}>Frame</span>
            <span className={styles.frameNoValue}>{pad(shown + 1)}</span>
            <span className={styles.frameNoOf}>/ {pad(FRAME_COUNT)}</span>
          </p>
          {playing && shown !== latest ? (
            <button type="button" className={styles.backToLatest} onClick={() => select(latest)}>
              Back to frame {latest + 1}
            </button>
          ) : (
            <p className={styles.captionNote}>{playing ? "Hardest first" : words[shown].word}</p>
          )}
        </div>
        {frame && (
          <IrisReveal revealKey={frame.id}>
            <PuzzleImage asset={frame} alt={altFor(shown)} aspectRatio={SCREEN_RATIO} />
          </IrisReveal>
        )}
      </div>

      {playing ? (
        <RevealStrip steps={steps} selectedIndex={shown} onSelect={select} label="Frames" />
      ) : (
        <ContactSheet frames={frames} statuses={statuses} words={words} selected={shown} onSelect={select} altFor={altFor} />
      )}

      {playing && (
        <div className={styles.controls}>
          <FilmSearch
            label="Name the film"
            placeholder="Search films"
            disabled={pending}
            excludeIds={guessedFilmIds(state)}
            onSelect={(film) => void send({ type: "guess", filmId: film.id })}
          />
          <LastGuess entries={state.turns} />
          {onLastFrame ? (
            confirmGiveUp ? (
              <div className={styles.confirm} role="group" aria-label="Give up?">
                <p className={styles.confirmText}>Give up and see the answer?</p>
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
              <span aria-hidden>»</span>&nbsp;Skip to frame {state.turns.length + 2}
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
        <h3 className={styles.logTitle}>Your guesses</h3>
        <GuessLog entries={state.turns} gaveUp={quit} emptyText="No guesses yet. Every wrong guess earns clues." />
      </section>

      <LiveStatus message={announcement(state, playing, quit)} />
    </MoviesStage>
  );
}

/** Once the play is over: all six frames as a contact sheet; picking one puts it on the screen. */
function ContactSheet(props: {
  frames: readonly AssetRef[];
  statuses: readonly RevealStepStatus[];
  words: readonly StatusWord[];
  selected: number;
  onSelect(index: number): void;
  altFor(index: number): string;
}) {
  const { frames, statuses, words, selected, onSelect, altFor } = props;
  return (
    <ol className={styles.sheet} aria-label="All frames">
      {frames.map((frame, index) => {
        const { glyph, word } = words[index];
        return (
          <li key={frame.id}>
            <button
              type="button"
              className={styles.thumb}
              data-status={statuses[index]}
              aria-pressed={selected === index}
              aria-label={`Frame ${index + 1}: ${word}`}
              onClick={() => onSelect(index)}
            >
              <PuzzleImage asset={frame} alt={altFor(index)} aspectRatio={SCREEN_RATIO} />
              <span className={styles.thumbLabel} aria-hidden>
                <span className={styles.thumbNo}>{index + 1}</span>
                <span>
                  {glyph} {word}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** What the play page renders for this game; the game host supplies the props. */
export const FrameByFrameEntry = connectGameUi(FrameByFrameUi);
