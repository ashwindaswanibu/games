import { describe, expect, it } from "vitest";
import {
  USERNAME_BASE_MAX,
  deriveDisplayName,
  deriveUsernameBase,
  escapeLike,
  nextDisplayNumber,
  numberedDisplayName,
  pickAvailableUsername,
  randomizedUsername,
  sanitizeUsername,
  suffixedDisplayName,
  usernameCollisionPattern,
} from "./username";
import { DISPLAY_NAME_MAX, displayNameSchema, usernameSchema } from "./validation";

const isValidUsername = (name: string) => usernameSchema.safeParse(name).success && usernameSchema.parse(name) === name;

describe("sanitizeUsername", () => {
  it("lowercases, folds accents and turns separators into underscores", () => {
    expect(sanitizeUsername("José María")).toBe("jose_maria");
    expect(sanitizeUsername("Ana.Belén-Ruiz")).toBe("ana_belen_ruiz");
    expect(sanitizeUsername("O'Brien")).toBe("o_brien");
  });

  it("drops characters it can't represent and collapses underscores", () => {
    expect(sanitizeUsername("__a!!..b__")).toBe("a_b");
    expect(sanitizeUsername("张伟")).toBe("");
    expect(sanitizeUsername("🎲🎲")).toBe("");
    expect(sanitizeUsername("ＡＢＣ１２３")).toBe("abc123"); // full-width forms fold via NFKD
  });
});

describe("deriveUsernameBase", () => {
  it("prefers the name, so the public @handle doesn't spell out the email address", () => {
    expect(deriveUsernameBase({ email: "ashwin.d1987@gmail.com", name: "Ashwin Daswani" })).toBe("ashwin_daswani");
  });

  it("handles dots and drops +tags in the email", () => {
    expect(deriveUsernameBase({ email: "ana.b.ruiz@gmail.com" })).toBe("ana_b_ruiz");
    expect(deriveUsernameBase({ email: "Sam.Lee+games@example.com" })).toBe("sam_lee");
  });

  it("folds accents in names", () => {
    expect(deriveUsernameBase({ email: "张伟@example.com", name: "Zoë Kravitz" })).toBe("zoe_kravitz");
    expect(deriveUsernameBase({ email: null, name: "Zoë Kravitz" })).toBe("zoe_kravitz");
    expect(deriveUsernameBase({ email: "+tag@example.com", name: "Mo Salah" })).toBe("mo_salah");
  });

  it("falls back to the email when the name gives nothing usable", () => {
    expect(deriveUsernameBase({ email: "wei.zhang@example.com", name: "张伟" })).toBe("wei_zhang");
    expect(deriveUsernameBase({ email: "sam.lee@example.com", name: "" })).toBe("sam_lee");
  });

  it("tries every source before padding a short one", () => {
    expect(deriveUsernameBase({ email: "jo@x.com", name: "Jonathan Smith" })).toBe("jonathan_smith");
    expect(deriveUsernameBase({ email: "bob@x.com", name: "Al" })).toBe("bob");
    expect(deriveUsernameBase({ email: "j@x.com", name: "Jo" })).toBe("jo_player"); // the longer partial
  });

  it("cuts long names to the base limit without a trailing underscore", () => {
    const base = deriveUsernameBase({ email: "the.quick.brown.fox.jumps@example.com" });
    expect(base).toBe("the_quick_brown");
    expect(base.length).toBeLessThanOrEqual(USERNAME_BASE_MAX);
    expect(deriveUsernameBase({ email: "abcdefghijklmn.op@example.com" })).toBe("abcdefghijklmn");
  });

  it("pads short names", () => {
    expect(deriveUsernameBase({ email: "jo@example.com" })).toBe("jo_player");
    expect(deriveUsernameBase({ email: "x@example.com" })).toBe("x_player");
  });

  it("uses a placeholder when nothing is usable", () => {
    expect(deriveUsernameBase({ email: "张伟@example.com", name: "张伟" })).toBe("player");
    expect(deriveUsernameBase({ email: "...@example.com", name: "!!!" })).toBe("player");
    expect(deriveUsernameBase({})).toBe("player");
  });

  it("always produces a valid username", () => {
    const inputs = [
      { email: "a@b.c" },
      { email: "__@b.c", name: "_" },
      { email: "ÀÉÎÕÜ.ñ@b.c" },
      { name: "  " },
      { email: "1234567890123456789012345@b.c" },
      { name: "😀 Émilie-Anne  O'Connor-Smythe the Third" },
    ];
    for (const hints of inputs) {
      const base = deriveUsernameBase(hints);
      expect(isValidUsername(base), `${JSON.stringify(hints)} -> ${base}`).toBe(true);
      expect(base.length).toBeLessThanOrEqual(USERNAME_BASE_MAX);
    }
  });
});

describe("pickAvailableUsername", () => {
  it("returns the base when it's free", () => {
    expect(pickAvailableUsername("ana", new Set())).toBe("ana");
    expect(pickAvailableUsername("ana", new Set(["ana2"]))).toBe("ana");
  });

  it("appends the smallest free number on a collision", () => {
    expect(pickAvailableUsername("ana", new Set(["ana"]))).toBe("ana2");
    expect(pickAvailableUsername("ana", new Set(["ana", "ana2", "ana3"]))).toBe("ana4");
    expect(pickAvailableUsername("ana", new Set(["ana", "ana3"]))).toBe("ana2");
  });

  it("stays a valid username for the longest base", () => {
    const base = "a".repeat(USERNAME_BASE_MAX);
    const taken = new Set([base, ...Array.from({ length: 998 }, (_, i) => `${base}${i + 2}`)]);
    const picked = pickAvailableUsername(base, taken);
    expect(picked).toBe(`${base}1000`);
    expect(isValidUsername(picked)).toBe(true);
  });
});

describe("randomizedUsername", () => {
  it("adds the suffix after an underscore", () => {
    expect(randomizedUsername("ana", "x7k2")).toBe("ana_x7k2");
  });

  it("shortens the base, never the suffix, to stay a valid username", () => {
    const name = randomizedUsername("a".repeat(USERNAME_BASE_MAX), "x7k2");
    expect(name).toBe(`${"a".repeat(USERNAME_BASE_MAX)}_x7k2`);
    expect(isValidUsername(name)).toBe(true);
    expect(randomizedUsername("abcdefghijklmn_", "z9")).toBe("abcdefghijklmn_z9"); // no "__"
    expect(isValidUsername(randomizedUsername("abcdefghijklmnopq", "000000"))).toBe(true);
  });

  it("refuses a suffix that isn't lowercase letters and digits", () => {
    expect(() => randomizedUsername("ana", "X7")).toThrow();
    expect(() => randomizedUsername("ana", "")).toThrow();
    expect(() => randomizedUsername("ana", "a_b")).toThrow();
  });
});

describe("usernameCollisionPattern", () => {
  it("matches the base and its numbered variants only", () => {
    const re = new RegExp(usernameCollisionPattern("ana_b"));
    expect(re.test("ana_b")).toBe(true);
    expect(re.test("ana_b12")).toBe(true);
    expect(re.test("ana_bx")).toBe(false);
    expect(re.test("xana_b")).toBe(false);
    expect(re.test("ana_b_2")).toBe(false);
  });

  it("refuses anything that isn't a username base", () => {
    expect(() => usernameCollisionPattern("a.b")).toThrow();
    expect(() => usernameCollisionPattern("")).toThrow();
  });
});

describe("deriveDisplayName", () => {
  it("uses the provider name, with whitespace tidied", () => {
    expect(deriveDisplayName("  Ana   Belén  ", "ana")).toBe("Ana Belén");
    expect(deriveDisplayName("张伟", "player")).toBe("张伟");
  });

  it("falls back to the username", () => {
    expect(deriveDisplayName(null, "ana")).toBe("ana");
    expect(deriveDisplayName("   ", "ana")).toBe("ana");
    expect(deriveDisplayName("‮​", "ana")).toBe("ana");
  });

  it("strips control and bidi-override characters", () => {
    expect(deriveDisplayName("Ana‮Ruiz\u0007", "ana")).toBe("Ana Ruiz");
  });

  it("cuts long names to the limit without splitting a character", () => {
    const long = `${"x".repeat(39)}👨‍👩‍👧`;
    expect(deriveDisplayName(long, "ana")).toBe("x".repeat(39));
    const name = deriveDisplayName("Émilie ".repeat(10), "ana");
    expect(name.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(displayNameSchema.safeParse(name).success).toBe(true);
    expect(name).toBe("Émilie Émilie Émilie Émilie Émilie Émili");
  });

  it("keeps emoji sequences intact", () => {
    expect(deriveDisplayName("Sam 👨‍👩‍👧", "sam")).toBe("Sam 👨‍👩‍👧");
  });
});

describe("numberedDisplayName", () => {
  it("leaves the first one alone and numbers the rest", () => {
    expect(numberedDisplayName("Ana Ruiz", 1)).toBe("Ana Ruiz");
    expect(numberedDisplayName("Ana Ruiz", 2)).toBe("Ana Ruiz 2");
  });

  it("shortens the name, never the number, to stay within the limit", () => {
    const long = "x".repeat(DISPLAY_NAME_MAX);
    const numbered = numberedDisplayName(long, 12);
    expect(numbered).toBe(`${"x".repeat(DISPLAY_NAME_MAX - 3)} 12`);
    expect(displayNameSchema.safeParse(numbered).success).toBe(true);
    expect(numberedDisplayName(`${"y".repeat(37)}👨‍👩‍👧`, 2)).toBe(`${"y".repeat(37)} 2`);
  });
});

describe("suffixedDisplayName", () => {
  it("adds the suffix after a space, shortening the name to fit", () => {
    expect(suffixedDisplayName("Ana Ruiz", "x7k2")).toBe("Ana Ruiz x7k2");
    const long = suffixedDisplayName("x".repeat(DISPLAY_NAME_MAX), "x7k2");
    expect(long).toBe(`${"x".repeat(DISPLAY_NAME_MAX - 5)} x7k2`);
    expect(displayNameSchema.safeParse(long).success).toBe(true);
  });
});

describe("nextDisplayNumber", () => {
  it("is 2 when only the name itself is taken, or nothing is", () => {
    expect(nextDisplayNumber("Ana Ruiz", [])).toBe(2);
    expect(nextDisplayNumber("Ana Ruiz", ["ana ruiz"])).toBe(2);
  });

  it("goes past the highest number in use, case-insensitively", () => {
    expect(nextDisplayNumber("Ana Ruiz", ["Ana Ruiz", "ANA RUIZ 2", "ana ruiz 8", "Ana Ruiz 3"])).toBe(9);
  });

  it("ignores names that only start the same way", () => {
    expect(nextDisplayNumber("Ana", ["Ana Ruiz", "Ana 2b", "Ana 02", "Anabel 4", "Ana  3"])).toBe(2);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("100%_real\\")).toBe("100\\%\\_real\\\\");
    expect(escapeLike("Ana Ruiz")).toBe("Ana Ruiz");
  });
});
