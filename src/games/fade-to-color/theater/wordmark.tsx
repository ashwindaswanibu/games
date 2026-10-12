import type { CSSProperties } from "react";
import { barsFill, type Rgb } from "../palette";
import styles from "./theater.module.css";

/**
 * The wordmark: "Movie" in ink, "Barcode" pressed (owner's brief, 2026-10-11: the name of the
 * object, and the object's one rule is the identity). Both words are the same roman Bodoni, whose
 * thick stems and hairlines already read as a barcode, so no barcode is drawn. Before the film is in,
 * "Barcode" is plain ink. Once it is (`bars`, the first reel's columns), the last word is filled with
 * the film pressed into hard bars, five to a letter. `press` lays them down the way the film is
 * pressed into the strip as it's rolled: left to right, in the same 48 jumps at 24 frames a second,
 * behind a hairline head (see `.wordmark[data-press]`). Otherwise (opening the page mid-play) it is
 * simply lit. The visible words are hidden from screen readers; the heading reads its label once.
 */
export function Wordmark({ text, bars, press }: { text: string; bars: readonly Rgb[] | null; press: boolean }) {
  const cut = text.lastIndexOf(" ");
  const head = cut > 0 ? text.slice(0, cut) : "";
  const tail = cut > 0 ? text.slice(cut + 1) : text;
  const fill = barsFill(bars, tail, 5);

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
        <span className={styles.wmInk}>{tail}</span>
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

/** A whole title pressed into the film's bars, seven to a letter (the end card's film title); in ink with no `columns`. */
export function BarcodeTitle({ text, columns }: { text: string; columns: readonly Rgb[] | null }) {
  const fill = barsFill(columns, text, 7);
  return (
    <h2 className={styles.endTitle} data-lit={fill ? "" : undefined} style={fill ? ({ "--fill": fill } as CSSProperties) : undefined}>
      {text}
    </h2>
  );
}
