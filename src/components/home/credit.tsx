"use client";

import Link from "next/link";
import { useMemo, type MouseEvent } from "react";
import type { HomeGame } from "@/core/home-view";
import { Arrow } from "./band";
import { Mark } from "./mark";
import { buildMark } from "./mark-geometry";
import styles from "./sheet.module.css";

export type CreditPhase = "rest" | "pre";

/** The mark's accessible sentence: "Fade to Color: named on reel 3, 80 points". */
export function markSentence(game: HomeGame): string {
  if (game.state === "finished" && game.result) {
    const what = game.result.line ? lowerFirst(game.result.line) : game.result.label;
    return `${game.name}: ${what}, ${game.result.score} points`;
  }
  if (game.state === "in_progress") return `${game.name}: in progress`;
  if (game.state === "unavailable") return `${game.name}: not ready yet`;
  return `${game.name}: not played yet`;
}

/** The set-in's announcement: "Fade to Color: 3/10, named on reel 3, 80 points." */
export function resultSentence(game: HomeGame): string {
  if (!game.result) return markSentence(game);
  const { label, line, score } = game.result;
  return `${game.name}: ${labelText(label)}${line ? `, ${lowerFirst(line)}` : ""}, ${score} points.`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** A result label as the credit sets it: upper case ("3 LINKS · PAR 2", "GAVE UP"). */
export function labelText(label: string): string {
  return label.toUpperCase();
}

/**
 * One game's credit (§5.5): a single link wrapping the row (the hit area is the row; the pill is a
 * span, so nothing interactive nests). Line one: the name, a dotted leader, then the action or the
 * result label and points. Line two: the mark in the game's own form, the voice line, the meta.
 * The link's text always holds the name and the verb, and "Testing" for a game still in testing.
 */
export function Credit({
  game,
  date,
  primary,
  mixed,
  phase,
  onOpen,
}: {
  game: HomeGame;
  date: string;
  /** This game holds the page's one filled primary. */
  primary: boolean;
  /** Its bucket mixes live and testing games: a testing row carries its own chip. */
  mixed: boolean;
  phase: CreditPhase;
  onOpen?: (e: MouseEvent<HTMLAnchorElement>, game: HomeGame) => void;
}) {
  const model = useMemo(
    () => buildMark(game.form, game.state, game.result?.marks ?? null, `${date}:${game.id}`),
    [game.form, game.state, game.result, date, game.id],
  );
  const finished = game.state === "finished" && game.result !== null;
  const verb = game.state === "in_progress" ? "Continue" : "Play";

  let action = null;
  if (finished) {
    action = (
      <span className={styles.value} data-result="" data-op="label">
        <span className={styles.label}>{labelText(game.result!.label)}</span>
        <span className={styles.pts}>{game.result!.score} pts</span>
      </span>
    );
  } else if (game.state !== "unavailable") {
    action = primary ? (
      <span className={styles.pill} data-pill="">
        {verb}
        <Arrow />
      </span>
    ) : (
      <span className={styles.quiet}>{verb} ›</span>
    );
  }

  let voice: string | null;
  let meta: string | null = null;
  if (finished) {
    voice = game.result!.line;
    meta = "How everyone did ›";
  } else if (game.state === "unavailable") {
    voice = "Not ready yet.";
  } else {
    voice = game.tagline;
    if (game.state === "in_progress") meta = game.form.kind === "chain" && game.form.par !== null ? `In progress · par ${game.form.par}` : "In progress";
    else meta = game.finishedCount > 0 ? `${game.finishedCount} finished` : "No one yet";
  }

  return (
    <Link
      href={game.href}
      className={styles.credit}
      data-credit={game.id}
      data-state={game.state}
      data-primary={primary ? "" : undefined}
      data-phase={phase === "pre" ? "pre" : undefined}
      onClick={onOpen ? (e) => onOpen(e, game) : undefined}
    >
      <span className={styles.line1}>
        <span className={styles.name} data-op="name">
          {game.name}
        </span>
        {mixed && game.testing && (
          <span className={styles.tag} aria-hidden="true">
            Testing
          </span>
        )}
        {game.testing && <span className={styles.srOnly}> · Testing</span>}
        <span className={styles.leader} aria-hidden="true" />
        {action}
      </span>
      <span className={styles.line2}>
        <span className={styles.markSlot} data-op="mark">
          <Mark model={model} label={markSentence(game)} />
        </span>
        {voice && (
          <span className={styles.voice} data-result={finished ? "" : undefined} data-op="line">
            {voice}
          </span>
        )}
        {meta && (
          <span className={finished ? styles.how : styles.meta} data-result={finished ? "" : undefined} data-op={finished ? "how" : undefined}>
            {meta}
          </span>
        )}
      </span>
    </Link>
  );
}
