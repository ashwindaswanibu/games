import type { CSSProperties } from "react";
import type { MarkModel } from "./mark-geometry";
import { U } from "./mark-geometry";
import styles from "./mark.module.css";

/**
 * The generic mark renderer: data in, SVG out (spec §6). Draws the empty form (dashed keylines) for
 * a game not yet finished, or the viewer's pieces for a finished one, in the colours of the sheet
 * it sits on (`--fink`, `--keyline`, set by the sheet's tier). Every piece is `data-piece=<slot>`
 * so the set-in can place it; the keylines and the result are separate groups so a credit can be
 * held in its pre-state.
 */
export function Mark({ model, label, className, style }: { model: MarkModel; label?: string; className?: string; style?: CSSProperties }) {
  const w = model.w * U;
  const h = model.h * U;
  return (
    <svg
      className={`${styles.mark} ${className ?? ""}`}
      viewBox={`0 0 ${w} ${h}`}
      style={{ "--mw": model.w, "--mh": model.h, ...style } as CSSProperties}
      data-finished={model.finished ? "" : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <g className={styles.keylines} data-keyline="">
        {model.joins
          .filter((j) => !j.done)
          .map((j, i) => (
            <path key={`j${i}`} d={j.d} className={styles.joinKey} />
          ))}
        {model.slots.map((s, i) => (
          <path key={i} d={s.keyline.d} className={styles.keyline} />
        ))}
      </g>
      {model.finished && (
        <g data-result="">
          {model.joins
            .filter((j) => j.done)
            .map((j, i) => (
              <path key={`j${i}`} d={j.d} className={styles.join} data-join="" />
            ))}
          {model.slots.map((s, i) =>
            s.unused ? <path key={`u${i}`} d={s.unused.d} className={s.unused.dot ? styles.dot : styles.unused} data-unused="" /> : null,
          )}
          {model.slots.map((s, i) =>
            s.piece ? (
              <g
                key={`p${i}`}
                data-piece={i}
                data-kind={s.piece.kind}
                className={styles[s.piece.kind]}
                style={{ rotate: `${s.piece.rotate.toFixed(2)}deg`, opacity: s.piece.opacity }}
              >
                {s.piece.kind === "earned" && <path d={s.piece.shape.d} className={styles.plate} />}
                <path d={s.piece.shape.d} className={styles.face} />
                {s.piece.shape.holes && <path d={s.piece.shape.holes} className={styles.holes} />}
              </g>
            ) : null,
          )}
        </g>
      )}
    </svg>
  );
}
