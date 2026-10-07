"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { formatPuzzleDate } from "@/core/day";
import type { ImmersiveGameUiProps } from "@/core/view";
import type { FilmSearchHit } from "@/games/_movies/schemas";
import { awaitingPick, fadeToColor, guessedFilmIds, isSkip, LEVEL_COUNT, levelsInView, MAX_GUESSES, OPTION_COUNT, type State } from "../logic";
import { ContactStrip } from "./contact-strip";
import { Credits } from "./credits";
import { Crossfade } from "./crossfade";
import { FinalPick } from "./final-pick";
import { THEATER_FONT_VARS } from "./fonts";
import { Reel, type ReelMove } from "./reel";
import { Slate } from "./slate";
import styles from "./theater.module.css";
import { HOUSE_ACCENT, useLevelArt } from "./use-level-art";
import { LitTitle } from "./wordmark";

type Props = ImmersiveGameUiProps<typeof fadeToColor>;

const pad = (n: number) => String(n).padStart(2, "0");
/** How long "Not <film>" stays under the guess line after a miss. */
const WHISPER_MS = 3600;

/** The play ended because the player gave up on the last reel rather than missing it. */
function gaveUp(state: State, status: string): boolean {
  const last = state.turns.at(-1);
  return status === "lost" && last !== undefined && isSkip(last);
}

/** What the last move did, in words: for the whisper under the guess line and screen readers. */
function lastMoveText(state: State): string | null {
  const last = state.turns.at(-1);
  if (!last) return null;
  if (isSkip(last)) return "Skipped";
  return last.correct ? null : `Not ${last.film.title}`;
}

/**
 * Fade to Color, full screen: a dark projection room lit only by today's film. The film's whole run
 * is on the reel as a barcode; each miss or skip unreels a level with more of the real picture.
 * Nothing else is on screen but the attempts: no clues of any kind.
 */
export function FadeToColorTheater(props: Props) {
  const { view, start, submitMove, pending, notice, date, friends, viewerId } = props;
  const status = view?.status ?? null;
  const playing = status === "in_progress";
  const finished = status === "won" || status === "lost";
  const state = view?.state ?? null;
  const turns = state?.turns ?? [];
  const levels = view ? (view.reveal?.levels ?? levelsInView(view.puzzle, view.state)) : [];
  const art = useLevelArt(levels);

  // The newest reel: the one being played, or the film's last once it's over (the payoff).
  const latest = finished ? LEVEL_COUNT - 1 : Math.max(0, levels.length - 1);

  // Looking back at an earlier reel lasts until the next one is earned.
  const [picked, setPicked] = useState<{ index: number; latest: number } | null>(null);
  const target = picked && picked.latest === latest && picked.index < levels.length ? picked.index : latest;

  // What the reel shows moves to the target once its art is in; how it gets there depends on why.
  const [rolled, setRolled] = useState(false);
  const [display, setDisplay] = useState<{ index: number; latest: number; move: ReelMove } | null>(null);
  const targetRef = levels[target];
  if (targetRef && art.has(targetRef.id) && (display === null || display.index !== target || display.latest !== latest)) {
    const earned = display !== null && target === latest && latest > display.latest;
    const move: ReelMove = display === null ? (rolled ? "unreel" : "cut") : earned ? "unreel" : display.index === target ? display.move : "cut";
    setDisplay({ index: target, latest, move });
  }
  const shownRef = display ? levels[display.index] : undefined;
  const shownArt = shownRef ? art.get(shownRef.id) : undefined;
  const waiting = view !== null && (!targetRef || !art.has(targetRef.id));

  // The room takes a reel's colours partway through its unreel (see `Reel`).
  const [litKey, setLitKey] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const litArt = litKey ? art.get(litKey) : undefined;
  const firstArt = levels[0] ? art.get(levels[0].id) : undefined;

  // "Not <film>" under the guess line for a moment after each miss.
  const [seenTurns, setSeenTurns] = useState(turns.length);
  const [whisper, setWhisper] = useState<string | null>(null);
  if (state && turns.length !== seenTurns) {
    setSeenTurns(turns.length);
    setWhisper(turns.length > seenTurns && playing ? lastMoveText(state) : null);
  }
  useEffect(() => {
    if (!whisper) return;
    const timer = setTimeout(() => setWhisper(null), WHISPER_MS);
    return () => clearTimeout(timer);
  }, [whisper, seenTurns]);

  const [error, setError] = useState<string | null>(null);
  async function send(move: { type: "guess" | "pick"; filmId: number } | { type: "skip" }): Promise<boolean> {
    setError(null);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  // ← and → step through the reels the player has seen, unless they're typing.
  useEffect(() => {
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!step) return;
      const next = Math.min(levels.length - 1, Math.max(0, target + step));
      if (next !== target) {
        event.preventDefault();
        setPicked({ index: next, latest });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, levels.length, target, latest]);

  const accent = litArt?.accent ?? HOUSE_ACCENT;
  const picking = playing && state !== null && awaitingPick(state);
  const attempt = turns.length + 1;
  const left = MAX_GUESSES - turns.length;
  const showing = display?.index ?? null;
  const creditsReady = finished && shownRef !== undefined && settledKey === shownRef.id && display?.index === latest;
  const reveal = view?.reveal ?? null;
  const quit = state && status ? gaveUp(state, status) : false;
  const today = formatPuzzleDate(date, { weekday: "short", month: "short", day: "numeric" });

  const pickedIt = state?.pick?.correct === true;
  const announcement = !state
    ? ""
    : finished && reveal
      ? `${pickedIt ? "You picked it at the end" : status === "won" ? `You named it on reel ${turns.length}` : quit ? "You gave up" : "Out of reels"}. The film was ${reveal.film.title}.`
      : picking
        ? `${lastMoveText(state) ?? ""}. Every reel is used. Final pick: choose one of ${OPTION_COUNT} films.`
        : turns.length > 0
          ? `${lastMoveText(state) ?? ""}. Reel ${attempt} of ${LEVEL_COUNT} is showing. ${left} ${left === 1 ? "reel" : "reels"} left.`
          : "";

  return (
    <div className={`${THEATER_FONT_VARS} ${styles.theater}`} style={{ "--accent": accent } as CSSProperties} data-finished={finished || undefined} data-picking={picking || undefined}>
      <div className={styles.room} aria-hidden>
        <Crossfade src={litArt?.bands || null} className={styles.wash} />
        <div className={styles.beam} />
        <div className={styles.vignette} />
        <div className={styles.grain} />
      </div>

      <header className={styles.top}>
        <Link href="/" className={styles.back} aria-label="Back to today's games">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span>Today</span>
        </Link>
        <LitTitle text={fadeToColor.name} fill={firstArt?.bands || null} as="h1" className={styles.wordmark} />
        <span className={styles.dateline}>{today}</span>
      </header>

      <main className={styles.stage}>
        <Reel
          frame={
            shownRef && shownArt
              ? {
                  key: shownRef.id,
                  src: shownArt.src,
                  accent: shownArt.accent,
                  alt: reveal
                    ? `Reel ${display!.index + 1} of ${LEVEL_COUNT} of ${reveal.film.title}`
                    : `Reel ${display!.index + 1} of ${LEVEL_COUNT}: today's film as a strip of color`,
                }
              : null
          }
          move={display?.move ?? "none"}
          edgeStart={`▸ ${fadeToColor.name} · ${today}`}
          edgeEnd={showing === null ? `Leader ◂ ${LEVEL_COUNT}` : `Reel ${pad(showing + 1)} ◂ ${LEVEL_COUNT}`}
          spill={litArt?.bands || null}
          reflection={litArt?.reflection || null}
          waiting={waiting && (rolled || playing || finished)}
          onLight={setLitKey}
          onSettled={setSettledKey}
          edgeBottom={
            reveal?.credit && (
              <a href={reveal.credit.url} target="_blank" rel="noreferrer">
                Frames · {reveal.credit.source} ↗
              </a>
            )
          }
          leader={<Leader />}
        />

        <section className={styles.console}>
          {!view && (
            <div className={styles.opening}>
              <ol className={styles.rules}>
                {fadeToColor.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button
                type="button"
                className={styles.roll}
                disabled={pending}
                onClick={async () => {
                  setRolled(true);
                  const result = await start();
                  if (!result.ok) setRolled(false);
                }}
              >
                {pending ? "Threading the film…" : "Roll film"}
              </button>
            </div>
          )}

          {view && !finished && (
            <>
              <ContactStrip
                thumbs={levels.map((l) => art.get(l.id)?.thumb)}
                showing={showing}
                current={playing ? latest : null}
                onPick={(index) => setPicked({ index, latest })}
              />
              <p className={styles.status}>
                {picking ? (
                  <>
                    Reel <em>{MAX_GUESSES}</em> of {MAX_GUESSES} <span className={styles.dot}>·</span> final pick
                  </>
                ) : (
                  <>
                    Reel <em>{attempt}</em> of {MAX_GUESSES} <span className={styles.dot}>·</span> <em>{left}</em> left
                  </>
                )}
                {showing !== null && showing !== latest && (
                  <button type="button" className={styles.toLatest} onClick={() => setPicked(null)}>
                    Back to reel {latest + 1} ▸
                  </button>
                )}
              </p>
              {picking && state && (
                <FinalPick
                  options={state.options}
                  guessedIds={guessedFilmIds(state)}
                  disabled={pending}
                  onPick={(film) => void send({ type: "pick", filmId: film.id })}
                />
              )}
              {playing && !picking && (
                <Slate
                  disabled={pending}
                  excludeIds={state ? guessedFilmIds(state) : []}
                  lastReel={turns.length === MAX_GUESSES - 1}
                  onGuess={(film: FilmSearchHit) => send({ type: "guess", filmId: film.id })}
                  onSkip={() => void send({ type: "skip" })}
                />
              )}
              <p className={styles.whisper} data-show={whisper ? "" : undefined} aria-hidden>
                {whisper ?? " "}
              </p>
            </>
          )}

          {finished && reveal && view?.result && (
            <>
              <ContactStrip thumbs={levels.map((l) => art.get(l.id)?.thumb)} showing={showing} current={null} onPick={(index) => setPicked({ index, latest })} />
              {/* Inert until the last reel has unreeled and the card has come up. */}
              <div className={styles.creditsWrap} data-show={creditsReady || undefined} inert={!creditsReady}>
                <Credits
                  film={reveal.film}
                  won={status === "won"}
                  pickedIt={pickedIt}
                  gaveUp={quit}
                  attempts={turns.length}
                  result={view.result}
                  fill={firstArt?.bands || null}
                  date={date}
                  friends={friends}
                  viewerId={viewerId}
                />
              </div>
            </>
          )}

          {(error ?? notice) && (
            <p role="alert" className={styles.alert}>
              {error ?? notice}
            </p>
          )}
        </section>
      </main>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** The screen before the film: academy leader, waiting for the projector. */
function Leader() {
  return (
    <div className={styles.leader} aria-hidden>
      <svg viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet">
        <line x1="0" y1="50" x2="300" y2="50" />
        <line x1="150" y1="0" x2="150" y2="100" />
        <circle cx="150" cy="50" r="38" />
        <circle cx="150" cy="50" r="31" />
        <text x="150" y="50" dominantBaseline="central" textAnchor="middle">
          {LEVEL_COUNT}
        </text>
      </svg>
    </div>
  );
}
