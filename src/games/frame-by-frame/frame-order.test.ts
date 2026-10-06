import { describe, expect, it } from "vitest";
import { dedupe, differenceHash, easiness, hammingDistance, imageStats, isEligible, orderFrames, type FrameCandidate } from "./frame-order";

const stats = { entropy: 6, brightness: 0.5, colorfulness: 60 };
/** Distinct hashes: each candidate's differs from the others' by 16+ bits. */
const HASHES = ["0000000000000000", "ffff000000000000", "0000ffff00000000", "00000000ffff0000", "000000000000ffff", "ff00ff00ff00ff00", "00ff00ff00ff00ff", "ffffffffffffffff"];

function candidate(n: number, overrides: Partial<FrameCandidate> = {}): FrameCandidate {
  return { key: `/still-${n}.jpg`, width: 1920, height: 1080, language: null, voteAverage: 5, voteCount: n, hash: HASHES[n % HASHES.length], stats, ...overrides };
}

describe("imageStats", () => {
  it("measures a flat gray image as zero-entropy, mid-bright and colourless", () => {
    const gray = new Uint8Array(30).fill(128);
    const s = imageStats(gray);
    expect(s.entropy).toBe(0);
    expect(s.brightness).toBeCloseTo(128 / 255);
    expect(s.colorfulness).toBe(0);
  });

  it("gives a two-tone image one bit of entropy and colour for saturated pixels", () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 0, 255]);
    const s = imageStats(pixels);
    expect(s.entropy).toBeCloseTo(1);
    expect(s.colorfulness).toBeGreaterThan(100);
  });

  it("handles RGBA input", () => {
    expect(imageStats(new Uint8Array([10, 10, 10, 255, 10, 10, 10, 255]), 4).entropy).toBe(0);
  });
});

describe("differenceHash and hammingDistance", () => {
  it("sets a bit wherever the left pixel is brighter", () => {
    const descending = new Uint8Array(72).map((_, i) => 255 - (i % 9) * 10);
    expect(differenceHash(descending)).toBe("ffffffffffffffff");
    expect(differenceHash(new Uint8Array(72))).toBe("0000000000000000");
  });

  it("rejects the wrong thumbnail size", () => {
    expect(() => differenceHash(new Uint8Array(64))).toThrow(/72 bytes/);
  });

  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0f00000000000000", "0000000000000000")).toBe(4);
  });
});

describe("eligibility and dedupe", () => {
  it("drops language-tagged, narrow and small stills", () => {
    expect(isEligible(candidate(1))).toBe(true);
    expect(isEligible(candidate(1, { language: "en" }))).toBe(false);
    expect(isEligible(candidate(1, { width: 1000, height: 1000 }))).toBe(false);
    expect(isEligible(candidate(1, { width: 780, height: 439 }))).toBe(false);
  });

  it("keeps the better-voted of two near-identical shots", () => {
    const a = candidate(1, { hash: "0000000000000000", voteCount: 3 });
    const b = candidate(2, { hash: "0000000000000003", voteCount: 30 });
    const c = candidate(3, { hash: "ffffffffffffffff" });
    expect(dedupe([a, b, c]).map((x) => x.key)).toEqual([b.key, c.key]);
  });
});

describe("orderFrames", () => {
  it("needs six distinct eligible stills", () => {
    expect(orderFrames([1, 2, 3, 4, 5].map((n) => candidate(n)))).toBeNull();
    const tagged = [1, 2, 3, 4, 5, 6].map((n) => candidate(n, { language: n === 6 ? "en" : null }));
    expect(orderFrames(tagged)).toBeNull();
  });

  it("orders hardest first: fewer votes, flatter, darker frames come earlier", () => {
    const frames = [6, 1, 4, 2, 5, 3].map((n) =>
      candidate(n, { voteCount: n * 10, stats: { entropy: n, brightness: 0.1 + n * 0.06, colorfulness: n * 10 } }),
    );
    expect(orderFrames(frames)!.map((f) => f.key)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `/still-${n}.jpg`));
  });

  it("spreads its picks across the whole difficulty range", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => candidate(n, { voteCount: (n + 1) * 10, stats: { ...stats, entropy: n } }));
    const order = orderFrames(frames)!;
    expect(order).toHaveLength(6);
    expect(order[0].key).toBe("/still-0.jpg");
    expect(order[5].key).toBe("/still-7.jpg");
    const scores = easiness(order);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
  });
});
