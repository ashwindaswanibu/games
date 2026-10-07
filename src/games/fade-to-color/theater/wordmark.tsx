import type { CSSProperties } from "react";
import styles from "./theater.module.css";

/**
 * The game's name as a lockup: the last word in italic, filled with today's barcode as light once
 * the film is rolling (`fill`, from `litBands`), dim and unlit before. Also used for the end title.
 */
export function LitTitle({ text, fill, as: Tag = "span", className }: { text: string; fill: string | null; as?: "span" | "h1" | "h2"; className?: string }) {
  const cut = text.lastIndexOf(" ");
  const head = cut > 0 ? text.slice(0, cut + 1) : "";
  const tail = cut > 0 ? text.slice(cut + 1) : text;
  return (
    <Tag className={`${styles.litTitle} ${className ?? ""}`} data-lit={fill ? "" : undefined}>
      {head}
      {/* The lit copy is drawn by `::after` from `data-text`, so the word is in the page only once. */}
      <i className={styles.litWord} data-text={tail} style={fill ? ({ "--fill": `url(${fill})` } as CSSProperties) : undefined}>
        {tail}
      </i>
    </Tag>
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
