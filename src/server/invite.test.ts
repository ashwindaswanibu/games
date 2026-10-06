import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  exhausted: new Set<string>(),
  taken: [] as string[],
  /** Calls made on the fake service-role client: [method, ...args]. */
  calls: [] as unknown[][],
  /** What the fake client's next query or rpc resolves to. */
  result: { data: null as unknown, error: null as unknown },
}));

/** A chainable stand-in for the service-role client that records every call. */
function fakeQuery(): unknown {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "select", "insert", "eq", "is", "gt"]) {
    query[method] = (...args: unknown[]) => {
      mocks.calls.push([method, ...args]);
      return query;
    };
  }
  query.maybeSingle = async () => mocks.result;
  query.rpc = async (...args: unknown[]) => {
    mocks.calls.push(["rpc", ...args]);
    return mocks.result;
  };
  query.then = (resolve: (value: unknown) => unknown) => resolve(mocks.result);
  return query;
}

vi.mock("./supabase/admin", () => ({ db: () => fakeQuery() }));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("./rate-limit", () => ({
  takeRateLimits: async (checks: { subject: string; bucket: string }[]) => {
    for (const { subject, bucket } of checks) {
      mocks.taken.push(`${bucket}:${subject}`);
      if (mocks.exhausted.has(`${bucket}:${subject}`)) return bucket;
    }
    return null;
  },
}));

const { clientIp, createInvite, generateInviteCode, hashInviteCode, isOpenInvite, normalizeInviteCode, redeemInvite, takeInviteAttempt } = await import("./invite");

beforeEach(() => {
  mocks.headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  mocks.exhausted = new Set();
  mocks.taken = [];
  mocks.calls = [];
  mocks.result = { data: null, error: null };
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("caps absurd values so they fit a rate-limit key", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "x".repeat(500) }))).toHaveLength(64);
  });
});

describe("takeInviteAttempt", () => {
  it("counts the attempt per IP and globally", async () => {
    expect(await takeInviteAttempt()).toBe(true);
    expect(mocks.taken).toEqual(["invite:ip:203.0.113.7", "inviteGlobal:all"]);
  });

  it("also counts per user during onboarding", async () => {
    await takeInviteAttempt("u1");
    expect(mocks.taken).toEqual(["invite:ip:203.0.113.7", "invite:user:u1", "inviteGlobal:all"]);
  });

  it("refuses once this IP, this user or everyone together is over the limit", async () => {
    mocks.exhausted.add("invite:ip:203.0.113.7");
    expect(await takeInviteAttempt()).toBe(false);
    mocks.exhausted = new Set(["invite:user:u1"]);
    expect(await takeInviteAttempt("u1")).toBe(false);
    mocks.exhausted = new Set(["inviteGlobal:all"]);
    expect(await takeInviteAttempt()).toBe(false);
  });
});

describe("invite codes", () => {
  it("are 20 random base32 characters in groups of five", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}(-[0-9a-hjkmnp-tv-z]{5}){3}$/);
    const many = new Set(Array.from({ length: 200 }, generateInviteCode));
    expect(many.size).toBe(200);
  });

  it("normalize what a person types: case, spaces, dashes and look-alike letters don't matter", () => {
    const code = generateInviteCode();
    const canonical = code.replaceAll("-", "");
    expect(normalizeInviteCode(code)).toBe(canonical);
    expect(normalizeInviteCode(` ${code.toUpperCase()} `)).toBe(canonical);
    expect(normalizeInviteCode(canonical.replace(/-/g, "").match(/.{4}/g)!.join(" "))).toBe(canonical);
    expect(normalizeInviteCode("0000O-11111-IIIII-lllll")).toBe("00000111111111111111");
  });

  it("reject anything that can't be a code", () => {
    expect(normalizeInviteCode("")).toBeNull();
    expect(normalizeInviteCode("local-friends")).toBeNull();
    expect(normalizeInviteCode("uuuuu-uuuuu-uuuuu-uuuuu")).toBeNull();
    expect(normalizeInviteCode(`${"a".repeat(20)}a`)).toBeNull();
  });

  it("are stored as a SHA-256 hash, never as the code", async () => {
    const code = await createInvite("admin-id", "Priya", new Date("2026-10-01T00:00:00Z"));
    const insert = mocks.calls.find((c) => c[0] === "insert")?.[1] as Record<string, string>;
    expect(insert.token_hash).toBe(hashInviteCode(normalizeInviteCode(code)!));
    expect(insert.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mocks.calls)).not.toContain(code.replaceAll("-", ""));
    expect(insert).toMatchObject({ note: "Priya", created_by: "admin-id", expires_at: "2026-10-08T00:00:00.000Z" });
  });
});

describe("isOpenInvite", () => {
  it("looks up an unused, unexpired invite by the hash of the normalized code", async () => {
    const code = generateInviteCode();
    mocks.result = { data: { id: "i1" }, error: null };
    expect(await isOpenInvite(code.toUpperCase())).toBe(true);
    expect(mocks.calls).toContainEqual(["eq", "token_hash", hashInviteCode(normalizeInviteCode(code)!)]);
    expect(mocks.calls).toContainEqual(["is", "used_at", null]);
    expect(mocks.calls.some((c) => c[0] === "gt" && c[1] === "expires_at")).toBe(true);
    mocks.result = { data: null, error: null };
    expect(await isOpenInvite(code)).toBe(false);
  });

  it("doesn't query the database for something that isn't a code", async () => {
    expect(await isOpenInvite("local-friends")).toBe(false);
    expect(mocks.calls).toEqual([]);
  });
});

describe("redeemInvite", () => {
  const profile = { id: "u1", username: "priya", displayName: "Priya" };

  it("creates the profile and spends the invite in one database call", async () => {
    const code = generateInviteCode();
    mocks.result = { data: true, error: null };
    expect(await redeemInvite(code, profile)).toEqual({ ok: true });
    expect(mocks.calls).toEqual([
      ["rpc", "redeem_invite", { p_token_hash: hashInviteCode(normalizeInviteCode(code)!), p_user_id: "u1", p_username: "priya", p_display_name: "Priya" }],
    ]);
  });

  it("reports a used, expired or unknown invite", async () => {
    mocks.result = { data: false, error: null };
    expect(await redeemInvite(generateInviteCode(), profile)).toEqual({ ok: false, reason: "invalid_invite" });
    expect(await redeemInvite("nope", profile)).toEqual({ ok: false, reason: "invalid_invite" });
  });

  it("passes profile errors (a taken name) through", async () => {
    const error = { code: "23505", message: "duplicate key" };
    mocks.result = { data: null, error };
    expect(await redeemInvite(generateInviteCode(), profile)).toEqual({ ok: false, reason: "profile_error", error });
  });
});
