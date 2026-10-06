import { describe, expect, it } from "vitest";
import { assetRefSchema, assetUrl, referencedAssetIds, viewReferencesAsset } from "./assets";

const A = "0b6f3f0e-6d1c-4f5e-9a51-3f1f1c2d9e01";
const B = "7c2a9d44-1b2e-4c3d-8e4f-5a6b7c8d9e02";
const C = "e3d2c1b0-a9f8-4e7d-b6c5-a4b3c2d1e003";

describe("referencedAssetIds", () => {
  it("finds uuids at any depth, in arrays and objects, lowercased", () => {
    const value = { frames: [{ id: A, width: 1, height: 1 }], meta: { nested: [[B.toUpperCase()]] }, n: 3, ok: true, none: null };
    expect(referencedAssetIds(value)).toEqual(new Set([A, B]));
  });

  it("ignores strings that merely contain a uuid", () => {
    expect(referencedAssetIds({ url: `/api/assets/${A}`, note: `${A} ` })).toEqual(new Set());
  });

  it("refuses pathologically deep values", () => {
    let deep: unknown = A;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(() => referencedAssetIds(deep)).toThrow(/nested too deeply/);
  });
});

describe("viewReferencesAsset", () => {
  const view = { puzzle: { barcode: { id: A } }, state: { revealed: [{ id: B }] }, reveal: null };

  it("allows assets shown in the puzzle or unlocked in the state", () => {
    expect(viewReferencesAsset(view, A)).toBe(true);
    expect(viewReferencesAsset(view, B)).toBe(true);
    expect(viewReferencesAsset(view, B.toUpperCase())).toBe(true);
  });

  it("allows assets surfaced by the reveal once the play is over", () => {
    expect(viewReferencesAsset(view, C)).toBe(false);
    expect(viewReferencesAsset({ ...view, reveal: { still: { id: C } } }, C)).toBe(true);
  });
});

describe("asset refs", () => {
  it("validates ids and dimensions", () => {
    expect(assetRefSchema.safeParse({ id: A, width: 640, height: 360 }).success).toBe(true);
    expect(assetRefSchema.safeParse({ id: "not-a-uuid", width: 640, height: 360 }).success).toBe(false);
    expect(assetRefSchema.safeParse({ id: A, width: 0, height: 360 }).success).toBe(false);
  });

  it("builds the serving URL", () => {
    expect(assetUrl(A)).toBe(`/api/assets/${A}`);
  });
});
