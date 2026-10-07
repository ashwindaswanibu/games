import Link from "next/link";
import type { CSSProperties } from "react";
import type { HomePrimary } from "@/core/home-view";
import { Arrow } from "./band";
import styles from "./chrome.module.css";

/**
 * Phone only (§5.6): when the primary's credit is not in the first open sheet, an ink slip under
 * the band holds the filled primary above the fold; the credit itself then shows its quiet action
 * (one filled thing per screen). Not inside any bucket's section.
 */
export function UpNext({ primary, gameName, cut }: { primary: HomePrimary; gameName: string | null; cut: string }) {
  const verb = primary.kind === "continue" ? "Continue" : primary.kind === "play" ? "Play" : "Today's standings";
  return (
    <aside className={styles.upNext} style={{ "--cut": cut } as CSSProperties} aria-label="Up next">
      <span className={styles.slipPlate} aria-hidden="true" />
      <span className={styles.slipPaper} aria-hidden="true" />
      <div className={styles.upNextBody}>
        <span className={styles.upNextText}>
          <span className={styles.upNextLbl}>{primary.kind === "standings" ? "All played" : "Up next"}</span>
          {gameName && <span className={styles.upNextName}>{gameName}</span>}
        </span>
        <Link href={primary.href} className={styles.upNextPill}>
          {verb}
          <Arrow />
        </Link>
      </div>
    </aside>
  );
}
