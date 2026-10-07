"use client";

import { useEffect, useRef } from "react";
import type { HomeCue } from "@/core/home-view";
import { BUCKET_RGB } from "./palette";
import styles from "./home.module.css";

const CUES: readonly HomeCue[] = ["morning", "afternoon", "night"];

/** The room's light for a cue: a tiny canvas, scaled to the viewport (no blur, never animated). */
function paintLight(cue: HomeCue): string {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 30;
  const g = c.getContext("2d");
  if (!g) return "";
  if (cue === "night") {
    // A vignette to 45% black at the corners.
    const v = g.createRadialGradient(24, 14, 9, 24, 15, 32);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,.45)");
    g.fillStyle = v;
    g.fillRect(0, 0, 48, 30);
  } else {
    // The window on the sun's side: east (left) in the morning, west (right) after noon.
    const sx = cue === "morning" ? -6 : 54;
    const gr = g.createRadialGradient(sx, -8, 0, sx, -8, 62);
    gr.addColorStop(0, "rgba(255,253,246,.55)");
    gr.addColorStop(0.55, "rgba(255,253,246,.12)");
    gr.addColorStop(1, "rgba(255,253,246,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 48, 30);
    const sh = g.createRadialGradient(48 - sx, 34, 0, 48 - sx, 34, 46);
    sh.addColorStop(0, "rgba(60,40,20,.08)");
    sh.addColorStop(1, "rgba(60,40,20,0)");
    g.fillStyle = sh;
    g.fillRect(0, 0, 48, 30);
  }
  return `url(${c.toDataURL()})`;
}

/**
 * The room (§5.12): one static layer per cue (ground + paper fibre), crossfaded by opacity only
 * when the light changes while the page is open, and the light canvas. `lit` is the layer on.
 */
export function Room({ lit, light, fadeMs }: { lit: HomeCue; light: HomeCue; fadeMs: number }) {
  const layers = useRef<Map<HomeCue, HTMLElement>>(new Map());
  const lightEl = useRef<HTMLDivElement>(null);
  const shown = useRef<HomeCue>(lit);

  useEffect(() => {
    const el = lightEl.current;
    if (el) el.style.backgroundImage = paintLight(light);
  }, [light]);

  useEffect(() => {
    const from = shown.current;
    shown.current = lit;
    if (from === lit || fadeMs <= 0) return;
    const a = layers.current.get(from);
    const b = layers.current.get(lit);
    if (!a || !b) return;
    const opts: KeyframeAnimationOptions = { duration: fadeMs, easing: "cubic-bezier(.4,0,.2,1)" };
    a.style.willChange = b.style.willChange = "opacity";
    const out = a.animate([{ opacity: 1 }, { opacity: 0 }], opts);
    const inn = b.animate([{ opacity: 0 }, { opacity: 1 }], opts);
    inn.onfinish = () => {
      a.style.willChange = b.style.willChange = "";
    };
    return () => {
      out.cancel();
      inn.cancel();
      a.style.willChange = b.style.willChange = "";
    };
  }, [lit, fadeMs]);

  return (
    <div className={styles.room} aria-hidden="true" data-room="">
      {CUES.map((c) => (
        <i
          key={c}
          className={styles.layer}
          data-c={c}
          data-on={c === lit ? "" : undefined}
          ref={(el) => {
            if (el) layers.current.set(c, el);
          }}
        />
      ))}
      <div className={styles.light} ref={lightEl} data-room-light="" />
    </div>
  );
}

/**
 * The night's light (§5.12), painted on a 64-wide canvas scaled to the stage: each sheet's colour
 * spills past its edges, and the dial's paper is the lamp. Painted on mount, when night falls, and
 * on resize (debounced); never animated.
 */
export function NightSpill({ night, className }: { night: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!night) return;
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const paint = () => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = Math.max(20, Math.round((64 * box.height) / box.width));
      const g = c.getContext("2d");
      if (!g) return;
      const glow = (r: DOMRect, rgb: string, alpha: number, k: number) => {
        const cx = ((r.left + r.width / 2 - box.left) / box.width) * c.width;
        const cy = ((r.top + r.height / 2 - box.top) / box.height) * c.height;
        const rad = (Math.max(r.width, r.height) / box.width) * c.width * k;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rad));
        gr.addColorStop(0, `rgba(${rgb},${alpha})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr;
        g.fillRect(0, 0, c.width, c.height);
      };
      stage.querySelectorAll<HTMLElement>("[data-sheet]").forEach((s) => {
        const rgb = BUCKET_RGB[s.dataset.bucket as keyof typeof BUCKET_RGB];
        if (rgb) glow(s.getBoundingClientRect(), rgb, 0.1, 0.9);
      });
      const num = stage.querySelector("[data-op='numeral']");
      if (num) glow(num.getBoundingClientRect(), BUCKET_RGB.words, 0.08, 0.7);
      const dial = stage.querySelector("[data-dial]");
      if (dial) {
        const r = dial.getBoundingClientRect();
        glow(new DOMRect(r.left - r.width, r.top - r.height, r.width * 3, r.height * 3), "224,165,62", 0.06, 1);
      }
      el.style.backgroundImage = `url(${c.toDataURL()})`;
    };
    paint();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(paint, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [night]);
  return <div ref={ref} className={className} aria-hidden="true" data-spill="" />;
}
