import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseAccess, pipelineDb, ReadOnlyDatabaseError, readOnlyDb, type ContentDb } from "./pipeline.mjs";

describe("databaseAccess", () => {
  it("lets a local database be written", () => {
    expect(databaseAccess(true, { allowRemote: false })).toBe("read-write");
  });

  it("refuses a remote database without a flag, reads it with --allow-remote-read, writes it with --allow-remote", () => {
    expect(databaseAccess(false, { allowRemote: false })).toBeNull();
    expect(databaseAccess(false, { allowRemote: false, allowRemoteRead: true })).toBe("read-only");
    expect(databaseAccess(false, { allowRemote: true })).toBe("read-write");
    expect(databaseAccess(false, { allowRemote: true, allowRemoteRead: true })).toBe("read-write");
  });
});

describe("readOnlyDb", () => {
  const calls: string[] = [];
  const builder = {
    select: (columns: string) => (calls.push(`select ${columns}`), "rows"),
    insert: () => (calls.push("insert"), "inserted"),
    upsert: () => (calls.push("upsert"), "upserted"),
    update: () => (calls.push("update"), "updated"),
    delete: () => (calls.push("delete"), "deleted"),
  };
  const fake = { from: (table: string) => (calls.push(`from ${table}`), builder), rpc: () => (calls.push("rpc"), "called") } as unknown as ContentDb;
  const db = readOnlyDb(fake, "example.supabase.co");

  beforeEach(() => {
    calls.length = 0;
  });

  it("passes reads through", () => {
    expect((db.from("movie_films") as unknown as typeof builder).select("id")).toBe("rows");
    expect(calls).toEqual(["from movie_films", "select id"]);
  });

  it("refuses every write before it reaches the client", () => {
    const table = db.from("puzzles") as unknown as typeof builder;
    for (const write of [() => table.insert(), () => table.upsert(), () => table.update(), () => table.delete()]) {
      expect(write).toThrow(ReadOnlyDatabaseError);
    }
    expect(() => db.rpc("replace_unplayed_puzzle" as never)).toThrow(/may only read/);
    expect(calls).toEqual(["from puzzles"]);
  });
});

describe("pipelineDb", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghij.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    process.env.SUPABASE_SECRET_KEY = saved.key;
  });

  it("refuses a remote database without a flag", () => {
    expect(() => pipelineDb({ allowRemote: false })).toThrow(/Refusing to use abcdefghij\.supabase\.co/);
  });

  it("with --allow-remote-read only, refuses writes without making a request", () => {
    const db = pipelineDb({ allowRemote: false, allowRemoteRead: true });
    expect(() => db.from("movie_films").insert({ title: "x" })).toThrow(ReadOnlyDatabaseError);
    expect(() => db.from("movie_people").upsert({ name: "x" })).toThrow(ReadOnlyDatabaseError);
    expect(() => db.from("puzzles").update({ payload: {} })).toThrow(ReadOnlyDatabaseError);
    expect(() => db.from("puzzles").delete()).toThrow(ReadOnlyDatabaseError);
    expect(() => db.rpc("search_films", { p_query: "x" })).toThrow(ReadOnlyDatabaseError);
    // A read builds a query as usual (nothing is sent until it is awaited).
    expect(typeof db.from("movie_films").select("id").gt("id", 0).then).toBe("function");
  });

  it("with --allow-remote, gives the ordinary client", () => {
    const db = pipelineDb({ allowRemote: true });
    expect(typeof db.from("movie_films").insert).toBe("function");
    expect(() => db.from("movie_films").insert({ title: "x" })).not.toThrow();
  });
});
