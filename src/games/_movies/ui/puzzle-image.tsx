"use client";

import { useState } from "react";
import { assetUrl, type AssetRef } from "@/core/assets";
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
 * A puzzle image served by `/api/assets/[id]`. Plain `<img>`: the asset route authorizes with the
 * player's cookies, which the Next image optimizer wouldn't forward. Nothing is ever drawn over the
 * picture; while it loads (or if it fails) a note sits in the empty frame instead.
 */
export function PuzzleImage({ asset, alt, aspectRatio, variant, className = "" }: PuzzleImageProps) {
  const resolved = useMoviesVariant(variant);
  const [attempt, setAttempt] = useState(0);
  // Load state is tracked per source so a new asset (or retry) starts from "loading".
  const src = attempt === 0 ? assetUrl(asset.id) : `${assetUrl(asset.id)}?retry=${attempt}`;
  const [status, setStatus] = useState<{ src: string; state: "loaded" | "error" } | null>(null);
  const state = status?.src === src ? status.state : "loading";

  return (
    <figure
      data-variant={resolved}
      data-state={state}
      aria-busy={state === "loading"}
      className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.frame} ${className}`}
      style={{ aspectRatio: aspectRatio ?? asset.width / asset.height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see the component comment */}
      <img
        src={src}
        alt={alt}
        width={asset.width}
        height={asset.height}
        decoding="async"
        draggable={false}
        // A cached image can finish before hydration attaches onLoad; catch that case here.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && status?.src !== src) setStatus({ src, state: "loaded" });
        }}
        onLoad={() => setStatus({ src, state: "loaded" })}
        onError={() => setStatus({ src, state: "error" })}
      />
      {state === "loading" && (
        <span className={styles.frameNote} aria-hidden>
          Loading
        </span>
      )}
      {state === "error" && (
        <span className={styles.frameNote} role="alert">
          This image didn&apos;t load.
          <button type="button" className={styles.button} data-kind="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </span>
      )}
    </figure>
  );
}
