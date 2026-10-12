import { describe, expect, it } from "vitest";
import { LAPTOP, lens, PHONE } from "./lens";

const BOTH = [
  ["laptop", LAPTOP],
  ["phone", PHONE],
] as const;

/** A spread of the gaps a play can pass through on its way down to one page, from every side. */
function gaps(total: number) {
  const step = Math.max(1, Math.round(total / 40));
  const out: { low: number; high: number }[] = [];
  for (let low = -1; low < total - 1; low += step) for (let high = total; high > low + 1; high -= step) out.push({ low, high });
  return out;
}

describe("lens", () => {
  it("is the plain book before any guess: every page the same width", () => {
    for (const [, o] of BOTH) {
      const l = lens(117, -1, 117, o);
      for (let i = 0; i <= 117; i++) expect(l.x(i)).toBeCloseTo(i / 117, 12);
      expect(l.gapFrom).toBe(0);
      expect(l.gapWidth).toBe(1);
    }
  });

  it("runs from 0 to 1 and never backwards", () => {
    for (const [, o] of BOTH)
      for (const total of [60, 117, 400])
        for (const { low, high } of gaps(total)) {
          const l = lens(total, low, high, o);
          expect(l.x(0)).toBe(0);
          expect(l.x(total)).toBe(1);
          const backwards = Array.from({ length: total }, (_, i) => i + 1).filter((i) => l.x(i) < l.x(i - 1));
          expect(backwards).toEqual([]);
        }
  });

  it("narrows the lit window as the words left fall, never widening it", () => {
    for (const [, o] of BOTH)
      for (const total of [60, 117, 400]) {
        let last = Infinity;
        for (let n = total; n >= 1; n--) {
          const width = lens(total, 0, n + 1, o).gapWidth;
          expect(width).toBeLessThanOrEqual(last);
          last = width;
        }
      }
  });

  it("never shows the gap smaller than its true share", () => {
    for (const [, o] of BOTH)
      for (const { low, high } of gaps(117)) expect(lens(117, low, high, o).gapWidth).toBeGreaterThanOrEqual((high - low - 1) / 117 - 1e-12);
  });

  it("keeps each ruled-out side at least minSide wide while there's room for both", () => {
    for (const [, o] of BOTH)
      for (const { low, high } of gaps(117)) {
        if (low < 0 || high >= 117) continue;
        const l = lens(117, low, high, o);
        if (1 - l.gapWidth < 2 * o.minSide) continue;
        expect(l.gapFrom).toBeGreaterThanOrEqual(o.minSide - 1e-12);
        expect(1 - l.gapFrom - l.gapWidth).toBeGreaterThanOrEqual(o.minSide - 1e-12);
      }
  });

  it("caps each page in play at maxLeaf", () => {
    for (const [, o] of BOTH)
      for (const { low, high } of gaps(117)) {
        const l = lens(117, low, high, o);
        for (let i = low + 1; i < high; i++) expect(l.pitch(i)).toBeLessThanOrEqual(o.maxLeaf + 1e-12);
      }
  });

  it("opens today's mid-game (4 left of 117, after page 3) to four wide leaves", () => {
    const l = lens(117, 3, 8, LAPTOP);
    expect(l.gapWidth * 1304).toBeGreaterThan(250);
    for (let i = 4; i < 8; i++) expect(l.pitch(i)).toBeCloseTo(l.gapWidth / 4, 12);
    expect(l.centre(4)).toBeCloseTo(l.gapFrom + l.gapWidth / 8, 12);
  });
});
