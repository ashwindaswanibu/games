import type { CSSProperties } from "react";
import { barsFill, inkSlit, type Rgb } from "../palette";
import styles from "./theater.module.css";

/** Bars a letter in the wordmark, and the ink it's printed in before the film is in. */
const BARS_PER_LETTER = 6;
const INK: Rgb = [239, 233, 223];

/**
 * The wordmark: "Movie" in ink, "Barcode" printed as a barcode (owner, 2026-10-12: "more of a
 * barcode feel"). Both words are the same roman Bodoni. "Barcode" is cut into bars of a barcode's
 * widths with slits between them (`barRhythm`): in ink before the film is in, then in the film's
 * own colours (`bars`, the first reel's columns) through the same bars. `press` lays the colours
 * down the way the film is pressed into the strip as it's rolled: left to right, in the same 48
 * jumps at 24 frames a second, behind a hairline head (see `.wordmark[data-press]`). Otherwise
 * (opening the page mid-play) it is simply lit. The visible words are hidden from screen readers;
 * the heading reads its label once.
 */
export function Wordmark({ text, bars, press }: { text: string; bars: readonly Rgb[] | null; press: boolean }) {
  const cut = text.lastIndexOf(" ");
  const head = cut > 0 ? text.slice(0, cut) : "";
  const tail = cut > 0 ? text.slice(cut + 1) : text;
  // Printed as a barcode: bars of a barcode's widths with slits between, in ink until the film is in.
  const fill = barsFill(bars, tail, BARS_PER_LETTER, { slit: true });
  const ink = inkSlit(tail, BARS_PER_LETTER, INK);

  return (
    <h1 className={styles.wordmark} aria-label={text} data-lit={fill ? "" : undefined} data-press={press && fill ? "" : undefined}>
      {head && (
        <>
          <span className={styles.wmMovie} aria-hidden>
            {head}
          </span>{" "}
        </>
      )}
      <span className={styles.wmBar} aria-hidden>
        <span className={styles.wmInk} style={{ "--slit": ink } as CSSProperties}>
          {tail}
        </span>
        {fill && (
          <span className={styles.wmPress}>
            <span className={styles.wmLit} style={{ "--fill": fill } as CSSProperties}>
              {tail}
            </span>
          </span>
        )}
      </span>
    </h1>
  );
}

/** A whole title printed as the film's barcode, seven bars to a letter with slits between (the end card's film title); in ink with no `columns`. */
export function BarcodeTitle({ text, columns }: { text: string; columns: readonly Rgb[] | null }) {
  const fill = barsFill(columns, text, 7, { slit: true });
  return (
    <h2 className={styles.endTitle} data-lit={fill ? "" : undefined} style={fill ? ({ "--fill": fill } as CSSProperties) : undefined}>
      {text}
    </h2>
  );
}
