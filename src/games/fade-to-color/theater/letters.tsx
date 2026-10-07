import type { CSSProperties } from "react";
import styles from "./theater.module.css";

/**
 * A line of text as one span per letter, so it can fade letter by letter (as the wordmark's "Fade
 * to" does). Each letter carries `--i`, its place among the letters, and the whole carries `--n`,
 * how many there are; the stylesheet staggers by them. Words don't break inside, so the line wraps
 * as the plain text would.
 */
export function Letters({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  let i = 0;
  const parts = text.split(/(\s+)/);
  const n = [...text].filter((ch) => ch.trim()).length;
  return (
    <span className={className} style={{ ...style, "--n": Math.max(1, n) } as CSSProperties}>
      {parts.map((part, p) =>
        /^\s*$/.test(part) ? (
          part
        ) : (
          <span key={p} className={styles.word}>
            {[...part].map((ch, c) => (
              <span key={c} className={styles.letter} style={{ "--i": i++ } as CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}
