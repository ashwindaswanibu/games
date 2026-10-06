import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileRow } from "./database.types";

const mocks = vi.hoisted(() => ({
  profile: null as ProfileRow | null,
  /** Buckets that refuse the request. */
  exhausted: new Set<string>(),
  taken: [] as string[],
}));

vi.mock("./auth", () => ({ getCurrentProfile: async () => mocks.profile }));
vi.mock("./rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rate-limit")>();
  const takeRateLimit = async (subject: string, bucket: string) => {
    mocks.taken.push(`${bucket}:${subject}`);
    return !mocks.exhausted.has(bucket);
  };
  return {
    RATE_LIMITS: actual.RATE_LIMITS,
    takeRateLimit,
    takeRateLimits: async (checks: { subject: string; bucket: string }[]) => {
      for (const { subject, bucket } of checks) if (!(await takeRateLimit(subject, bucket))) return bucket;
      return null;
    },
  };
});

const { guardRequest } = await import("./http");
const { canUseMoviesCatalog } = await import("./catalog");
const { GAMES } = await import("@/games/registry");

const player: ProfileRow = { id: "u1", username: "ana", display_name: "Ana", is_admin: false, created_at: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  mocks.profile = player;
  mocks.exhausted = new Set();
  mocks.taken = [];
});

describe("guardRequest", () => {
  it("refuses a signed-out caller with 401, before counting anything", async () => {
    mocks.profile = null;
    const result = await guardRequest({ buckets: ["catalog"], signedOutMessage: "Sign in to search films." });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Sign in to search films." });
    expect(mocks.taken).toEqual([]);
  });

  it("answers 404 when the caller isn't allowed, so the route isn't confirmed", async () => {
    const result = await guardRequest({ buckets: ["catalog"], signedOutMessage: "x", allowed: () => false });
    expect(!result.ok && result.response.status).toBe(404);
    expect(mocks.taken).toEqual([]);
  });

  it("counts the request against the player's bucket and lets it through", async () => {
    const result = await guardRequest({ buckets: ["assets", "assetsDaily"], signedOutMessage: "x" });
    expect(result).toEqual({ ok: true, profile: player });
    expect(mocks.taken).toEqual(["assets:u1", "assetsDaily:u1"]);
  });

  it("answers 429 with Retry-After once the limit is used up", async () => {
    mocks.exhausted.add("catalog");
    const result = await guardRequest({ buckets: ["catalog"], signedOutMessage: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("10");
    expect(result.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("stops at the first used-up bucket and reports its window (the daily asset cap)", async () => {
    mocks.exhausted.add("assetsDaily");
    const result = await guardRequest({ buckets: ["assets", "assetsDaily"], signedOutMessage: "x" });
    expect(!result.ok && result.response.status).toBe(429);
    if (result.ok) return;
    expect(result.response.headers.get("Retry-After")).toBe("86400");
  });

  it("doesn't charge later buckets once an earlier one refuses", async () => {
    mocks.exhausted.add("assets");
    await guardRequest({ buckets: ["assets", "assetsDaily"], signedOutMessage: "x" });
    expect(mocks.taken).toEqual(["assets:u1"]);
  });
});

describe("canUseMoviesCatalog", () => {
  it("follows Movies game visibility: admins always, players once a Movies game is live", () => {
    expect(canUseMoviesCatalog({ is_admin: true })).toBe(true);
    const anyLive = GAMES.some((game) => game.bucket === "movies" && game.availability === "live");
    expect(canUseMoviesCatalog({ is_admin: false })).toBe(anyLive);
  });
});
