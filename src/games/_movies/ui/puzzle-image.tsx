"use client";

import { useState } from "react";
import type { AssetRef } from "@/core/assets";
import { forgetAsset, useAssetSrc } from "@/lib/sealed-assets";
import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { useMoviesVariant, type MoviesVariant } from "./variant";

export interface PuzzleImageProps {
  /** An asset id the game has put in the player's view (puzzle, state or reveal). */
  asset: AssetRef;
  /** Describe what the image is for, not what it shows (that would give the answer away). */
  alt: string;
  /** Box aspect ratio; defaults to the asset's own, so stages of different sizes can share one box. */
  aspectRatio?: number;
  variant?: MoviesVariant;
  className?: string;
}

/**
 * A puzzle image, opened from its sealed copy (downloaded when the game opened; its key comes with
 * the view that shows it), else served by `/api/assets/[id]` (see `src/lib/sealed-assets.ts`).
 * Plain `<img>` on an object URL. Nothing is ever drawn over the picture; while it loads (or if it
 * fails) a note sits in the empty frame instead.
 */
export function PuzzleImage({ asset, alt, aspectRatio, variant, className = "" }: PuzzleImageProps) {
  const resolved = useMoviesVariant(variant);
  const [attempt, setAttempt] = useState(0);
  const opened = useAssetSrc(asset.id, attempt);
  const src = opened.src;
  // Load state is tracked per source so a new asset (or retry) starts from "loading".
  const [status, setStatus] = useState<{ src: string; state: "loaded" | "error" } | null>(null);
  const state = opened.failed ? "error" : src !== null && status?.src === src ? status.state : "loading";

  return (
    <figure
      data-variant={resolved}
      data-state={state}
      aria-busy={state === "loading"}
      className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.frame} ${className}`}
      style={{ aspectRatio: aspectRatio ?? asset.width / asset.height }}
    >
      {src !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- see the component comment
        <img
          src={src}
          data-asset={asset.id}
          alt={alt}
          width={asset.width}
          height={asset.height}
          decoding="async"
          draggable={false}
          // A decoded image can finish before onLoad attaches; catch that case here.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && status?.src !== src) setStatus({ src, state: "loaded" });
          }}
          onLoad={() => setStatus({ src, state: "loaded" })}
          onError={() => setStatus({ src, state: "error" })}
        />
      )}
      {state === "loading" && (
        <span className={styles.frameNote} aria-hidden>
          Loading
        </span>
      )}
      {state === "error" && (
        <span className={styles.frameNote} role="alert">
          This image didn&apos;t load.
          <button
            type="button"
            className={styles.button}
            data-kind="secondary"
            onClick={() => {
              forgetAsset(asset.id);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </span>
      )}
    </figure>
  );
}
