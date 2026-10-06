import { describe, expect, it } from "vitest";
import { displayNameSchema } from "./validation";

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
