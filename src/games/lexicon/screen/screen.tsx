"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DISPLAY_FONT_VARS } from "@/components/display-font";
import { formatPuzzleDate } from "@/core/day";
import type { ImmersiveGameUiProps } from "@/core/view";
import { describeGuess, gapOf, lexicon, pointsFor } from "../logic";
import { Book, type BookMode } from "./book";
import { Entry, EveryonePanel } from "./credits";
import { Tray } from "./tray";
import styles from "./screen.module.css";

type Props = ImmersiveGameUiProps<typeof lexicon>;

/** How long the book's live moments play (see the stylesheet). */
const MODE_MS: Record<Exclude<BookMode, "still">, number> = { opening: 1600, closing: 1800 };
/** After the book shuts live, the entry waits for it. */
const ENTRY_AFTER_MS = 1500;
/** How long a guess's result stays under the line. */
const WHISPER_MS = 3600;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The book before the play has started: closed, no index yet. */
const CLOSED_PAGES = 90;

/**
 * Lexicon, full screen: a dark study and one book, today's dictionary, seen from its fore-edge: a
 * page for every word the day's nine letters spell. Under it the letters themselves; a guess is set
 * from them. Each guess lays a red ribbon into the book at its page, and the pages today's word
 * can't be on fall into shadow, so the gap you have left is the light you have left. Finding the
 * word shuts the book on its page, and the book opens there: the word as the dictionary prints it.
 */
export function LexiconScreen(props: Props) {
  const { view, start, submitMove, pending, notice, date, friends, viewerId } = props;
  const status = view?.status ?? null;
  const playing = status === "in_progress";
  const finished = status === "won" || status === "lost";
  const puzzle = view?.puzzle ?? null;
  const state = view?.state ?? null;
  const reveal = view?.reveal ?? null;
  const guesses = state?.guesses ?? [];

  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(0);
  const [whisper, setWhisper] = useState<{ text: string; at: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // The book's live moments play only when they happen in front of the player, never on a reload.
  const [seenStatus, setSeenStatus] = useState(status);
  const [mode, setMode] = useState<BookMode>("still");
  const [entryUp, setEntryUp] = useState(finished);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (seenStatus === null && status === "in_progress") setMode("opening");
    if (seenStatus === "in_progress" && (status === "won" || status === "lost")) setMode("closing");
    if (status === "won" || status === "lost") setEntryUp(seenStatus !== "in_progress");
  }
  useEffect(() => {
    if (mode === "still") return;
    const timer = setTimeout(() => setMode("still"), MODE_MS[mode]);
    return () => clearTimeout(timer);
  }, [mode]);
  useEffect(() => {
    if (!finished || entryUp) return;
    const timer = setTimeout(() => setEntryUp(true), ENTRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [finished, entryUp]);
  useEffect(() => {
    if (!whisper) return;
    const timer = setTimeout(() => setWhisper(null), WHISPER_MS);
    return () => clearTimeout(timer);
  }, [whisper]);

  const gap = puzzle && state ? gapOf(puzzle, state) : null;
  const worth = pointsFor(guesses.length + 1);

  async function guess(word: string): Promise<boolean> {
    setError(null);
    const result = await submitMove({ type: "guess", word });
    if (!result.ok) {
      setError(result.message);
      setRefused((n) => n + 1);
      return false;
    }
    return true;
  }

  // Each new guess is told under the line and to screen readers.
  const [seenGuesses, setSeenGuesses] = useState(guesses.length);
  if (guesses.length !== seenGuesses) {
    setSeenGuesses(guesses.length);
    const last = guesses.at(-1);
    if (last && guesses.length > seenGuesses && puzzle && state) {
      const left = gapOf(puzzle, state).left;
      const text = last.side === "found" ? describeGuess(last) : `${describeGuess(last)}. ${plural(left, "word")} left.`;
      setWhisper({ text: last.side === "found" ? "" : describeGuess(last), at: guesses.length });
      setAnnouncement(text);
    }
  }

  async function giveUp() {
    setConfirmingGiveUp(false);
    setError(null);
    const result = await submitMove({ type: "give-up" });
    if (!result.ok) setError(result.message);
    else setAnnouncement("You gave up. The book opens at today's word.");
  }

  const today = formatPuzzleDate(date, { weekday: "short", month: "short", day: "numeric" });
  const listening = playing && !confirmingGiveUp && !everyone;

  return (
    <div className={`${DISPLAY_FONT_VARS} ${styles.screen}`} data-finished={finished || undefined}>
      <div className={styles.room} aria-hidden>
        <div className={styles.lamp} />
        <div className={styles.vignette} />
        <div className={styles.grain} />
      </div>

      <header className={styles.top} inert={everyone}>
        <Link href="/" prefetch={true} className={styles.back} aria-label="Back to today's games">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span>Today</span>
        </Link>
        <h1 className={styles.wordmark}>Lexicon</h1>
        <span className={styles.dateline}>
          {puzzle?.fixture && <span className={styles.fixture}>Dev fixture · </span>}
          {today}
        </span>
      </header>

      <main className={styles.stage} inert={everyone}>
        <div className={styles.bookArea}>
          <p className={styles.bookKicker}>
            {puzzle ? (
              <>
                Today&rsquo;s dictionary <span className={styles.dot}>·</span> {plural(puzzle.total, "word")} <span className={styles.dot}>·</span> today&rsquo;s word has{" "}
                {puzzle.length} letters
              </>
            ) : (
              "Today's dictionary"
            )}
          </p>
          {puzzle && state ? (
            <Book total={puzzle.total} tabs={puzzle.tabs} guesses={guesses} low={gap!.low} high={gap!.high} answer={finished && reveal ? reveal.page : null} mode={mode} />
          ) : (
            <Book total={CLOSED_PAGES} tabs={[]} guesses={[]} low={CLOSED_PAGES - 1} high={CLOSED_PAGES} answer={null} mode="still" />
          )}
          {playing && gap && (
            <p className={styles.count} aria-hidden>
              <em key={gap.left}>{gap.left}</em> {gap.left === 1 ? "word" : "words"} left
            </p>
          )}
        </div>

        <section className={styles.console}>
          {!view && (
            <div className={styles.opening}>
              <ol className={styles.rules}>
                {lexicon.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button
                type="button"
                className={styles.roll}
                disabled={pending || starting}
                onClick={async () => {
                  setStarting(true);
                  const result = await start();
                  if (!result.ok) setStarting(false);
                }}
              >
                {pending || starting ? "Opening today's dictionary…" : "Start guessing"}
              </button>
            </div>
          )}

          {playing && puzzle && (
            <>
              <p className={styles.status}>
                Guess <em>{guesses.length + 1}</em> <span className={styles.dot}>·</span> worth{" "}
                <em key={worth} className={styles.worth}>
                  {worth}
                </em>
              </p>
              {confirmingGiveUp ? (
                <div className={styles.confirm} role="group" aria-label="Give up?">
                  <p className={styles.confirmText}>Give up today&rsquo;s word? You&rsquo;ll score 0 and the book opens at it.</p>
                  <div className={styles.confirmActions}>
                    <button type="button" className={styles.quiet} onClick={() => setConfirmingGiveUp(false)} autoFocus>
                      Keep guessing
                    </button>
                    <button type="button" className={styles.go} onClick={() => void giveUp()} disabled={pending}>
                      Give up
                    </button>
                  </div>
                </div>
              ) : (
                <Tray letters={puzzle.letters} length={puzzle.length} disabled={pending} listening={listening} refused={refused} onGuess={guess} />
              )}
              <p className={styles.whisper} data-show={whisper?.text || error ? "" : undefined} aria-hidden>
                {error ?? whisper?.text ?? " "}
              </p>
              {!confirmingGiveUp && (
                <button type="button" className={`${styles.quiet} ${styles.giveUp}`} onClick={() => setConfirmingGiveUp(true)} disabled={pending}>
                  Give up
                </button>
              )}
            </>
          )}

          {finished && reveal && view?.result && (
            <div className={styles.entryWrap} data-show={entryUp || undefined} inert={!entryUp}>
              <Entry reveal={reveal} won={status === "won"} guesses={guesses.length} result={view.result} date={date} onEveryone={() => setEveryone(true)} />
            </div>
          )}

          {notice && (
            <p role="alert" className={styles.alert}>
              {notice}
            </p>
          )}
        </section>
      </main>

      {everyone && <EveryonePanel friends={friends} viewerId={viewerId} onClose={() => setEveryone(false)} />}

      <p className={styles.srOnly} role="status" aria-live="polite">
        {error ?? announcement}
      </p>
    </div>
  );
}
