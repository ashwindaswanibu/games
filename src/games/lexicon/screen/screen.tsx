"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { DISPLAY_FONT_VARS } from "@/components/display-font";
import { formatPuzzleDate } from "@/core/day";
import type { ImmersiveGameUiProps } from "@/core/view";
import { describeGap, describeGuess, gapOf, lexicon, pointsFor } from "../logic";
import { Book, type BookMode } from "./book";
import { EveryonePanel } from "./credits";
import { RunningHead } from "./head";
import { DictionaryPage } from "./page";
import { Tray } from "./tray";
import styles from "./screen.module.css";

type Props = ImmersiveGameUiProps<typeof lexicon>;

/** How long the book takes to riffle open into today's dictionary (see the stylesheets). */
const OPENING_MS = 2100;
/** How long the book takes to shut on today's word, found or given up; then the page turns. */
const CLOSING_MS = { won: 1900, lost: 2300 } as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Lexicon, full screen: a dark study and one book, today's dictionary, standing on a desk and seen
 * from its fore-edge: a leaf for every word the day's nine letters spell. Over it, the gap's two
 * bounds as the page's guide words; under it, the letters themselves, from which a guess is set.
 * Each guess lays a red ribbon into the book at its page; the pages today's word can't be on fall
 * into shadow, and the book falls open at the pages still in play, the count stamped on them.
 * Finding the word shuts the book on its leaf, and the leaf turns to face the player as the
 * dictionary page: the word as the dictionary prints it.
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
  const [starting, setStarting] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // The book's live moments play only when they happen in front of the player, never on a reload.
  const [seenStatus, setSeenStatus] = useState(status);
  const [mode, setMode] = useState<BookMode>("still");
  const [entryUp, setEntryUp] = useState(finished);
  const [finishLive, setFinishLive] = useState(false);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (seenStatus === null && status === "in_progress") setMode("opening");
    if (seenStatus === "in_progress" && (status === "won" || status === "lost")) {
      setMode("closing");
      setFinishLive(true);
    }
    if (status === "won" || status === "lost") setEntryUp(seenStatus !== "in_progress");
  }
  const closingMs = CLOSING_MS[status === "lost" ? "lost" : "won"];
  useEffect(() => {
    if (mode === "still") return;
    const timer = setTimeout(() => setMode("still"), mode === "opening" ? OPENING_MS : closingMs);
    return () => clearTimeout(timer);
  }, [mode, closingMs]);
  useEffect(() => {
    if (!finished || entryUp) return;
    const timer = setTimeout(() => setEntryUp(true), closingMs);
    return () => clearTimeout(timer);
  }, [finished, entryUp, closingMs]);

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

  // Each new guess is told to screen readers; on screen the ribbon and the guide word tell it.
  const [seenGuesses, setSeenGuesses] = useState(guesses.length);
  if (guesses.length !== seenGuesses) {
    setSeenGuesses(guesses.length);
    const last = guesses.at(-1);
    if (last && guesses.length > seenGuesses && puzzle && state) {
      const left = gapOf(puzzle, state).left;
      const text = last.side === "found" ? describeGuess(last) : `${describeGuess(last)}. ${plural(left, "word")} left.`;
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
  const turned = finished && entryUp;

  return (
    <div
      className={`${DISPLAY_FONT_VARS} ${styles.screen}`}
      data-finished={finished ? status : undefined}
      data-arrival={!view || undefined}
      data-opening={mode === "opening" || undefined}
      data-turned={turned || undefined}
    >
      <div className={styles.room} aria-hidden>
        <div className={styles.lamp} />
        <div className={styles.vignette} />
        <div className={styles.dusk} />
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
          <RunningHead
            key={view ? "head-open" : "head-closed"}
            lowWord={gap?.lowWord ?? null}
            highWord={gap?.highWord ?? null}
            first={puzzle?.tabs[0]?.letter ?? null}
            last={puzzle?.tabs.at(-1)?.letter ?? null}
            describe={playing && puzzle && state ? describeGap(puzzle, state) : null}
          />
          {puzzle && state ? (
            <Book
              key="book-open"
              total={puzzle.total}
              tabs={puzzle.tabs}
              guesses={guesses}
              low={gap!.low}
              high={gap!.high}
              answer={finished && reveal ? reveal.page : null}
              mode={mode}
              turned={turned}
            />
          ) : (
            <Book key="book-closed" closed total={0} tabs={[]} guesses={[]} low={-1} high={0} answer={null} mode="still" />
          )}
        </div>

        <section className={styles.console}>
          {!view && (
            <div className={styles.opening}>
              <p className={styles.senses} lang="en">
                {lexicon.rules.map((rule, i) => (
                  <Fragment key={rule}>
                    {i > 0 && " "}
                    <span>
                      <b>{i + 1}</b> {rule}
                    </span>
                  </Fragment>
                ))}
              </p>
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
                {pending || starting ? "Opening today's dictionary…" : "Open today's dictionary"}
              </button>
            </div>
          )}

          {playing && puzzle && (
            <>
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
                <Tray
                  letters={puzzle.letters}
                  length={puzzle.length}
                  disabled={pending}
                  listening={listening}
                  refused={refused}
                  worth={worth}
                  onGuess={guess}
                  onGiveUp={() => setConfirmingGiveUp(true)}
                />
              )}
              <p className={styles.whisper} data-show={error ? "" : undefined} aria-hidden>
                {error ?? " "}
              </p>
            </>
          )}

          {notice && (
            <p role="alert" className={styles.alert}>
              {notice}
            </p>
          )}
        </section>

        {finished && reveal && view?.result && (
          <DictionaryPage
            reveal={reveal}
            won={status === "won"}
            guesses={guesses}
            total={puzzle!.total}
            lowWord={gap?.lowWord ?? null}
            highWord={gap?.highWord ?? null}
            result={view.result}
            date={date}
            show={entryUp}
            live={finishLive}
            onEveryone={() => setEveryone(true)}
          />
        )}
      </main>

      {everyone && <EveryonePanel friends={friends} viewerId={viewerId} onClose={() => setEveryone(false)} />}

      <p className={styles.srOnly} role="status" aria-live="polite">
        {error ?? announcement}
      </p>
    </div>
  );
}
