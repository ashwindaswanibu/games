"use client";

import { memo, type CSSProperties, type MouseEvent } from "react";
import type { HomeBucket, HomeGame } from "@/core/home-view";
import { BucketField, BucketTitle } from "./bucket-title";
import type { CutWord } from "./geometry";
import { Credit, type CreditPhase } from "./credit";
import { buildMark } from "./mark-geometry";
import { BUCKET_TIER } from "./palette";
import paper from "./paper.module.css";
import styles from "./sheet.module.css";

/**
 * One bucket's sheet of coloured paper (§5.3): a seeded cut with a torn foot, its plate shadow and
 * fibre; the head (title, one gesture, kicker); a rule; the credits. Never a web card: no radius,
 * no border, no box-shadow.
 */
export const Sheet = memo(function Sheet({
  bucket,
  date,
  cut,
  words,
  vanishX,
  primaryId,
  phaseOf,
  onOpen,
  index,
}: {
  bucket: HomeBucket;
  date: string;
  cut: string;
  words: CutWord;
  vanishX: number;
  primaryId: string | null;
  phaseOf: (gameId: string) => CreditPhase;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, game: HomeGame) => void;
  index: number;
}) {
  const headingId = `bucket-${bucket.id}`;
  // One mark column per sheet, as wide as its widest mark (the dense layout lines the names up on it).
  const markCol = Math.max(...bucket.games.map((g) => buildMark(g.form, g.state, g.result?.marks ?? null, "w").w));
  const mixed = bucket.games.some((g) => g.testing) && bucket.games.some((g) => !g.testing);
  const kicker = bucket.testingOnly
    ? "Testing · admins only"
    : bucket.leader
      ? bucket.leader.isViewer
        ? "You lead the week"
        : `${bucket.leader.firstName} leads the week`
      : null;

  return (
    <section
      className={`${styles.sheet} ${paper[bucket.id]}`}
      aria-labelledby={headingId}
      data-bucket={bucket.id}
      data-tier={BUCKET_TIER[bucket.id]}
      data-sheet=""
      data-comes-up=""
      style={{ "--cut": cut, "--i": index + 1, "--mark-col": markCol.toFixed(2) } as CSSProperties}
    >
      <span className={styles.plate} aria-hidden="true" />
      <span className={styles.paper} aria-hidden="true" />
      <span className={styles.field} aria-hidden="true">
        <BucketField id={bucket.id} vanishX={vanishX} />
      </span>
      <div className={styles.body}>
        <div className={styles.head}>
          <BucketTitle id={bucket.id} name={bucket.name} words={words} headingId={headingId} />
          {kicker && <span className={styles.kicker}>{kicker}</span>}
        </div>
        <div className={styles.credits} data-count={bucket.games.length}>
          {bucket.games.map((g) => (
            <Credit key={g.id} game={g} date={date} primary={g.id === primaryId} mixed={mixed} phase={phaseOf(g.id)} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </section>
  );
});
