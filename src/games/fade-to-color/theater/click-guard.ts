/**
 * How long after the pointer lifts its click may still come: a tap's comes right after it, though
 * some touch browsers take a moment. Waiting a little longer costs nothing, since any later press
 * takes the guard down at once.
 */
const CLICK_AFTER_UP_MS = 300;
/** A backstop: the guard never outlives this. */
const GUARD_MAX_MS = 1500;

/**
 * Swallows the click that follows `down` (a pointerdown already acted on, whose click would land on
 * whatever is under it by then), and only that click. The guard goes once it has caught it, once
 * the gesture ends without one (the pointer lifts and no click follows, or the touch turns into a
 * scroll), or at the next press of a pointer or a key. Listens on `target` (the window) in capture.
 */
export function swallowClickOf(down: { pointerId: number }, target: EventTarget = window): void {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    disarm();
  };
  const ended = (event: Event) => {
    if ((event as PointerEvent).pointerId !== down.pointerId) return;
    if (event.type === "pointercancel") disarm();
    else setTimeout(disarm, CLICK_AFTER_UP_MS);
  };
  const backstop = setTimeout(disarm, GUARD_MAX_MS);
  const listeners: [string, (event: Event) => void][] = [
    ["click", stop],
    ["pointerup", ended],
    ["pointercancel", ended],
    ["pointerdown", disarm],
    ["keydown", disarm],
  ];
  function disarm() {
    clearTimeout(backstop);
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, { capture: true });
  }
  // Added while `down` is being dispatched, so it doesn't reach them itself.
  for (const [type, listener] of listeners) target.addEventListener(type, listener, { capture: true });
}
