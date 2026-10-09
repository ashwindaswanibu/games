import { describe, expect, it } from "vitest";
import { faceCrop, isUsableLicense, mainFace, pickImage, plainCredit } from "./portraits.mjs";

describe("isUsableLicense", () => {
  it("takes public domain, CC0 and CC BY / BY-SA", () => {
    for (const name of ["Public domain", "PD-US", "CC0", "CC BY 2.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC-BY-SA-3.0"]) expect(isUsableLicense(name), name).toBe(true);
  });

  it("skips anything else", () => {
    for (const name of ["GFDL", "CC BY-NC 2.0", "CC BY-ND 4.0", "Attribution", "FAL", ""]) expect(isUsableLicense(name), name).toBe(false);
  });
});

describe("plainCredit", () => {
  it("turns Commons' HTML into one line", () => {
    expect(plainCredit('<a href="//commons.wikimedia.org/wiki/User:Foo" title="User:Foo">Foo&nbsp;Bar</a><br/>(talk)')).toBe("Foo Bar (talk)");
    expect(plainCredit("Jos&#233; &amp; Co")).toBe("José & Co");
  });

  it("is null for nothing, and caps a long credit", () => {
    expect(plainCredit("  <span></span> ")).toBeNull();
    expect(plainCredit(undefined)).toBeNull();
    expect(plainCredit("x".repeat(400), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("pickImage", () => {
  const claim = (value: string, rank: "preferred" | "normal" | "deprecated" = "normal") => ({ rank, mainsnak: { datavalue: { value } } });

  it("prefers a preferred photo, else the first, never a deprecated one", () => {
    expect(pickImage([claim("a.jpg"), claim("b.jpg", "preferred")])).toBe("b.jpg");
    expect(pickImage([claim("a.jpg", "deprecated"), claim("b.jpg")])).toBe("b.jpg");
    expect(pickImage([claim("a.jpg", "deprecated")])).toBeNull();
    expect(pickImage(undefined)).toBeNull();
  });
});

describe("faces", () => {
  it("frames the largest confident face", () => {
    const small = { x: 0, y: 0, w: 10, h: 10, c: 0.9 };
    const big = { x: 50, y: 50, w: 40, h: 40, c: 0.8 };
    const unsure = { x: 0, y: 0, w: 99, h: 99, c: 0.2 };
    expect(mainFace([small, big, unsure])).toBe(big);
    expect(mainFace([unsure])).toBeNull();
  });

  it("cuts a square twice the face across, the face 44% down", () => {
    expect(faceCrop(1000, 1000, { x: 400, y: 300, w: 200, h: 200 })).toEqual({ left: 290, top: 215, size: 420 });
  });

  it("shrinks the square to a small photo and keeps it inside the edges", () => {
    expect(faceCrop(300, 500, { x: 20, y: 10, w: 200, h: 200 })).toEqual({ left: 0, top: 0, size: 300 });
    expect(faceCrop(800, 600, { x: 700, y: 500, w: 90, h: 90 })).toEqual({ left: 611, top: 411, size: 189 });
  });
});
