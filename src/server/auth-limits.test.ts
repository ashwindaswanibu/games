import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  exhausted: new Set<string>(),
  taken: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("./supabase/admin", () => ({ db: () => ({}) }));
vi.mock("./rate-limit", () => ({
  takeRateLimits: async (checks: { subject: string; bucket: string }[]) => {
    for (const { subject, bucket } of checks) {
      mocks.taken.push(`${bucket}:${subject}`);
      if (mocks.exhausted.has(`${bucket}:${subject}`)) return bucket;
    }
    return null;
  },
}));

const { takeSignInAttempt, takeSignUpAttempt } = await import("./auth-limits");
const { RATE_LIMITS } = await vi.importActual<typeof import("./rate-limit")>("./rate-limit");

beforeEach(() => {
  mocks.headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  mocks.exhausted = new Set();
  mocks.taken = [];
});

describe("takeSignInAttempt", () => {
  it("counts the attempt per client IP and per username", async () => {
    expect(await takeSignInAttempt("priya")).toBe(true);
    expect(mocks.taken).toEqual(["signIn:ip:203.0.113.7", "signInAccount:user:priya"]);
  });

  it("refuses once the IP or the account is over its limit", async () => {
    mocks.exhausted.add("signIn:ip:203.0.113.7");
    expect(await takeSignInAttempt("priya")).toBe(false);
    mocks.exhausted = new Set(["signInAccount:user:priya"]);
    expect(await takeSignInAttempt("priya")).toBe(false);
    expect(await takeSignInAttempt("sam")).toBe(true);
  });

  it("counts an IPv6 client by its /64", async () => {
    mocks.headers = new Headers({ "x-real-ip": "2001:db8:1:2:aaaa::9" });
    await takeSignInAttempt("priya");
    expect(mocks.taken[0]).toBe("signIn:ip:2001:db8:1:2::/64");
  });

  it("keeps the limits tight enough to make guessing slow", () => {
    expect(RATE_LIMITS.signIn.limit / RATE_LIMITS.signIn.windowSeconds).toBeLessThanOrEqual(10 / 300);
    expect(RATE_LIMITS.signInAccount.limit / RATE_LIMITS.signInAccount.windowSeconds).toBeLessThanOrEqual(10 / 900);
  });
});

describe("takeSignUpAttempt", () => {
  it("counts the sign-up per client network, then overall", async () => {
    expect(await takeSignUpAttempt()).toBe(true);
    expect(mocks.taken).toEqual(["signUpsPerIp:ip:203.0.113.7", "signUps:all"]);
  });

  it("doesn't charge the overall limit when the client's own limit refuses", async () => {
    mocks.exhausted.add("signUpsPerIp:ip:203.0.113.7");
    expect(await takeSignUpAttempt()).toBe(false);
    expect(mocks.taken).toEqual(["signUpsPerIp:ip:203.0.113.7"]);
  });

  it("refuses once the overall limit is used up", async () => {
    mocks.exhausted.add("signUps:all");
    expect(await takeSignUpAttempt()).toBe(false);
  });

  it("puts callers without a known IP in one shared bucket", async () => {
    mocks.headers = new Headers();
    await takeSignUpAttempt();
    expect(mocks.taken[0]).toBe("signUpsPerIp:ip:unknown");
  });
});
