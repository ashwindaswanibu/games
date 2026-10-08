"use client";

import Link from "next/link";
import { memo, type CSSProperties, type MouseEvent } from "react";
import type { HomeGame, HomePrimary } from "@/core/home-view";
import { Arrow } from "./band";
import styles from "./chrome.module.css";

/**
 * Phone only (§5.6): when the primary's credit is not the first on the page (another sheet, or a
 * later row of the first), an ink slip under the band holds the filled primary above the fold; the
 * credit itself then shows its quiet action (one filled thing per screen). Not inside any bucket's
 * section.
 */
export const UpNext = memo(function UpNext({
  primary,
  game,
  cut,
  onOpen,
}: {
  primary: HomePrimary;
  game: HomeGame | null;
  cut: string;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, game: HomeGame) => void;
}) {
  const gameName = game?.name ?? null;
  const verb = primary.kind === "continue" ? "Continue" : primary.kind === "play" ? "Play" : "Today's standings";
  return (
    <aside className={styles.upNext} style={{ "--cut": cut, "--sheet": "var(--sheet-ink)", "--fink": "var(--sheet-cream)" } as CSSProperties} aria-label="Up next" data-sheet="">
      <span className={styles.slipPlate} aria-hidden="true" />
      <span className={styles.slipPaper} aria-hidden="true" />
      <div className={styles.upNextBody}>
        <span className={styles.upNextText}>
          <span className={styles.upNextLbl}>{primary.kind === "standings" ? "All played" : "Up next"}</span>
          {gameName && <span className={styles.upNextName}>{gameName}</span>}
        </span>
        <Link href={primary.href} prefetch={true} className={styles.upNextPill} data-primary-action="" onClick={game ? (e) => onOpen(e, game) : undefined}>
          {verb}
          <Arrow />
        </Link>
      </div>
    </aside>
  );
});
