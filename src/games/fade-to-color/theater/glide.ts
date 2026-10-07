"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const GLIDE_MS = 1400;
const GLIDE_EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * When the page's layout changes (`layout`: the four come up, the end card takes the console), the
 * reel and the console glide from where they were into their new places: FLIP, by transform only,
 * so nothing is laid out frame by frame. `scaled` (the reel) also eases its size; `moved` (the
 * console) only its position. Where they were is noted after every render (and on resize), so a
 * change animates from the last place the player saw. Reduced motion, or `instant`, snaps.
 */
export function useGlide(layout: string, scaled: RefObject<HTMLElement | null>, moved: RefObject<HTMLElement | null>, instant: RefObject<boolean>): void {
  const last = useRef<{ layout: string; boxes: (DOMRect | null)[] } | null>(null);

  useLayoutEffect(() => {
    const els = [scaled.current, moved.current];
    const before = last.current;
    if (before && before.layout !== layout && !instant.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach((el, i) => {
        const first = before.boxes[i];
        if (!el || !first) return;
        for (const anim of el.getAnimations()) if (anim.id === "glide") anim.cancel();
        const now = el.getBoundingClientRect();
        const dx = first.left - now.left;
        const dy = first.top - now.top;
        const scale = i === 0 && now.width > 0 ? first.width / now.width : 1;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.001) return;
        const glide = el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})` }, { transform: "none" }], { duration: GLIDE_MS, easing: GLIDE_EASE });
        glide.id = "glide";
      });
    }
    last.current = { layout, boxes: els.map((el) => el?.getBoundingClientRect() ?? null) };
  });

  useEffect(() => {
    const onResize = () => {
      if (last.current) last.current.boxes = [scaled.current, moved.current].map((el) => el?.getBoundingClientRect() ?? null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scaled, moved]);
}
