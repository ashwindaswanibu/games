import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInAllowed: true,
  signUpAllowed: true,
  reclaimed: false,
  profileInsertError: null as null | { code: string; message: string; details: string },
  signIn: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  insertProfile: vi.fn(),
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
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profileTaken ? { id: "x" } : null, error: null }) }) }),
      insert: async (row: unknown) => {
        mocks.insertProfile(row);
        return { error: mocks.profileInsertError };
      },
    }),
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
  }),
}));
vi.mock("@/server/auth-limits", () => ({
  TOO_MANY_SIGN_IN_ATTEMPTS: "too many sign-ins",
  TOO_MANY_SIGN_UPS: "too many sign-ups",
  takeSignInAttempt: async () => mocks.signInAllowed,
  takeSignUpAttempt: async () => mocks.signUpAllowed,
}));
vi.mock("@/server/profiles", async () => {
  const actual = await vi.importActual<typeof import("@/server/profiles")>("@/server/profiles");
  return { profileConflict: actual.profileConflict, reclaimSignInEmail: async () => mocks.reclaimed };
});

const { signInWithPassword, signUp } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const signUpForm = (displayName = "Priya") => form({ username: "priya", displayName, password: "a-long-password" });
const EMAIL_EXISTS = { data: { user: null }, error: { code: "email_exists", status: 422, message: "exists" } };

beforeEach(() => {
  mocks.signInAllowed = true;
  mocks.signUpAllowed = true;
  mocks.reclaimed = false;
  mocks.profileInsertError = null;
  mocks.profileTaken = false;
  mocks.signIn.mockReset().mockResolvedValue({ error: null });
  mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
  mocks.insertProfile.mockReset();
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
  it("needs no invite: creates the account and its profile, signs in and lands on Today", async () => {
    await expect(signUp({}, signUpForm())).rejects.toThrow("REDIRECT /");
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(mocks.insertProfile).toHaveBeenCalledWith({ id: "new-user", username: "priya", display_name: "Priya" });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "priya@users.daily.invalid", password: "a-long-password" });
  });

  it("defaults a blank display name to the username", async () => {
    await expect(signUp({}, signUpForm(""))).rejects.toThrow("REDIRECT /");
    expect(mocks.insertProfile).toHaveBeenCalledWith({ id: "new-user", username: "priya", display_name: "priya" });
  });

  it("refuses a hidden-character display name before creating anything", async () => {
    const state = await signUp({}, signUpForm("‮nimda"));
    expect(state.fieldErrors?.displayName).toMatch(/visible/);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses over the sign-up rate limit before creating anything", async () => {
    mocks.signUpAllowed = false;
    expect((await signUp({}, signUpForm())).error).toBe("too many sign-ups");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("reclaims a sign-in email squatted through Supabase Auth, then creates the account", async () => {
    mocks.createUser.mockResolvedValueOnce(EMAIL_EXISTS);
    mocks.reclaimed = true;
    await expect(signUp({}, signUpForm())).rejects.toThrow("REDIRECT /");
    expect(mocks.createUser).toHaveBeenCalledTimes(2);
  });

  it("reports the username as taken when its sign-in email can't be reclaimed", async () => {
    mocks.createUser.mockResolvedValue(EMAIL_EXISTS);
    const state = await signUp({}, signUpForm());
    expect(state.fieldErrors?.username).toMatch(/taken/);
    expect(mocks.createUser).toHaveBeenCalledOnce();
  });

  it("removes the new auth user when the display name is taken", async () => {
    mocks.profileInsertError = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "profiles_display_name_lower_key"',
      details: "Key (lower(display_name))=(priya) already exists.",
    };
    const state = await signUp({}, signUpForm());
    expect(state.fieldErrors?.displayName).toMatch(/already goes by/);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
