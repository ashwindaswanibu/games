import Link from "next/link";
import { Fragment, memo, type CSSProperties } from "react";
import type { HomeBilling } from "@/core/home-view";
import { walledNote } from "./format";
import styles from "./chrome.module.css";

/**
 * Below the fold (§5.9): this week, billed like a film. The top three STARRING, the rest "with …
 * and …", each bucket's leader, the full board. The viewer is billed in vermilion. Names are set
 * apart by space and their points, as on a billing block: no commas.
 */
export const Billing = memo(function Billing({ billing, liveGames, inert }: { billing: HomeBilling; liveGames: number; inert?: boolean }) {
  const stars = billing.week.slice(0, 3);
  const rest = billing.week.slice(3);
  const walled = walledNote(billing.walledGames, liveGames);
  return (
    <section
      className={styles.billing}
      aria-labelledby="home-billing"
      data-op="billing"
      data-comes-up=""
      style={{ "--i": 8 } as CSSProperties}
      inert={inert}
    >
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
              <li key={s.userId} className={styles.star} data-you={s.isViewer ? "" : undefined}>
                <b>{s.firstName}</b>
                <span>
                  {s.points} pts{s.isViewer ? " · you" : ""}
                </span>
              </li>
            ))}
          </ol>
          {rest.length > 0 && (
            <p className={styles.with}>
              <i>with</i>
              {rest.map((s, i) => (
                <Fragment key={s.userId}>
                  {" "}
                  {i > 0 && i === rest.length - 1 && (
                    <>
                      <i>and</i>{" "}
                    </>
                  )}
                  <span className={styles.withName} data-you={s.isViewer ? "" : undefined}>
                    <b>{s.firstName}</b>
                    <sup>{s.points}</sup>
                  </span>
                </Fragment>
              ))}
            </p>
          )}
        </>
      )}
      {walled && <p className={styles.walled}>{walled}</p>}
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
});
