"use client";

import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { useMoviesVariant, type MoviesVariant } from "./variant";

/**
 * - `locked`: not revealed yet
 * - `current`: the stage being played now
 * - `seen`: revealed and passed without a verdict (e.g. a free stage)
 * - `missed`: revealed, then a wrong guess
 * - `skipped`: revealed, then skipped
 * - `solved`: the stage the film was named on
 */
export type RevealStepStatus = "locked" | "current" | "seen" | "missed" | "skipped" | "solved";

export interface RevealStep {
  /** e.g. "Frame 3" or "Palette". Read to screen readers; shown when `showLabels` is on. */
  label: string;
  status: RevealStepStatus;
}

export interface RevealStripProps {
  steps: readonly RevealStep[];
  /** The stage on screen, when the player can flip back through revealed stages. */
  selectedIndex?: number;
  /** Makes every revealed stage a button. Omit for a read-only strip. */
  onSelect?: (index: number) => void;
  /** Show each step's label under its number (short labels: "Palette", "Blur"). */
  showLabels?: boolean;
  /** Accessible name for the strip. */
  label?: string;
  variant?: MoviesVariant;
}

// Shape, not just color, carries each state.
const GLYPH: Record<RevealStepStatus, string> = { locked: "", current: "●", seen: "", missed: "✕", skipped: "»", solved: "✓" };
const SPOKEN: Record<RevealStepStatus, string> = {
  locked: "locked",
  current: "current",
  seen: "revealed",
  missed: "missed",
  skipped: "skipped",
  solved: "solved",
};

/** Stage progress as a strip of film frames between sprocket holes. */
export function RevealStrip({ steps, selectedIndex, onSelect, showLabels = false, label = "Reveals", variant }: RevealStripProps) {
  const resolved = useMoviesVariant(variant);
  return (
    <ol aria-label={label} data-variant={resolved} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.strip}`}>
      {steps.map((step, index) => {
        const content = (
          <>
            {GLYPH[step.status] && (
              <span className={styles.cellGlyph} aria-hidden>
                {GLYPH[step.status]}
              </span>
            )}
            <span className={styles.cellNumber} aria-hidden>
              {index + 1}
            </span>
            {showLabels && (
              <span className={styles.cellLabel} aria-hidden>
                {step.label}
              </span>
            )}
          </>
        );
        const name = `${step.label}: ${SPOKEN[step.status]}`;
        const interactive = onSelect !== undefined && step.status !== "locked";
        return (
          <li key={index} className={styles.stripItem} aria-current={step.status === "current" ? "step" : undefined}>
            {interactive ? (
              <button
                type="button"
                className={styles.cell}
                data-status={step.status}
                data-labelled={showLabels}
                aria-label={name}
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
              >
                {content}
              </button>
            ) : (
              <span className={styles.cell} data-status={step.status} data-labelled={showLabels} role="img" aria-label={name}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
