"use client";

import { useState } from "react";
import styles from "./theater.module.css";

/**
 * A background image that fades into the next one instead of switching: the old layer stays
 * underneath until the new one has faded in over it. Opacity only, so it's cheap to animate.
 */
export function Crossfade({ src, className }: { src: string | null; className: string }) {
  const [layers, setLayers] = useState({ prev: null as string | null, cur: src });
  if (layers.cur !== src) setLayers({ prev: layers.cur, cur: src });
  return (
    <>
      {layers.prev && <div key={layers.prev} className={className} style={{ backgroundImage: `url(${layers.prev})` }} aria-hidden />}
      {layers.cur && (
        <div
          key={layers.cur}
          className={`${className} ${styles.fadeIn}`}
          style={{ backgroundImage: `url(${layers.cur})` }}
          onAnimationEnd={() => setLayers((l) => ({ ...l, prev: null }))}
          aria-hidden
        />
      )}
    </>
  );
}
