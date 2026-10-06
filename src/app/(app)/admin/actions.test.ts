import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "11111111-1111-4111-8111-111111111111";
const PLAYER = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  profiles: new Map<string, { id: string; is_admin: boolean }>(),
  updateError: null as null | { code: string; status: number; message: string; reasons?: string[] },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ OWNER_USER_IDS: [] }) }));
vi.mock("@/server/auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/auth")>("@/server/auth");
  return {
    requireAdmin: async () => ({ id: ME, is_admin: true }),
    isPasswordAccountEmail: actual.isPasswordAccountEmail,
    weakPasswordMessage: actual.weakPasswordMessage,
  };
});
vi.mock("@/server/supabase/admin", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: mocks.profiles.get(id) ?? null, error: null }) }) }),
    }),
    rpc: async (fn: string, args: { p_user_id: string }) => {
      mocks.calls.push(`rpc:${fn}:${args.p_user_id}`);
      return { data: null, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, email: "x@users.daily.invalid" } }, error: null }),
        updateUserById: async (id: string) => {
          mocks.calls.push(`update:${id}`);
          return { error: mocks.updateError };
        },
      },
    },
  }),
}));

const { resetPassword } = await import("./actions");

function form(userId: string, password = "a-new-password-2"): FormData {
  const data = new FormData();
  data.set("userId", userId);
  data.set("password", password);
  return data;
}

beforeEach(() => {
  mocks.calls = [];
  mocks.updateError = null;
  mocks.profiles = new Map([
    [ME, { id: ME, is_admin: true }],
    [PLAYER, { id: PLAYER, is_admin: false }],
  ]);
});

describe("resetPassword", () => {
  it("refuses an admin's own password, so a stolen admin session can't keep the account", async () => {
    const state = await resetPassword({}, form(ME));
    expect(state.error).toMatch(/own password/);
    expect(mocks.calls).toEqual([]);
  });

  it("authorises the change in the database right before setting the password", async () => {
    const state = await resetPassword({}, form(PLAYER));
    expect(state.ok).toBeDefined();
    expect(mocks.calls).toEqual([`rpc:allow_password_change:${PLAYER}`, `update:${PLAYER}`]);
  });

  it("holds an admin's new password to the same rule as sign-up", async () => {
    const state = await resetPassword({}, form(PLAYER, "onlyletters"));
    expect(state.error).toMatch(/letter and one number/);
    expect(mocks.calls).toEqual([]);
  });

  it("says why Supabase refused a weak password", async () => {
    mocks.updateError = { code: "weak_password", status: 422, message: "Password is known to be weak", reasons: ["pwned"] };
    const state = await resetPassword({}, form(PLAYER));
    expect(state.error).toMatch(/data breach/);
  });
});
