"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { formatPuzzleDate } from "@/core/day";
import type { Outcome } from "@/core/game";
import type { ImmersiveGameUiProps } from "@/core/view";
import type { FilmRef, FilmSearchHit } from "@/games/_movies/schemas";
import { fadeToColor, guessedFilmIds, isGuess, isSkip, LEVEL_COUNT, levelsInView, MAX_GUESSES, OPTION_COUNT, pickWorth, reelOf, stoppedEarly, type State } from "../logic";
import { ContactStrip } from "./contact-strip";
import { Credits } from "./credits";
import { Crossfade } from "./crossfade";
import { FourPick } from "./four-pick";
import { THEATER_FONT_VARS } from "./fonts";
import { endKicker } from "./grid";
import { Reel, type ReelMove } from "./reel";
import { FadingSlate, Slate } from "./slate";
import styles from "./theater.module.css";
import { HOUSE_ACCENT, useLevelArt } from "./use-level-art";
import { Wordmark } from "./wordmark";

type Props = ImmersiveGameUiProps<typeof fadeToColor>;

const pad = (n: number) => String(n).padStart(2, "0");
/** How long "Not <film>" stays under the guess line after a miss. */
const WHISPER_MS = 3600;
/** The stop, seen live, from the server's answer to the last tile up (see the stylesheet's `.four[data-live]`). */
const STOP_SEQUENCE_MS = 2400;
/** A pick's result lands no sooner than this after the press: the held beat in the dark. */
const PICK_BEAT_MS = 1200;
/** The four fade away (the stylesheet's `.four[data-leaving]`) while the film rolls on to its last reel. */
const FOUR_LEAVE_MS = 450;
/** Once the result has been read, the four wait at most this long for the last reel's picture before the film rolls on anyway. */
const LAST_REEL_WAIT_MS = 2500;

/**
 * A pick in flight. `waiting`: pressed, the other titles fading and the room dipping, the result
 * not yet shown. `landed`: the result is playing on the tiles. `held`: it has been read, and waits
 * for the last reel's picture. `leaving`: the four fade as the reel unreels to the last reel.
 * `gone`: the end card has the console.
 */
interface Resolve {
  filmId: number;
  pressedAt: number;
  result: { right: boolean; answerId: number } | null;
  stage: "waiting" | "landed" | "held" | "leaving" | "gone";
}

/** What the last move did, in words: for the whisper under the guess line and screen readers. */
function lastMoveText(state: State): string | null {
  const last = state.turns.at(-1);
  if (!last) return null;
  if (isSkip(last)) return "Skipped";
  return last.correct ? null : `Not ${last.film.title}`;
}

/** How the play ended, in a sentence, then the film. */
function endWords(state: State, status: Outcome, title: string): string {
  const how = state.pick && !state.pick.correct ? "Wrong pick" : status === "won" && !state.pick ? `You named it on reel ${state.turns.length}` : endKicker(state, status).replace(" · the film was", "");
  return `${how}. The film was ${title}.`;
}

/**
 * Fade to Color, full screen: a dark projection room lit only by today's film. The film's whole run
 * is on the reel as a barcode; each miss or skip unreels a level with more of the real picture.
 * Nothing else is on screen but the attempts: no clues of any kind.
 *
 * On any reel the player may stop the film instead: the unseen reels stay in the can and the four
 * come up (`FourPick`) for one pick, worth half of naming it on that reel. A wrong guess on the
 * last reel brings them up too (the run-out).
 */
export function FadeToColorTheater(props: Props) {
  const { view, start, submitMove, pending, notice, date, friends, viewerId } = props;
  const status = view?.status ?? null;
  const playing = status === "in_progress";
  const finished = status === "won" || status === "lost";
  const state = view?.state ?? null;
  const turns = state?.turns ?? [];
  const reveal = view?.reveal ?? null;

  // A pick plays out on the four before the film rolls on: the screen holds the play as it was
  // until the result has been shown (`over`), and the console until the four have gone (`ending`).
  const [resolve, setResolve] = useState<Resolve | null>(null);
  const over = finished && (resolve === null || resolve.stage === "leaving" || resolve.stage === "gone");
  const ending = finished && (resolve === null || resolve.stage === "gone");

  const inView = view ? levelsInView(view.puzzle, view.state) : [];
  // Every level is fetched once revealed (so the last reel is ready when the film rolls on), but
  // only those in view are shown until then.
  const levels = view ? (over && reveal ? reveal.levels : inView) : [];
  const art = useLevelArt(view ? (reveal?.levels ?? inView) : []);

  // The newest reel: the one being played, or the film's last once it's over (the payoff).
  const latest = over ? LEVEL_COUNT - 1 : Math.max(0, levels.length - 1);

  // Looking back at an earlier reel lasts until the next one is earned or the play ends.
  const [picked, setPicked] = useState<{ index: number; latest: number; over: boolean } | null>(null);
  const target = picked && picked.latest === latest && picked.over === over && picked.index < levels.length ? picked.index : latest;
  const lookAt = (index: number) => setPicked({ index, latest, over });

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

  // The stake for stopping ticks over once the newest reel has settled on screen.
  const attempt = turns.length + 1;
  const [stakeReel, setStakeReel] = useState<number | null>(null);
  if (playing && settledKey !== null && settledKey === levels[latest]?.id && stakeReel !== latest + 1) setStakeReel(latest + 1);

  // The four: up once the film is stopped (or ran out), until the end card takes the console.
  const fourUp = state !== null && state.options.length > 0 && !ending;
  const runOut = state !== null && fourUp && !stoppedEarly(state);
  const reel = state ? reelOf(state) : 1;
  const worth = pickWorth(reel);
  // The stop plays once, and only when it happens in front of the player: a reload shows the rest.
  const optionsUp = (state?.options.length ?? 0) > 0;
  const [seenUp, setSeenUp] = useState(optionsUp);
  const [stopLive, setStopLive] = useState(false);
  if (optionsUp !== seenUp) {
    setSeenUp(optionsUp);
    setStopLive(optionsUp && playing);
  }
  useEffect(() => {
    if (!stopLive) return;
    const timer = setTimeout(() => setStopLive(false), STOP_SEQUENCE_MS);
    return () => clearTimeout(timer);
  }, [stopLive]);
  const lastTurn = turns.at(-1);
  const missed = runOut && lastTurn && isGuess(lastTurn) ? lastTurn.film.title : null;

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
  async function send(move: { type: "guess" | "pick"; filmId: number } | { type: "skip" } | { type: "stop" }): Promise<boolean> {
    setError(null);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  async function pick(film: FilmRef) {
    setResolve({ filmId: film.id, pressedAt: performance.now(), result: null, stage: "waiting" });
    if (!(await send({ type: "pick", filmId: film.id }))) setResolve(null);
  }

  // The result lands at the later of the server's answer and the held beat after the press.
  const pickMade = state?.pick ?? null;
  const answerId = reveal?.film.id ?? null;
  useEffect(() => {
    if (resolve?.stage !== "waiting" || !pickMade || answerId === null) return;
    const result = { right: pickMade.correct, answerId };
    const timer = setTimeout(
      () => setResolve((r) => (r && r.stage === "waiting" ? { ...r, result, stage: "landed" } : r)),
      Math.max(0, PICK_BEAT_MS - (performance.now() - resolve.pressedAt)),
    );
    return () => clearTimeout(timer);
  }, [resolve, pickMade, answerId]);
  // The film rolls on once its last reel is ready to unreel (or after a while regardless: the reel
  // then waits at the gate), so the four never leave an empty console behind them.
  const lastLevel = reveal?.levels[LEVEL_COUNT - 1];
  const lastReady = lastLevel !== undefined && art.has(lastLevel.id);
  if (resolve?.stage === "held" && lastReady) setResolve({ ...resolve, stage: "leaving" });
  useEffect(() => {
    if (resolve?.stage !== "held") return;
    const timer = setTimeout(() => setResolve((r) => (r && r.stage === "held" ? { ...r, stage: "leaving" } : r)), LAST_REEL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [resolve]);
  useEffect(() => {
    if (resolve?.stage !== "leaving") return;
    const timer = setTimeout(() => setResolve((r) => (r && r.stage === "leaving" ? { ...r, stage: "gone" } : r)), FOUR_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [resolve]);

  // ← and → step through the reels the player has seen, unless they're typing or choosing a film.
  useEffect(() => {
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
      // Not while a dialog (everyone's results) is open over the reel, nor in the four.
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="radiogroup"]')) return;
      const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!step) return;
      const next = Math.min(levels.length - 1, Math.max(0, target + step));
      if (next !== target) {
        event.preventDefault();
        lookAt(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `lookAt` closes over `latest` and `over`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, levels.length, target, latest, over]);

  const accent = litArt?.accent ?? HOUSE_ACCENT;
  const left = MAX_GUESSES - turns.length;
  const showing = display?.index ?? null;
  const creditsReady = ending && shownRef !== undefined && settledKey === shownRef.id && display?.index === latest;
  // While a pick resolves the room dips; it relights as the film rolls on to its last reel.
  const dipped = resolve !== null && !(over && litKey !== null && litKey === levels[LEVEL_COUNT - 1]?.id);
  const today = formatPuzzleDate(date, { weekday: "short", month: "short", day: "numeric" });

  const guessed = new Map<number, number>();
  turns.forEach((turn, i) => {
    if (isGuess(turn)) guessed.set(turn.film.id, i + 1);
  });

  const edgeVariant = fourUp && !over ? (runOut ? "runout" : "held") : "count";
  const edgeEnd =
    showing === null
      ? `Leader ◂ ${LEVEL_COUNT}`
      : `Reel ${pad(showing + 1)} ◂ ${edgeVariant === "held" ? "Held" : edgeVariant === "runout" ? "Run-out" : LEVEL_COUNT}`;

  const announcement = !state
    ? ""
    : finished && reveal && (ending || resolve?.result)
      ? endWords(state, status!, reveal.film.title)
      : fourUp && !resolve
        ? runOut
          ? `${lastMoveText(state) ?? ""}. Out of reels. The four are up: one pick from ${OPTION_COUNT} films, worth ${worth} points.`
          : `Film stopped on reel ${reel}. The four are up: one pick from ${OPTION_COUNT} films, worth ${worth} points.`
        : playing && turns.length > 0 && !fourUp
          ? `${lastMoveText(state) ?? ""}. Reel ${attempt} of ${LEVEL_COUNT} is showing. ${left} ${left === 1 ? "reel" : "reels"} left.`
          : "";

  return (
    <div
      className={`${THEATER_FONT_VARS} ${styles.theater}`}
      style={{ "--accent": accent } as CSSProperties}
      data-finished={ending || undefined}
      data-four={fourUp || undefined}
      data-dip={dipped || undefined}
    >
      <div className={styles.room} aria-hidden>
        <div className={styles.washLight}>
          <Crossfade src={litArt?.bands || null} className={styles.wash} />
        </div>
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
        <Wordmark text={fadeToColor.name} fill={firstArt?.bands || null} intro={rolled} />
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
                  alt:
                    reveal && over
                      ? `Reel ${display!.index + 1} of ${LEVEL_COUNT} of ${reveal.film.title}`
                      : `Reel ${display!.index + 1} of ${LEVEL_COUNT}: today's film as a strip of color`,
                }
              : null
          }
          move={display?.move ?? "none"}
          edgeStart={`▸ ${fadeToColor.name} · ${today}`}
          edgeEnd={edgeEnd}
          edgeVariant={edgeVariant}
          spill={litArt?.bands || null}
          reflection={litArt?.reflection || null}
          waiting={waiting && (rolled || playing || finished)}
          onLight={setLitKey}
          onSettled={setSettledKey}
          edgeBottom={
            reveal?.credit &&
            over && (
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

          {view && (
            <ContactStrip
              thumbs={levels.map((l) => art.get(l.id)?.thumb)}
              showing={showing}
              current={over ? null : latest}
              closed={fourUp && !over}
              closing={stopLive}
              onPick={lookAt}
            />
          )}

          {view && !ending && (
            <>
              <p className={styles.status} data-leaving={resolve?.stage === "leaving" || undefined}>
                Reel <em>{fourUp ? reel : attempt}</em> of {MAX_GUESSES}{" "}
                {fourUp ? (
                  <span key="four" className={stopLive ? styles.statusFresh : undefined}>
                    <span className={styles.dot}>·</span> {runOut ? "run-out" : "stopped"}
                  </span>
                ) : (
                  <>
                    <span className={styles.dot}>·</span> <em>{left}</em> left
                  </>
                )}
                {target !== latest && (
                  <button type="button" className={styles.toLatest} onClick={() => setPicked(null)}>
                    Back to reel {latest + 1} ▸
                  </button>
                )}
              </p>
              {fourUp && state ? (
                <div className={styles.fourSlot}>
                  {stopLive && <FadingSlate reel={reel} worth={worth} lastReel={reel === LEVEL_COUNT} missed={missed} />}
                  <FourPick
                    options={state.options}
                    guessed={guessed}
                    worth={worth}
                    disabled={pending}
                    live={stopLive}
                    fill={firstArt?.bands || null}
                    resolve={resolve && { filmId: resolve.filmId, result: resolve.result, leaving: resolve.stage === "leaving" }}
                    onPick={(film) => void pick(film)}
                    onDone={() => setResolve((r) => (r && r.stage === "landed" ? { ...r, stage: "held" } : r))}
                  />
                </div>
              ) : (
                playing &&
                state && (
                  <Slate
                    disabled={pending}
                    excludeIds={guessedFilmIds(state)}
                    reel={attempt}
                    lastReel={turns.length === MAX_GUESSES - 1}
                    stake={pickWorth(attempt)}
                    stakeReady={stakeReel === attempt}
                    onGuess={(film: FilmSearchHit) => send({ type: "guess", filmId: film.id })}
                    onSkip={() => void send({ type: "skip" })}
                    onStop={() => void send({ type: "stop" })}
                  />
                )
              )}
              {!fourUp && (
                <p className={styles.whisper} data-show={whisper ? "" : undefined} aria-hidden>
                  {whisper ?? " "}
                </p>
              )}
            </>
          )}

          {ending && reveal && view?.result && state && status && (
            // Inert until the last reel has unreeled and the card has come up.
            <div className={styles.creditsWrap} data-show={creditsReady || undefined} inert={!creditsReady}>
              <Credits film={reveal.film} state={state} status={status} result={view.result} fill={firstArt?.bands || null} date={date} friends={friends} viewerId={viewerId} />
            </div>
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
