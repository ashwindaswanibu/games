"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { useShare } from "@/components/share-button";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
import { shareText } from "@/core/share";
import { lexicon, type LexiconGuess, type LexiconReveal } from "../logic";
import { WORDS_CREDIT } from "./credits";
import ui from "./screen.module.css";
import styles from "./page.module.css";

/** How long the lit leaf takes to turn and face the player as the page. */
const TURN_MS = 1100;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The page the book shut on, turned to face the player: today's word as the dictionary prints it.
 * Bone paper; the two closest guesses as its guide words and today's page number as its folio; the
 * headword, its part of speech in rubric and its sense; the sources' credit as its imprint. Found,
 * the player's red ribbon lies in it (given up, there's none). Under it, one row: the guesses as a
 * trail through the dictionary, the score, sharing (spoiler-free) and everyone's results.
 *
 * Seen live, the page starts as the lit leaf in the book, seen edge-on: it turns toward the player
 * and grows into the page, and the ink comes up on it. On a reload it is simply there.
 */
export function DictionaryPage(props: {
  reveal: LexiconReveal;
  won: boolean;
  guesses: readonly LexiconGuess[];
  /** Words in today's dictionary. */
  total: number;
  /** The gap's bounds when the play ended: the page's guide words. */
  lowWord: string | null;
  highWord: string | null;
  result: { score: number; label: string; shareGrid: string };
  date: PuzzleDate;
  /** Turned up: after the book has shut, or at once on a reload. */
  show: boolean;
  /** The play ended in front of the player: the page turns and its ink comes up. */
  live: boolean;
  onEveryone(): void;
}) {
  const { reveal, won, guesses, total, lowWord, highWord, result, date, show, live, onEveryone } = props;
  const { share, copied } = useShare(
    shareText({ appName: APP_NAME, gameName: lexicon.name, emoji: lexicon.emoji, date, label: result.label, score: result.score, grid: result.shareGrid }),
  );

  // The turn: the page starts where the lit leaf is, scaled to the book's height and turned so
  // far from the player that its width is the leaf's, then swings round to face them.
  const paperRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!live || !show || !paper || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const leaf = document.querySelector("[data-leaf]")?.getBoundingClientRect();
    if (!leaf || leaf.width === 0 || leaf.height === 0) return;
    const p = paper.getBoundingClientRect();
    const s = leaf.height / p.height;
    const dx = leaf.left + leaf.width / 2 - (p.left + p.width / 2);
    const dy = leaf.top + leaf.height / 2 - (p.top + p.height / 2);
    const angle = clamp((Math.acos(Math.min(1, leaf.width / (p.width * s))) * 180) / Math.PI, 62, 88);
    const depth = window.innerWidth < 720 ? 1000 : 1600;
    paper.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${s}) perspective(${depth}px) rotateY(${angle}deg)` },
        { transform: `translate3d(0, 0, 0) scale(1) perspective(${depth}px) rotateY(0deg)` },
      ],
      { duration: TURN_MS, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  }, [live, show]);

  return (
    <section className={styles.pageLayer} data-show={show || undefined} data-live={live || undefined} data-won={won || undefined} inert={!show} aria-label="Today's word">
      <div ref={paperRef} className={styles.paper}>
        <div className={styles.ink}>
          <p className={styles.runningHead}>
            <span>{lowWord}</span>
            <span className={styles.folio}>{reveal.page + 1}</span>
            <span>{highWord}</span>
          </p>
          <h2 className={styles.headword}>{reveal.answer}</h2>
          <p className={styles.sense}>
            <i>{reveal.entry.pos}</i> {reveal.entry.definition}
          </p>
          <span className={styles.spacer} />
          <p className={styles.imprint}>{WORDS_CREDIT}</p>
        </div>
        {won && <span className={styles.pageRibbon} aria-hidden />}
        <span className={styles.turnShade} aria-hidden />
      </div>

      <div className={styles.result}>
        <Trail guesses={guesses} total={total} answer={reveal.page} won={won} />
        <span className={styles.label}>
          {result.label} · {result.score} {result.score === 1 ? "point" : "points"}
        </span>
        <span className={styles.resultBreak} />
        <button type="button" className={`${ui.go} ${styles.share}`} onClick={() => void share()}>
          {copied ? "Copied" : "Share"}
        </button>
        <button type="button" className={ui.quiet} onClick={onEveryone} aria-haspopup="dialog">
          How everyone did
        </button>
      </div>
    </section>
  );
}

/** The guesses as ribbons along a line through today's dictionary, at their true places, and today's word's. */
function Trail({ guesses, total, answer, won }: { guesses: readonly LexiconGuess[]; total: number; answer: number; won: boolean }) {
  const at = (page: number) => ({ left: `${((page + 0.5) / total) * 100}%` }) as CSSProperties;
  return (
    <span className={styles.trail} role="img" aria-label="Your guesses through today's dictionary">
      {guesses
        .filter((g) => g.side !== "found")
        .map((g) => (
          <i key={g.word} style={at(g.page)} />
        ))}
      <b data-won={won || undefined} style={at(answer)} />
    </span>
  );
}
