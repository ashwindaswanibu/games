import type { CSSProperties } from "react";
import type { HomeBucket } from "@/core/home-view";
import { BucketField, BucketTitle } from "./bucket-title";
import type { CutWord } from "./geometry";
import { BUCKET_TIER } from "./palette";
import styles from "./sheet.module.css";

/**
 * Buckets with no games for you yet (§5.8): each its own sheet with its title and gesture and
 * "In production." Cards side by side when the row has room, bands when it is tight (a container
 * query on the row's height), stacked bands on a phone. Never a fake game.
 */
export function InProduction({ buckets, cuts, words, vanishX }: { buckets: readonly HomeBucket[]; cuts: Readonly<Record<string, string>>; words: CutWord; vanishX: number }) {
  if (buckets.length === 0) return null;
  return (
    <div className={styles.wings} data-op="wings" data-comes-up="" style={{ "--i": 6 } as CSSProperties}>
      <div className={styles.wingsRow} data-n={buckets.length}>
        {buckets.map((b) => {
          const headingId = `bucket-${b.id}`;
          return (
            <section
              key={b.id}
              className={`${styles.sheet} ${styles.wing}`}
              aria-labelledby={headingId}
              data-bucket={b.id}
              data-tier={BUCKET_TIER[b.id]}
              data-sheet=""
              style={{ "--cut": cuts[b.id] } as CSSProperties}
            >
              <span className={styles.plate} aria-hidden="true" />
              <span className={styles.paper} aria-hidden="true" />
              <span className={styles.field} aria-hidden="true">
                <BucketField id={b.id} vanishX={vanishX} />
              </span>
              <div className={styles.wingBody}>
                <BucketTitle id={b.id} name={b.name} words={words} headingId={headingId} />
                <p className={styles.wingVoice}>In production.</p>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
