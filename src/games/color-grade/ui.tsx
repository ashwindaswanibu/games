"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AssetRef } from "@/core/assets";
import type { GameUiProps } from "@/core/view";
import {
  FilmSearch,
  GuessLog,
  guessAnnouncement,
  IrisReveal,
  LastGuess,
  LiveStatus,
  MoviesButton,
  MoviesStage,
  PuzzleImage,
  RevealStrip,
  type RevealStep,
} from "@/games/_movies/ui";
import { hexToRgb, relativeLuminance } from "./imaging";
import { colorGrade, guessedFilmIds, MAX_TRIES, STAGES, type Reveal, type Stage, type State, type Swatch, type Turn } from "./logic";
import styles from "./color-grade.module.css";
import { connectGameUi } from "../game-ui-context";

const STAGE_LABEL: Record<Stage, string> = { palette: "Palette", graded: "Grade", blurred: "Blur", still: "Still", final: "Final" };

const STAGE_CAPTION: Record<Stage, string> = {
  palette: "Five colors from one frame of the film, each as wide as the share of the frame it fills.",
  graded: "An ordinary photo, regraded with that frame's color.",
  blurred: "The frame itself, out of focus.",
  still: "The frame itself.",
  final: "Last try. Every stage so far is in the strip below.",
};

type Images = { neutral: AssetRef | null; graded: AssetRef | null; blurred: AssetRef | null; still: AssetRef | null };

/** Earned images during play; everything once the reveal arrives. */
function visibleImages(state: State, reveal: Reveal | null): Images {
  return reveal ? { neutral: reveal.neutral, graded: reveal.graded, blurred: reveal.blurred, still: reveal.still } : state.unlocked;
}

function stageImage(stage: Stage, images: Images): AssetRef | null {
  if (stage === "graded") return images.graded;
  if (stage === "blurred") return images.blurred;
  if (stage === "still" || stage === "final") return images.still;
  return null;
}

function turnStatus(turn: Turn): RevealStep["status"] {
  if ("skipped" in turn) return "skipped";
  return turn.correct ? "solved" : "missed";
}

export function ColorGradeUi({ view, submitMove, pending }: GameUiProps<typeof colorGrade>) {
  const { puzzle, state, status, reveal } = view;
  const playing = status === "in_progress";
  const tries = state.turns.length;
  const images = visibleImages(state, reveal);

  // A stage the player flipped back to stays selected only until the next move.
  const [picked, setPicked] = useState<{ index: number; atTurn: number } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [allValues, setAllValues] = useState(false);

  const available = (index: number) => index === 0 || (stageImage(STAGES[index], images) !== null && (!playing || index <= tries));
  const defaultIndex = playing ? tries : STAGES.indexOf("still");
  const selected = picked && picked.atTurn === tries && available(picked.index) ? picked.index : defaultIndex;
  const stage = STAGES[selected];
  const image = stageImage(stage, images);

  const steps: RevealStep[] = STAGES.map((s, index) => {
    const label = STAGE_LABEL[s];
    if (index < tries) return { label, status: turnStatus(state.turns[index]) };
    if (playing && index === tries) return { label, status: "current" };
    return { label, status: !playing && available(index) ? "seen" : "locked" };
  });

  async function send(move: Parameters<typeof submitMove>[0]) {
    setError(null);
    setConfirmGiveUp(false);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
    else setShowOriginal(false);
  }

  const lastTry = tries === MAX_TRIES - 1;
  // Skipping the last try is giving up, and the board says so.
  const lastTurn = state.turns.at(-1);
  const gaveUp = status === "lost" && lastTurn !== undefined && "skipped" in lastTurn;
  const kicker = playing
    ? `Try ${tries + 1} of ${MAX_TRIES}`
    : status === "won"
      ? `Solved on try ${tries}`
      : gaveUp
        ? `You gave up on try ${tries}`
        : "Out of tries";
  const currentStage = STAGES[Math.min(tries, STAGES.length - 1)];
  const announcement = gaveUp
    ? "You gave up."
    : guessAnnouncement(state.turns, playing ? `Stage ${tries + 1}, ${STAGE_LABEL[currentStage]}: ${STAGE_CAPTION[currentStage]}` : "");

  return (
    <MoviesStage
      title={colorGrade.name}
      kicker={kicker}
      variant="neutral"
      devFixture={puzzle.fixture}
      compact={playing}
      countdown={playing ? { value: MAX_TRIES - tries, label: MAX_TRIES - tries === 1 ? "try left" : "tries left" } : undefined}
    >
      <div className={styles.viewer}>
        <IrisReveal revealKey={stage === "final" ? "still" : stage}>
          {stage === "palette" || !image ? (
            <PaletteBoard palette={puzzle.palette} allValues={allValues} />
          ) : stage === "graded" && images.neutral ? (
            <>
              <div hidden={showOriginal}>
                <PuzzleImage asset={image} aspectRatio={16 / 9} alt="Stage 2: an ordinary photo regraded with the film's color" />
              </div>
              <div hidden={!showOriginal}>
                <PuzzleImage asset={images.neutral} aspectRatio={16 / 9} alt="Stage 2: the same photo before grading" />
              </div>
            </>
          ) : (
            <PuzzleImage
              asset={image}
              aspectRatio={16 / 9}
              alt={
                reveal && stage !== "blurred"
                  ? `A frame from ${reveal.answer.title}`
                  : stage === "blurred"
                    ? "Stage 3: a frame from the film, blurred"
                    : "Stage 4: a frame from the film"
              }
            />
          )}
        </IrisReveal>

        <div className={styles.caption}>
          <p>
            <span className={styles.stageName}>
              {selected + 1} · {STAGE_LABEL[stage]}
            </span>{" "}
            {STAGE_CAPTION[stage]}
          </p>
          {stage === "palette" && (
            <MoviesButton kind="quiet" aria-pressed={allValues} onClick={() => setAllValues((on) => !on)}>
              {allValues ? "Hide values" : "Show values"}
            </MoviesButton>
          )}
          {stage === "graded" && images.neutral && (
            <div className={styles.compare} role="group" aria-label="Compare with the original photo">
              <button type="button" aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>
                Graded
              </button>
              <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>
                Original
              </button>
            </div>
          )}
        </div>

        {stage !== "palette" && <PaletteBoard palette={puzzle.palette} allValues={false} compact />}
      </div>

      <RevealStrip
        steps={steps}
        selectedIndex={selected}
        onSelect={(index) => setPicked({ index, atTurn: tries })}
        showLabels
        label="Stages"
      />

      {playing && (
        <div className={styles.controls}>
          <FilmSearch
            label="Name the film"
            onSelect={(film) => send({ type: "guess", filmId: film.id })}
            excludeIds={guessedFilmIds(state)}
            disabled={pending}
          />
          <LastGuess entries={state.turns} />
          {confirmGiveUp ? (
            <div className={styles.confirm} role="group" aria-label="Give up?">
              <p>Give up and see the answer?</p>
              <div className={styles.confirmButtons}>
                <MoviesButton kind="primary" onClick={() => send({ type: "skip" })} disabled={pending}>
                  Give up
                </MoviesButton>
                <MoviesButton kind="secondary" onClick={() => setConfirmGiveUp(false)} disabled={pending}>
                  Keep guessing
                </MoviesButton>
              </div>
            </div>
          ) : (
            <MoviesButton
              kind="secondary"
              block
              disabled={pending}
              onClick={() => (lastTry ? setConfirmGiveUp(true) : send({ type: "skip" }))}
            >
              {lastTry ? "Give up" : `Skip to the ${STAGE_LABEL[STAGES[tries + 1]].toLowerCase()}`}
            </MoviesButton>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      )}

      {reveal && (
        <section className={styles.verdict} aria-label="The answer">
          <p className={styles.verdictKicker}>
            <span aria-hidden>{status === "won" ? "✓" : gaveUp ? "⚑" : "✕"}</span>{" "}
            {status === "won" ? `You named it on try ${tries}` : "The film was"}
          </p>
          <h3 className={styles.verdictTitle}>{reveal.answer.title}</h3>
          <p className={styles.verdictMeta}>
            {[reveal.answer.year, reveal.answer.directors.length ? `Directed by ${reveal.answer.directors.join(" & ")}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className={styles.verdictHint}>Flip through every stage in the strip above.</p>
        </section>
      )}

      <GuessLog
        entries={state.turns}
        gaveUp={gaveUp}
        emptyText="No guesses yet. Read the palette, then name the film."
        label="Your tries"
      />

      <LiveStatus message={announcement} />
    </MoviesStage>
  );
}

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

const LONG_PRESS_MS = 380;

/**
 * The five swatches, each as wide as its share of the frame. Hex values show on hover, on keyboard
 * focus, while a swatch is long-pressed, when a swatch is tapped (it stays pinned), or all at once
 * with `allValues`. Screen readers always get the value in the swatch's name.
 */
function PaletteBoard({ palette, allValues, compact = false }: { palette: readonly Swatch[]; allValues: boolean; compact?: boolean }) {
  const [pinned, setPinned] = useState<ReadonlySet<number>>(new Set());
  const [peek, setPeek] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  const endPress = () => {
    clearTimeout(timer.current);
    setPeek(null);
  };
  const startPress = (index: number, event: ReactPointerEvent) => {
    if (event.pointerType === "mouse") return;
    longPressed.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setPeek(index);
    }, LONG_PRESS_MS);
  };
  const toggle = (index: number) => {
    // The click that ends a long-press only ends the peek.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className={compact ? styles.paletteCompact : styles.paletteFull}>
      {compact && (
        <p className={styles.paletteLabel} aria-hidden>
          Palette
        </p>
      )}
      <ul className={styles.swatches} aria-label="The film's palette, largest share first" data-compact={compact}>
        {palette.map((swatch, index) => {
          const percent = Math.round(swatch.share * 100);
          const light = relativeLuminance(hexToRgb(swatch.hex)) > 0.36;
          const shown = allValues || pinned.has(index) || peek === index;
          return (
            <li key={index} className={styles.swatchItem} style={{ flexGrow: Math.max(swatch.share, 0.0001) }}>
              <button
                type="button"
                className={styles.swatch}
                style={{ background: swatch.hex }}
                data-tone={light ? "light" : "dark"}
                data-shown={shown}
                aria-pressed={pinned.has(index)}
                aria-label={`Color ${index + 1} of ${palette.length}: ${swatch.hex}, ${percent < 1 ? "under 1" : percent}% of the frame`}
                onClick={() => toggle(index)}
                onPointerDown={(event) => startPress(index, event)}
                onPointerUp={endPress}
                onPointerCancel={endPress}
                onPointerLeave={endPress}
                onContextMenu={(event) => event.preventDefault()}
              >
                <span className={styles.swatchValue} aria-hidden>
                  <span className={styles.swatchHex}>{swatch.hex.slice(1)}</span>
                  {!compact && <span className={styles.swatchShare}>{percent < 1 ? "<1" : percent}%</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the play page renders for this game; the game host supplies the props. */
export const ColorGradeEntry = connectGameUi(ColorGradeUi);
