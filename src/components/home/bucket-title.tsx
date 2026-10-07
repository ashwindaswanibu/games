import type { BucketId } from "@/core/game";
import { Barrel, ConvergingLines, CutLetters, Spiral } from "./bucket-art";
import type { CutWord } from "./geometry";
import styles from "./sheet.module.css";

/**
 * A bucket's title with its one gesture (§5.4). The heading's text is the bucket's name exactly
 * ("Movies"), so the gesture is always a sibling of the h2, never inside it.
 * `where` is the sheet head or an In production card/band.
 */
export function BucketTitle({ id, name, words, headingId }: { id: BucketId; name: string; words: CutWord; headingId: string }) {
  switch (id) {
    case "words":
      return (
        <h2 id={headingId} className={styles.tWords}>
          <span className={styles.srOnly}>{name}</span>
          <CutLetters word={words} className={styles.wordsArt} />
        </h2>
      );
    case "movies":
      return (
        <span className={styles.tMoviesWrap}>
          <Barrel className={styles.barrel} />
          <h2 id={headingId} className={styles.tMovies}>
            {name}
          </h2>
        </span>
      );
    case "geography":
      return (
        <h2 id={headingId} className={styles.tGeo}>
          {name}
        </h2>
      );
    case "chess":
      return (
        <h2 id={headingId} className={styles.tChess}>
          {name}
        </h2>
      );
    default:
      return (
        <h2 id={headingId} className={styles.tChess}>
          {name}
        </h2>
      );
  }
}

/** The art laid across a head or card, clipped by its sheet (Geography's lines, Chess's spiral). */
export function BucketField({ id, vanishX }: { id: BucketId; vanishX: number }) {
  if (id === "geography") return <ConvergingLines className={styles.nxnw} vanishX={vanishX} />;
  if (id === "chess")
    return (
      <span className={styles.spiralBox} aria-hidden="true">
        <Spiral className={styles.spiral} />
      </span>
    );
  return null;
}
