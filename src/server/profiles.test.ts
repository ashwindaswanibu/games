import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileRow } from "./database.types";

/**
 * An in-memory stand-in for the two things profiles.ts touches: the `profiles` table (with its
 * unique constraints and the foreign key to auth users) and the auth admin API. Hooks let a test
 * slip a concurrent write in just before the code under test writes, to exercise its races.
 */
interface DbError {
  code: string;
  message: string;
  details: string;
}

const uniqueError = (constraint: string, column: string, value: string): DbError => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${constraint}"`,
  details: `Key (${column})=(${value}) already exists.`,
});

class FakeStore {
  profiles: ProfileRow[] = [];
  users = new Map<string, { email: string; createdAt: number }>();
  /** Mirrors the case-insensitive display-name index (`profiles_display_name_lower_key`). */
  uniqueDisplayNames = true;
  /** Mirrors a display-name check constraint the app's own validation doesn't know about. */
  rejectDisplayName: ((name: string) => boolean) | null = null;
  /** Mirrors PostgREST's `max_rows`: selects return at most this many rows. */
  maxRows = Infinity;
  beforeProfileWrite: (() => void | Promise<void>) | null = null;
  failProfileUpdate: DbError | null = null;
  failEmailUpdates = 0;
  authCalls: string[] = [];

  addUser(id: string, email: string, createdAt = Date.parse("2026-10-01T00:00:00Z")) {
    this.users.set(id, { email, createdAt });
  }

  addProfile(id: string, username: string, displayName = username) {
    this.profiles.push({ id, username, display_name: displayName, is_admin: false, created_at: "2026-10-01T00:00:00Z" });
  }

  profile(id: string) {
    return this.profiles.find((p) => p.id === id);
  }

  conflict(row: Pick<ProfileRow, "id" | "username" | "display_name">, ignoreId?: string): DbError | null {
    const others = this.profiles.filter((p) => p.id !== ignoreId);
    if (ignoreId === undefined && others.some((p) => p.id === row.id)) return uniqueError("profiles_pkey", "id", row.id);
    if (others.some((p) => p.username === row.username)) return uniqueError("profiles_username_key", "username", row.username);
    if (this.uniqueDisplayNames && others.some((p) => p.display_name.toLowerCase() === row.display_name.toLowerCase())) {
      return uniqueError("profiles_display_name_lower_key", "lower(display_name)", row.display_name.toLowerCase());
    }
    return null;
  }
}

let store: FakeStore;

type Row = Record<string, unknown>;

/** A SQL LIKE pattern (with `\` escapes) as a regex. */
function likeToRegex(pattern: string, flags: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") source += (pattern[++i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "%") source += ".*";
    else if (ch === "_") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, flags);
}

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private filters: ((row: Row) => boolean)[] = [];
  /** `.select()` after a write: return the written rows. */
  private returning = false;

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  ilike(column: string, pattern: string) {
    const re = likeToRegex(pattern, "i");
    this.filters.push((row) => re.test(String(row[column])));
    return this;
  }
  filter(column: string, operator: string, value: string) {
    if (operator !== "match") throw new Error(`Fake doesn't support ${operator}`);
    const re = new RegExp(value);
    this.filters.push((row) => re.test(String(row[column])));
    return this;
  }
  async maybeSingle() {
    const { data, error } = await this.run();
    return { data: (data as Row[] | null)?.[0] ?? null, error };
  }
  then<A, B>(onFulfilled?: ((value: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(onFulfilled, onRejected);
  }

  private async run(): Promise<{ data: unknown; error: DbError | null }> {
    const rows = store.profiles as unknown as Row[];
    if (this.op === "select") return { data: rows.filter((r) => this.filters.every((f) => f(r))).slice(0, store.maxRows), error: null };

    const hook = store.beforeProfileWrite;
    store.beforeProfileWrite = null;
    await hook?.();

    if (this.op === "insert") {
      const row = this.payload as Pick<ProfileRow, "id" | "username" | "display_name">;
      if (!store.users.has(row.id)) return { data: null, error: { code: "23503", message: "violates foreign key constraint", details: "" } };
      if (store.rejectDisplayName?.(row.display_name)) {
        return {
          data: null,
          error: { code: "23514", message: 'new row for relation "profiles" violates check constraint "profiles_display_name_visible_check"', details: "" },
        };
      }
      const error = store.conflict(row);
      if (error) return { data: null, error };
      store.addProfile(row.id, row.username, row.display_name);
      return { data: null, error: null };
    }

    if (store.failProfileUpdate) return { data: null, error: store.failProfileUpdate };
    const matched = store.profiles.filter((r) => this.filters.every((f) => f(r as unknown as Row)));
    for (const row of matched) {
      const next = { ...row, ...(this.payload as Partial<ProfileRow>) };
      const error = store.conflict(next, row.id);
      if (error) return { data: null, error };
      Object.assign(row, next);
    }
    return { data: this.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
  }
}

const fakeDb = {
  from: (table: string) => {
    if (table !== "profiles") throw new Error(`Fake has no table ${table}`);
    return new FakeQuery();
  },
  /** `orphan_auth_user_for_email`: the auth user holding the email, if it has no profile. */
  async rpc(fn: string, args: { p_email: string }) {
    if (fn !== "orphan_auth_user_for_email") throw new Error(`Fake has no function ${fn}`);
    const orphans = [...store.users]
      .filter(([id, u]) => u.email === args.p_email.toLowerCase() && !store.profile(id))
      .map(([id, u]) => ({ id, created_at: new Date(u.createdAt).toISOString() }));
    return { data: orphans, error: null };
  },
  auth: {
    admin: {
      async deleteUser(id: string) {
        store.authCalls.push(`delete:${id}`);
        store.users.delete(id);
        return { data: {}, error: null };
      },
      async getUserById(id: string) {
        store.authCalls.push(`get:${id}`);
        const user = store.users.get(id);
        return user ? { data: { user: { id, email: user.email } }, error: null } : { data: { user: null }, error: { message: "User not found" } };
      },
      async updateUserById(id: string, attributes: { email?: string }) {
        store.authCalls.push(`update:${attributes.email}`);
        if (store.failEmailUpdates > 0) {
          store.failEmailUpdates--;
          return { data: { user: null }, error: { status: 500, code: "unexpected_failure", message: "Error updating user" } };
        }
        if ([...store.users].some(([other, u]) => other !== id && u.email === attributes.email)) {
          return { data: { user: null }, error: { status: 500, code: "unexpected_failure", message: "Error updating user" } };
        }
        const user = store.users.get(id);
        if (user && attributes.email) user.email = attributes.email;
        return { data: { user }, error: null };
      },
    },
  },
};

vi.mock("./supabase/admin", () => ({ db: () => fakeDb }));
vi.mock("./supabase/session", () => ({ sessionClient: async () => ({}) }));

const { profileConflict, provisionProfile, reclaimSignInEmail, updateProfile } = await import("./profiles");

const PASSWORD = (username: string) => `${username}@users.daily.invalid`;

beforeEach(() => {
  store = new FakeStore();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("profileConflict", () => {
  it("names the rule a unique violation broke", () => {
    expect(profileConflict(uniqueError("profiles_pkey", "id", "x"))).toBe("account");
    expect(profileConflict(uniqueError("profiles_username_key", "username", "x"))).toBe("username");
    expect(profileConflict(uniqueError("profiles_display_name_lower_key", "lower(display_name)", "x"))).toBe("display_name");
    expect(profileConflict({ code: "23505", message: "something else", details: "" })).toBe("other");
    expect(profileConflict({ code: "23503", message: "fk", details: "" })).toBeNull();
    expect(profileConflict(null)).toBeNull();
  });
});

describe("provisionProfile", () => {
  const google = { id: "g1", email: "ana.r1987+daily@gmail.com", providerName: "Ana Ruiz", providers: ["google"] };

  beforeEach(() => store.addUser("g1", "ana.r1987+daily@gmail.com"));

  it("creates a profile named from the identity", async () => {
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")).toMatchObject({ username: "ana_ruiz", display_name: "Ana Ruiz" });
  });

  it("leaves an existing profile alone", async () => {
    store.addProfile("g1", "custom", "Custom");
    expect(await provisionProfile(google)).toBe("exists");
    expect(store.profile("g1")?.username).toBe("custom");
  });

  it("takes the next free number when the name is taken", async () => {
    store.addProfile("other1", "ana_ruiz");
    store.addProfile("other2", "ana_ruiz2");
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")?.username).toBe("ana_ruiz3");
  });

  it("retries when another player claims the name between the lookup and the insert", async () => {
    store.beforeProfileWrite = () => store.addProfile("racer", "ana_ruiz", "Racer");
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")?.username).toBe("ana_ruiz2");
  });

  it("reports an existing profile when another tab creates it first", async () => {
    store.beforeProfileWrite = () => store.addProfile("g1", "ana_ruiz", "Ana Ruiz");
    expect(await provisionProfile(google)).toBe("exists");
    expect(store.profiles.filter((p) => p.id === "g1")).toHaveLength(1);
  });

  it("numbers a display name someone already goes by (ignoring case)", async () => {
    store.addProfile("other", "someone", "ana ruiz");
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")).toMatchObject({ username: "ana_ruiz", display_name: "Ana Ruiz 2" });
  });

  it("asks for a sign-out when the account no longer exists", async () => {
    expect(await provisionProfile({ id: "ghost", email: "ghost@example.com", providerName: null, providers: ["google"] })).toBe("no-account");
  });

  it("only sets up Google accounts", async () => {
    // Made through Supabase's own sign-up endpoint, bypassing the app (and its username rules).
    store.addUser("e1", "bob@users.daily.invalid");
    expect(await provisionProfile({ id: "e1", email: "bob@users.daily.invalid", providerName: null, providers: ["email"] })).toBe("not-google");
    expect(await provisionProfile({ id: "e1", email: "bob@users.daily.invalid", providerName: null, providers: [] })).toBe("not-google");
    expect(store.profile("e1")).toBeUndefined();
  });

  it("sanitises Google's name to the display-name rules (hidden and blank-looking characters)", async () => {
    expect(await provisionProfile({ ...google, providerName: "Ana\u3164Ruiz\u202E\u200B" })).toBe("created");
    expect(store.profile("g1")).toMatchObject({ username: "anaruiz", display_name: "Ana Ruiz" });
  });

  it("goes by the username when the database refuses Google's name", async () => {
    store.rejectDisplayName = (name) => name === "Ana Ruiz";
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")).toMatchObject({ username: "ana_ruiz", display_name: "ana_ruiz" });
  });

  it("goes by a numbered username when the database refuses Google's name and the username is someone's name", async () => {
    store.rejectDisplayName = (name) => name.trim() === "\u3164";
    store.addProfile("other", "someone", "Ana_Ruiz");
    expect(await provisionProfile({ ...google, providerName: "\u3164", email: "ana.ruiz@gmail.com" })).toBe("created");
    expect(store.profile("g1")).toMatchObject({ username: "ana_ruiz", display_name: "ana_ruiz 2" });
  });

  it("finds the next free display number in one go", async () => {
    for (let n = 1; n <= 8; n++) store.addProfile(`other${n}`, `someone${n}`, n === 1 ? "Ana Ruiz" : `Ana Ruiz ${n}`);
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")?.display_name).toBe("Ana Ruiz 9");
  });

  it("can't be locked out by display names claimed on purpose", async () => {
    store.maxRows = 1; // the lookup only sees "Ana Ruiz", so "Ana Ruiz 2" looks free but isn't
    store.addProfile("other1", "someone1", "Ana Ruiz");
    store.addProfile("other2", "someone2", "Ana Ruiz 2");
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")?.display_name).toMatch(/^Ana Ruiz [a-z0-9]{4}$/);
  });

  it("can't be locked out by usernames claimed on purpose (more than one lookup returns)", async () => {
    store.maxRows = 3;
    for (const name of ["ana_ruiz", "ana_ruiz2", "ana_ruiz3", "ana_ruiz4", "ana_ruiz5"]) store.addProfile(`squat_${name}`, name, `Squatter ${name}`);
    expect(await provisionProfile(google)).toBe("created");
    expect(store.profile("g1")?.username).toMatch(/^ana_ruiz_[a-z0-9]{4}$/);
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    store.addUser("p1", PASSWORD("pat"));
    store.addProfile("p1", "pat", "Pat");
    store.addUser("g1", "gus@gmail.com");
    store.addProfile("g1", "gus", "Gus");
  });
  const pat = () => store.profile("p1")!;
  const gus = () => store.profile("g1")!;

  it("changes only the display name without touching sign-in", async () => {
    expect(await updateProfile(pat(), { username: "pat", displayName: "Patricia" })).toEqual({ ok: true, username: "pat", signInChanged: false });
    expect(pat().display_name).toBe("Patricia");
    expect(store.authCalls).toEqual([]);
  });

  it("moves a password account's sign-in email with its username", async () => {
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: true, username: "patty", signInChanged: true });
    expect(pat().username).toBe("patty");
    expect(store.users.get("p1")?.email).toBe(PASSWORD("patty"));
  });

  it("only updates the profile for a Google account", async () => {
    expect(await updateProfile(gus(), { username: "gustavo", displayName: "Gus" })).toEqual({ ok: true, username: "gustavo", signInChanged: false });
    expect(gus().username).toBe("gustavo");
    expect(store.users.get("g1")?.email).toBe("gus@gmail.com");
    expect(store.authCalls).toEqual(["get:g1"]);
  });

  it("refuses a taken username before touching anything", async () => {
    expect(await updateProfile(pat(), { username: "gus", displayName: "Pat" })).toEqual({ ok: false, reason: "username_taken" });
    expect(pat().username).toBe("pat");
    expect(store.authCalls).toEqual([]);
  });

  it("moves the email back when the profile update fails", async () => {
    store.failProfileUpdate = { code: "XX000", message: "boom", details: "" };
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: false, reason: "failed" });
    expect(pat().username).toBe("pat");
    expect(store.users.get("p1")?.email).toBe(PASSWORD("pat"));
    expect(store.authCalls).toEqual(["get:p1", `update:${PASSWORD("patty")}`, "get:p1", `update:${PASSWORD("pat")}`]);
  });

  it("refuses a save based on a profile another tab has since renamed, and keeps sign-in in line", async () => {
    const snapshot = { ...pat() };
    expect(await updateProfile(pat(), { username: "patricia", displayName: "Pat" })).toMatchObject({ ok: true });
    expect(await updateProfile(snapshot, { username: "patty", displayName: "Pat" })).toEqual({ ok: false, reason: "stale" });
    expect(await updateProfile(snapshot, { username: "pat", displayName: "Patty" })).toEqual({ ok: false, reason: "stale" });
    expect(pat()).toMatchObject({ username: "patricia", display_name: "Pat" });
    expect(store.users.get("p1")?.email).toBe(PASSWORD("patricia"));
  });

  it("keeps the sign-in email and username together when two renames interleave", async () => {
    // A moves the email to p@, then B renames all the way to q before A writes the profile.
    const snapshot = { ...pat() };
    store.beforeProfileWrite = async () => {
      expect(await updateProfile(snapshot, { username: "qqq", displayName: "Pat" })).toMatchObject({ ok: true, username: "qqq" });
    };
    expect(await updateProfile(snapshot, { username: "ppp", displayName: "Pat" })).toEqual({ ok: false, reason: "stale" });
    expect(pat().username).toBe("qqq");
    expect(store.users.get("p1")?.email).toBe(PASSWORD("qqq"));
  });

  it("moves the email back when someone claims the username mid-rename", async () => {
    store.beforeProfileWrite = () => store.addProfile("racer", "patty");
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: false, reason: "username_taken" });
    expect(store.users.get("p1")?.email).toBe(PASSWORD("pat"));
  });

  it("reports a taken display name (and rolls back the sign-in email)", async () => {
    expect(await updateProfile(pat(), { username: "patty", displayName: "GUS" })).toEqual({ ok: false, reason: "display_name_taken" });
    expect(pat()).toMatchObject({ username: "pat", display_name: "Pat" });
    expect(store.users.get("p1")?.email).toBe(PASSWORD("pat"));
    expect(await updateProfile(pat(), { username: "pat", displayName: "gus" })).toEqual({ ok: false, reason: "display_name_taken" });
  });

  it("leaves the profile alone when the email can't be moved", async () => {
    store.failEmailUpdates = 1;
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: false, reason: "failed" });
    expect(pat().username).toBe("pat");
    expect(store.users.get("p1")?.email).toBe(PASSWORD("pat"));
  });

  it("reclaims a new username's sign-in email from an abandoned profile-less auth user", async () => {
    store.addUser("squatter", PASSWORD("patty"), Date.now() - 10 * 60_000);
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: true, username: "patty", signInChanged: true });
    expect(store.users.has("squatter")).toBe(false);
    expect(store.users.get("p1")?.email).toBe(PASSWORD("patty"));
  });

  it("leaves a very recent holder of the new sign-in email alone, and changes nothing", async () => {
    store.addUser("in-flight", PASSWORD("patty"), Date.now());
    expect(await updateProfile(pat(), { username: "patty", displayName: "Pat" })).toEqual({ ok: false, reason: "failed" });
    expect(store.users.has("in-flight")).toBe(true);
    expect(pat().username).toBe("pat");
  });
});

describe("reclaimSignInEmail", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");

  it("removes a profile-less auth user holding the username's sign-in email once it's a couple of minutes old", async () => {
    store.addUser("squatter", PASSWORD("ana"), now - 3 * 60_000);
    expect(await reclaimSignInEmail("ana", now)).toBe(true);
    expect(store.users.has("squatter")).toBe(false);
  });

  it("leaves a sign-up that may still be in flight alone", async () => {
    store.addUser("new", PASSWORD("ana"), now - 30_000);
    expect(await reclaimSignInEmail("ana", now)).toBe(false);
    expect(store.users.has("new")).toBe(true);
  });

  it("never removes a player", async () => {
    store.addUser("p1", PASSWORD("ana"), now - 86_400_000);
    store.addProfile("p1", "ana", "Ana");
    expect(await reclaimSignInEmail("ana", now)).toBe(false);
    expect(store.users.has("p1")).toBe(true);
    expect(store.authCalls).toEqual([]);
  });
});
