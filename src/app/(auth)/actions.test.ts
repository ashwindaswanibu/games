import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInAllowed: true,
  inviteAttemptAllowed: true,
  inviteOpen: true,
  redeem: { ok: true } as { ok: true } | { ok: false; reason: string; error?: unknown },
  signIn: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  profileTaken: false,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/server/supabase/session", () => ({ sessionClient: async () => ({ auth: { signInWithPassword: mocks.signIn } }) }));
vi.mock("@/server/supabase/admin", () => ({
  db: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profileTaken ? { id: "x" } : null }) }) }) }),
    rpc: async () => ({ data: [], error: null }),
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
  }),
}));
vi.mock("@/server/sign-in-limit", () => ({
  TOO_MANY_SIGN_IN_ATTEMPTS: "too many sign-ins",
  takeSignInAttempt: async () => mocks.signInAllowed,
}));
vi.mock("@/server/invite", () => ({
  TOO_MANY_INVITE_ATTEMPTS: "too many invites",
  takeInviteAttempt: async () => mocks.inviteAttemptAllowed,
  isOpenInvite: async () => mocks.inviteOpen,
  redeemInvite: async () => mocks.redeem,
}));

const { signInWithPassword, signUp } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const signUpForm = () => form({ username: "priya", displayName: "Priya", password: "a-long-password", inviteCode: "abcde-fghjk-mnpqr-stvwx" });

beforeEach(() => {
  mocks.signInAllowed = true;
  mocks.inviteAttemptAllowed = true;
  mocks.inviteOpen = true;
  mocks.redeem = { ok: true };
  mocks.profileTaken = false;
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
});

describe("signInWithPassword", () => {
  it("refuses over the rate limit without asking Supabase Auth", async () => {
    mocks.signInAllowed = false;
    const state = await signInWithPassword({}, form({ username: "priya", password: "guess" }));
    expect(state.error).toBe("too many sign-ins");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("signs in within the limit", async () => {
    await expect(signInWithPassword({}, form({ username: "Priya", password: "pw" }))).rejects.toThrow("REDIRECT /");
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "priya@users.daily.invalid", password: "pw" });
  });
});

describe("signUp", () => {
  it("refuses an invite that isn't open before creating anything", async () => {
    mocks.inviteOpen = false;
    const state = await signUp({}, signUpForm());
    expect(state.fieldErrors?.inviteCode).toMatch(/isn't right/);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses over the invite rate limit before looking the code up", async () => {
    mocks.inviteAttemptAllowed = false;
    mocks.inviteOpen = true;
    expect((await signUp({}, signUpForm())).error).toBe("too many invites");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("removes the new auth user when the invite was spent meanwhile", async () => {
    mocks.redeem = { ok: false, reason: "invalid_invite" };
    const state = await signUp({}, signUpForm());
    expect(state.fieldErrors?.inviteCode).toMatch(/already used/);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("removes the new auth user when the display name is taken", async () => {
    mocks.redeem = { ok: false, reason: "profile_error", error: { code: "23505", message: 'violates unique constraint "profiles_display_name_lower_key"' } };
    const state = await signUp({}, signUpForm());
    expect(state.fieldErrors?.displayName).toMatch(/already uses/);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
  });

  it("creates the account, spends the invite and signs in", async () => {
    await expect(signUp({}, signUpForm())).rejects.toThrow("REDIRECT /");
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "priya@users.daily.invalid", password: "a-long-password" });
  });
});
