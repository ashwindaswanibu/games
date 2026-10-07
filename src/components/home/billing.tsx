import Link from "next/link";
import type { CSSProperties } from "react";
import type { HomeBilling } from "@/core/home-view";
import styles from "./chrome.module.css";

/**
 * Below the fold (§5.9): this week, billed like a film. The top three STARRING, the rest "with …
 * and …", each bucket's leader, the full board. The viewer is billed in vermilion.
 */
export function Billing({ billing }: { billing: HomeBilling }) {
  const stars = billing.week.slice(0, 3);
  const rest = billing.week.slice(3);
  return (
    <section className={styles.billing} aria-labelledby="home-billing" data-op="billing" data-comes-up="" style={{ "--i": 8 } as CSSProperties}>
      <div className={styles.billKicker}>
        <h2 id="home-billing" className={styles.billLabel}>
          This week
        </h2>
      </div>
      {stars.length === 0 ? (
        <p className={styles.billEmpty}>No points yet this week.</p>
      ) : (
        <>
          <p className={styles.starring} aria-hidden="true">
            Starring
          </p>
          <ol className={styles.stars}>
            {stars.map((s) => (
              <li key={`${s.rank}:${s.firstName}`} className={styles.star} data-you={s.isViewer ? "" : undefined}>
                <b>{s.firstName}</b>
                <span>
                  {s.points} pts{s.isViewer ? " · you" : ""}
                </span>
              </li>
            ))}
          </ol>
          {rest.length > 0 && (
            <p className={styles.with}>
              <i>with</i>{" "}
              {rest.map((s, i) => (
                <span key={`${s.rank}:${s.firstName}`} className={styles.withName} data-you={s.isViewer ? "" : undefined}>
                  {i > 0 && i === rest.length - 1 && (
                    <>
                      <i>and</i>{" "}
                    </>
                  )}
                  <b>{s.firstName}</b>
                  <sup>{s.points}</sup>
                  {i < rest.length - 2 ? ", " : " "}
                </span>
              ))}
            </p>
          )}
        </>
      )}
      {billing.todayWalled && <p className={styles.walled}>Today&apos;s points show once you finish a game.</p>}
      <div className={styles.leaders}>
        {billing.leaders.map((l) => (
          <span key={l.bucketName} className={styles.leader}>
            <b>{l.isViewer ? "You" : l.firstName}</b> {l.isViewer ? "lead" : "leads"} {l.bucketName}
          </span>
        ))}
        <Link href="/leaderboard?period=week" className={styles.full}>
          Full board ›
        </Link>
      </div>
    </section>
  );
}
