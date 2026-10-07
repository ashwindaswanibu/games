import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swallowClickOf } from "./click-guard";

/** A window stand-in, and the events a browser sends it (PointerEvent isn't in Node). */
const pointer = (type: string, pointerId = 1) => Object.assign(new Event(type, { cancelable: true }), { pointerId });
const click = () => new Event("click", { cancelable: true });

/** Dispatches a click; true if the guard swallowed it. */
function swallowed(target: EventTarget): boolean {
  const event = click();
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("swallowClickOf", () => {
  let target: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
  });
  afterEach(() => vi.useRealTimers());

  it("swallows the tap's own click, right after its pointer lifts, and only that one", () => {
    swallowClickOf(pointer("pointerdown"), target);
    target.dispatchEvent(pointer("pointerup"));
    expect(swallowed(target)).toBe(true);
    expect(swallowed(target)).toBe(false);
  });

  it("goes soon after the pointer lifts when no click follows", () => {
    swallowClickOf(pointer("pointerdown"), target);
    target.dispatchEvent(pointer("pointerup"));
    vi.advanceTimersByTime(350);
    expect(swallowed(target)).toBe(false);
  });

  it("goes when the touch turns into a scroll (no click is coming)", () => {
    swallowClickOf(pointer("pointerdown"), target);
    target.dispatchEvent(pointer("pointercancel"));
    expect(swallowed(target)).toBe(false);
  });

  it("ignores other pointers lifting", () => {
    swallowClickOf(pointer("pointerdown", 1), target);
    target.dispatchEvent(pointer("pointercancel", 2));
    expect(swallowed(target)).toBe(true);
  });

  it("goes at the next press of a pointer or a key", () => {
    swallowClickOf(pointer("pointerdown"), target);
    target.dispatchEvent(pointer("pointerdown", 2));
    expect(swallowed(target)).toBe(false);

    swallowClickOf(pointer("pointerdown"), target);
    target.dispatchEvent(new Event("keydown"));
    expect(swallowed(target)).toBe(false);
  });

  it("never outlives its backstop, even if the pointer never lifts", () => {
    swallowClickOf(pointer("pointerdown"), target);
    vi.advanceTimersByTime(1500);
    expect(swallowed(target)).toBe(false);
  });
});
