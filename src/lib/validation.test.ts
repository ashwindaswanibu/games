import { describe, expect, it } from "vitest";
import { displayNameSchema, passwordSchema } from "./validation";

const ok = (name: string) => displayNameSchema.safeParse(name).success;

describe("displayNameSchema", () => {
  it("accepts ordinary names, accents, other scripts and emoji", () => {
    for (const name of ["Ashwin", "Zoë B.", "José-María", "山田 太郎", "Sam 🎬", "👩‍💻 Priya", "🇮🇳", "R2-D2"]) expect(ok(name), name).toBe(true);
  });

  it("trims and normalizes to NFC, so lookalike encodings are the same name", () => {
    expect(displayNameSchema.parse("  Zoë ")).toBe("Zoë");
  });

  it("rejects invisible and blank-looking names", () => {
    for (const name of ["​", "⠀", "ㅤ", "﻿", " ​ ", "́"]) expect(ok(name), JSON.stringify(name)).toBe(false);
  });

  it("rejects bidi overrides, which can make one name read as another", () => {
    expect(ok("‮nimda")).toBe(false);
    expect(ok("ali⁦ce")).toBe(false);
  });

  it("rejects control characters and line breaks inside a name", () => {
    expect(ok("a\nb")).toBe(false);
    expect(ok("a b")).toBe(false);
    expect(ok("a\u0007b")).toBe(false);
  });

  it("rejects a zero-width joiner that isn't joining two emoji", () => {
    expect(ok("Ash‍win")).toBe(false);
  });
});

describe("passwordSchema", () => {
  const issue = (password: string) => passwordSchema.safeParse(password).error?.issues[0]?.message;

  it("accepts 8–72 characters with at least one letter and one digit", () => {
    for (const password of ["abcdefg1", "1234567a", "Correct horse 7", "x".repeat(71) + "1"]) expect(issue(password), password).toBeUndefined();
  });

  it("matches Supabase's letters-and-digits rule, which counts ASCII letters and digits only", () => {
    expect(issue("abcdefgh")).toMatch(/letter and one number/);
    expect(issue("12345678")).toMatch(/letter and one number/);
    expect(issue("éééééé١٢")).toMatch(/letter and one number/);
  });

  it("refuses passwords bcrypt would truncate or that are too short", () => {
    expect(issue("abc1")).toMatch(/at least 8/);
    expect(issue("a1".repeat(37))).toMatch(/at most 72/);
  });
});
