import Link from "next/link";
import type { CSSProperties } from "react";
import type { HomeView } from "@/core/home-view";
import { BUCKET_COLOR } from "./palette";
import styles from "./title.module.css";

/**
 * The torn TODAY band (§5.2): the count, one cut chip per game (shape carries the state: filled,
 * half, outline), and the tail. When every game is finished the tail becomes the page's one filled
 * primary, "Today's standings". `pending` is a finished game whose set-in has not landed yet: the
 * band shows the day as it stood before it, and the set-in's final beat fills the chip.
 */
export function Band({
  progress,
  primary,
  streak,
  clip,
  rotate,
  pending,
  unavailable,
}: {
  progress: HomeView["progress"];
  primary: HomeView["primary"];
  streak: HomeView["viewer"]["streak"];
  clip: string;
  rotate: string;
  pending: string | null;
  unavailable: number;
}) {
  const { done, total, chips } = progress;
  const toPlay = Math.max(0, total - done - unavailable);
  const allDone = total > 0 && done === total;
  const started = chips.some((c) => c.state === "in_progress");
  const finishedIds = chips.filter((c) => c.state === "finished").map((c) => c.gameId);
  const live = chips.filter((c) => !c.testing);
  const testing = chips.filter((c) => c.testing);

  const tailNow = allDone ? null : toPlay === 0 ? "All played" : done === 0 && !started ? "Nothing played yet" : `${toPlay} to play`;
  const tailBefore = `${toPlay + 1} to play`;

  return (
    <div
      className={styles.band}
      style={{ "--band-deg": rotate, "--band-clip": clip } as CSSProperties}
      data-op="band"
      data-band-n=""
      data-pre-for={finishedIds.join(" ") || undefined}
      data-pending={pending ? "" : undefined}
    >
      <span className={styles.bandBg} aria-hidden="true" />
      <span className={styles.bandLbl} aria-hidden="true">
        Today
      </span>
      <span className={styles.bandN} aria-hidden="true">
        <span className={styles.stack}>
          <span data-n-now="">{done}</span>
          <span data-n-before="">{Math.max(0, done - 1)}</span>
        </span>
        <em>/{total}</em>
      </span>
      <span className={styles.srOnly}>{`${done} of ${total} played today.`}</span>
      {chips.length > 0 && (
        <span className={styles.chips} aria-hidden="true">
          {live.map((c) => (
            <Chip key={c.gameId} chip={c} pending={pending === c.gameId} />
          ))}
          {live.length > 0 && testing.length > 0 && <span className={styles.chipSep} />}
          {testing.map((c) => (
            <Chip key={c.gameId} chip={c} pending={pending === c.gameId} />
          ))}
        </span>
      )}
      <span className={`${styles.tail} ${styles.stack}`}>
        {tailNow ? (
          <span data-n-now="" className={styles.tailText}>
            {streak.atRisk && done === 0 && !started ? (
              <>
                <span className={styles.wide}>{tailNow}</span>
                <span className={styles.narrow}>Play today to keep it</span>
              </>
            ) : (
              tailNow
            )}
          </span>
        ) : (
          <Link href={primary?.href ?? "/leaderboard"} className={styles.standings} data-n-now="" data-primary="">
            Today&apos;s standings
            <Arrow />
          </Link>
        )}
        <span data-n-before="" className={styles.tailText} aria-hidden="true">
          {tailBefore}
        </span>
      </span>
    </div>
  );
}

function Chip({ chip, pending }: { chip: HomeView["progress"]["chips"][number]; pending: boolean }) {
  return (
    <i className={styles.chip} data-chip={chip.gameId} data-state={pending ? "pending" : chip.state} style={{ "--c": BUCKET_COLOR[chip.bucket] } as CSSProperties}>
      <b />
    </i>
  );
}

export function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 9 10" aria-hidden="true" focusable="false">
      <path d="M0 0L9 5L0 10Z" fill="currentColor" />
    </svg>
  );
}
