import { describe, expect, it } from "vitest";
import { createRng } from "./random";

describe("createRng", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = createRng([1, 2, 3, 4]);
    const b = createRng([1, 2, 3, 4]);
    const c = createRng([1, 2, 3, 5]);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });

  it("produces integers within inclusive bounds and covers the range", () => {
    const rng = createRng([9, 8, 7, 6]);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const n = rng.int(1, 10);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(10);
      seen.add(n);
    }
    expect(seen.size).toBe(10);
  });

  it("shuffles without losing or mutating items", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const shuffled = createRng([5, 5, 5, 5]).shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects invalid ranges", () => {
    expect(() => createRng([1, 1, 1, 1]).int(5, 1)).toThrow();
    expect(() => createRng([1, 1, 1, 1]).pick([])).toThrow();
  });
});
