/**
 * Deterministic PRNG for puzzle generation. A game's generator receives an `Rng` seeded from
 * (secret, game id, date), so a given day's puzzle is reproducible on the server but cannot be
 * predicted by anyone reading the source code.
 *
 * Algorithm: sfc32 — tiny, fast, and statistically solid for non-cryptographic use.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Returns a shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

export type RngSeed = readonly [number, number, number, number];

export function createRng(seed: RngSeed): Rng {
  let [a, b, c, d] = seed.map((n) => n >>> 0);

  const nextUint32 = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };

  // Discard early outputs so similar seeds diverge.
  for (let i = 0; i < 15; i++) nextUint32();

  const next = () => nextUint32() / 4294967296;

  const int = (min: number, max: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    pick(items) {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      return items[int(0, items.length - 1)];
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
