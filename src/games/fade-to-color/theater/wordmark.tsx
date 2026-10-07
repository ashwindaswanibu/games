import type { CSSProperties } from "react";
import styles from "./theater.module.css";

/** How dim the last letter of "Fade to" ends up: the first is full ink, each after it a step darker. */
const DARKEST = 0.5;

/**
 * The wordmark, as a dip to black (owner's pick, 2026-10-06): the name happens once in front of the
 * player. Before the film rolls, "Fade to" is in full ink and "Color" waits as a ghost in the dark.
 * When the first reel lights up (`fill`, today's barcode as light), "Fade to" fades down a step per
 * letter, a beat of black, and "Color" rises out of the dark filled with the film, with a soft halo.
 * `intro` plays that slowly, for the moment the player rolls the film; otherwise (opening the page
 * mid-play) it simply comes up. The visible layers are hidden from screen readers; the heading
 * reads its label once.
 */
export function Wordmark({ text, fill, intro }: { text: string; fill: string | null; intro: boolean }) {
  const cut = text.lastIndexOf(" ");
  const head = cut > 0 ? text.slice(0, cut) : "";
  const tail = cut > 0 ? text.slice(cut + 1) : text;
  const letters = [...head];
  const inked = letters.filter((ch) => ch.trim()).length;
  let n = 0;

  return (
    <h1
      className={styles.wordmark}
      aria-label={text}
      data-lit={fill ? "" : undefined}
      data-intro={intro || undefined}
      style={fill ? ({ "--fill": `url(${fill})` } as CSSProperties) : undefined}
    >
      {head && (
        <span className={styles.wmFade} aria-hidden>
          <span className={styles.wmSteps}>
            {letters.map((ch, i) => {
              if (!ch.trim()) return <span key={i}>{ch}</span>;
              const k = 1 - (1 - DARKEST) * (inked > 1 ? n++ / (inked - 1) : 0);
              return (
                <span key={i} style={{ opacity: k }}>
                  {ch}
                </span>
              );
            })}
          </span>
          <span className={styles.wmFull}>{head}</span>
        </span>
      )}
      <span className={styles.wmColor} aria-hidden>
        <span className={styles.wmGhost}>{tail}</span>
        <span className={styles.wmHalo}>{tail}</span>
        <span className={styles.wmLit}>{tail}</span>
      </span>
    </h1>
  );
}

/** A whole title filled with the barcode (the end card's film title). */
export function BarcodeTitle({ text, fill }: { text: string; fill: string | null }) {
  return (
    <h2 className={styles.endTitle} data-lit={fill ? "" : undefined} style={fill ? ({ "--fill": `url(${fill})` } as CSSProperties) : undefined}>
      {text}
    </h2>
  );
}
