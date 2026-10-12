"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FLIP_ID = "letter-flip";
const EASE = "cubic-bezier(.2,.8,.2,1)";
const SHUFFLE_EASE = "cubic-bezier(.65,0,.35,1)";
/** A glyph that seems to have jumped further than this was measured before a layout change: no flight. */
const STALE_PX = 900;

/** Where a glyph was laid out (page coordinates), whether it was showing, and its place in its row. */
interface Seen {
  x: number;
  y: number;
  hidden: boolean;
  pos: number;
}

/**
 * The letters travel. Every glyph in the tray is marked `data-flip`: `line:i` for letter `i` set in
 * the guess line, `cell:i` for its glyph in the row. After every render each glyph that moved
 * glides from where it was seen to its new place, by transform only (FLIP). A letter set in the
 * line flies up from its cell; one taken back flies home to its cell (several at once, right to
 * left); the line re-centres around them; a shuffle slides the row's glyphs to their new cells. A
 * glyph caught mid-flight by the next change carries on from where it is. When a played word
 * leaves the line (`playedRef`), its letters fade back into their cells instead of flying.
 * Reduced motion: everything is instant.
 */
export function useLetterFlip(rootRef: RefObject<HTMLElement | null>, playedRef: RefObject<boolean>): void {
  const last = useRef(new Map<string, Seen>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-flip]")];
    // Where each glyph still in flight is seen right now, before its flight is cut short: the next
    // one starts from there.
    const inFlight = new Map<HTMLElement, DOMRect>();
    for (const el of items) if (el.getAnimations().some((a) => a.id === FLIP_ID)) inFlight.set(el, el.getBoundingClientRect());
    for (const el of inFlight.keys()) for (const a of el.getAnimations()) if (a.id === FLIP_ID) a.cancel();

    const before = last.current;
    const now = measure(items);
    last.current = now;
    if (before.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      playedRef.current = false;
      return;
    }

    const played = playedRef.current;
    playedRef.current = false;
    // Letters going home together leave right to left: the last set goes first.
    const homing = items
      .map((el) => el.dataset.flip!)
      .filter((key) => key.startsWith("cell:") && before.get(key)?.hidden && !now.get(key)!.hidden)
      .sort((a, b) => (before.get(lineOf(b))?.pos ?? 0) - (before.get(lineOf(a))?.pos ?? 0));

    for (const el of items) {
      const key = el.dataset.flip!;
      const seen = now.get(key)!;
      if (seen.hidden) continue;
      let from: Seen | undefined;
      let timing: KeyframeAnimationOptions;
      if (key.startsWith("line:")) {
        // Re-centring in the line, or flying up into it from its cell.
        from = before.get(key) ?? before.get(`cell:${key.slice(5)}`);
        timing = { duration: 260, easing: EASE };
      } else if (homing.includes(key)) {
        if (played) {
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease", id: FLIP_ID });
          continue;
        }
        from = before.get(lineOf(key));
        timing = { duration: 220, easing: EASE, delay: homing.indexOf(key) * 20 };
      } else {
        // A cell's glyph only moves when the row is shuffled.
        from = before.get(key);
        timing = { duration: 380, easing: SHUFFLE_EASE, delay: seen.pos * 14 };
      }
      if (!from) continue;
      // A glyph in flight was seen at its old place plus as far as its flight had got.
      const flying = inFlight.get(el);
      const dx = from.x - seen.x + (flying ? flying.left + scrollX - seen.x : 0);
      const dy = from.y - seen.y + (flying ? flying.top + scrollY - seen.y : 0);
      if ((Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) || Math.abs(dx) > STALE_PX || Math.abs(dy) > STALE_PX) continue;
      el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "none" }], { ...timing, fill: "backwards", id: FLIP_ID });
    }
  });

  // A resize moves every glyph without anything having happened: note where they are now.
  useEffect(() => {
    const onResize = () => {
      const root = rootRef.current;
      if (root) last.current = measure([...root.querySelectorAll<HTMLElement>("[data-flip]")]);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [rootRef]);
}

const lineOf = (cellKey: string) => `line:${cellKey.slice(5)}`;

/** Where each glyph is laid out, in page coordinates, and whether its cell is empty (set in the line). */
function measure(items: readonly HTMLElement[]): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  const counts = { line: 0, cell: 0 };
  for (const el of items) {
    const key = el.dataset.flip!;
    const kind = key.startsWith("line:") ? "line" : "cell";
    const rect = el.getBoundingClientRect();
    seen.set(key, {
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      hidden: kind === "cell" && el.parentElement?.hasAttribute("data-set") === true,
      pos: counts[kind]++,
    });
  }
  return seen;
}
