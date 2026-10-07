import { describe, expect, it } from "vitest";
import { exitBeats, letterStep, openingBeats } from "./timing";

describe("letterStep", () => {
  it("is the step while the wave fits, then shares the cap", () => {
    expect(letterStep(12, 45, 600)).toBe(45);
    expect(letterStep(41, 45, 600)).toBe(15);
    expect(letterStep(1, 45, 600)).toBe(0);
  });
});

describe("the win's beats", () => {
  it("lands the last letter of a short title before 3.9s, then holds 500ms", () => {
    // "Dune: Part Two": 12 letters, 45ms apart, 900ms each from 2.4s.
    const beats = openingBeats(12);
    expect(beats.lit).toBe(2400 + 11 * 45 + 900);
    expect(beats.hold).toBe(beats.lit + 500);
  });

  it("caps the colour's wave at 600ms, so even a long title is named by 3.9s and rolls on at 4.4s", () => {
    const beats = openingBeats(41);
    expect(beats.lit).toBe(3900);
    expect(beats.hold).toBe(4400);
  });

  it("rolls on as the spec times it: the room relights at 4.9s, the end card rises 5.0–6.3s and takes clicks at 5.0s", () => {
    const at = 4400;
    const x = exitBeats("roll", false);
    expect(at + x.light).toBe(4900);
    expect([at + x.creditsFrom, at + x.creditsTo]).toEqual([5000, 6300]);
    expect(at + x.interactive).toBe(5000);
    expect(at + x.cardGone).toBe(5650);
    expect(at + x.done).toBe(6300);
  });

  it("named on the last reel, lifts the card: the end card runs 4.8–6.0s, taking clicks at 4.8s", () => {
    const at = 4400;
    const x = exitBeats("lift", false);
    expect([at + x.creditsFrom, at + x.creditsTo]).toEqual([4800, 6000]);
    expect(at + x.interactive).toBe(4800);
    expect(at + x.cardGone).toBe(5600);
  });

  it("with reduced motion, crossfades for 500ms and takes clicks at 800ms", () => {
    const x = exitBeats("roll", true);
    expect(x.light).toBe(500);
    expect(x.interactive).toBe(800);
  });
});
