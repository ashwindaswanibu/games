import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SEALED_NONCE_BYTES } from "@/core/assets";
import { assetKey, sealAsset, sealedAssets } from "./asset-seal";

vi.mock("./env", () => ({ serverEnv: () => ({ PUZZLE_SEED_SECRET: "x".repeat(40) }) }));

const LEVEL_1 = "0a8f2c34-1b2d-4c5e-8f90-123456789abc";
const LEVEL_2 = "1b9e3d45-2c3e-4d6f-9a01-23456789abcd";
const LEVEL_3 = "2cad4e56-3d4f-4e70-8b12-3456789abcde";

/** What the browser does (src/lib/sealed-assets.ts), with Node's WebCrypto. */
async function open(sealed: Buffer, key: string): Promise<Buffer> {
  const cryptoKey = await webcrypto.subtle.importKey("raw", Buffer.from(key, "base64url"), "AES-GCM", false, ["decrypt"]);
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, SEALED_NONCE_BYTES) }, cryptoKey, sealed.subarray(SEALED_NONCE_BYTES));
  return Buffer.from(plain);
}

describe("sealAsset", () => {
  const image = Buffer.from("RIFF....WEBPVP8 pretend image bytes");

  it("opens with the asset's key, as WebCrypto does it", async () => {
    expect(await open(sealAsset(LEVEL_1, image), assetKey(LEVEL_1))).toEqual(image);
  });

  it("doesn't open with another asset's key", async () => {
    await expect(open(sealAsset(LEVEL_1, image), assetKey(LEVEL_2))).rejects.toThrow();
  });

  it("uses a fresh nonce every time", () => {
    expect(sealAsset(LEVEL_1, image).subarray(0, SEALED_NONCE_BYTES)).not.toEqual(sealAsset(LEVEL_1, image).subarray(0, SEALED_NONCE_BYTES));
  });

  it("derives the same key for an id in any case", () => {
    expect(assetKey(LEVEL_1.toUpperCase())).toBe(assetKey(LEVEL_1));
    expect(assetKey(LEVEL_1)).not.toBe(assetKey(LEVEL_2));
  });
});

describe("sealedAssets", () => {
  const puzzle = { first: { id: LEVEL_1, width: 2400, height: 800 } };
  const solution = { answer: { id: 7, title: "The Matrix" }, levels: [LEVEL_1, LEVEL_2, LEVEL_3].map((id) => ({ id, width: 2400, height: 800 })) };

  it("lists every image of the puzzle in level order, and keys only the ones the player sees", () => {
    const sealed = sealedAssets({ puzzle, solution, visible: [puzzle, { levels: [{ id: LEVEL_2 }] }, null] });
    expect(sealed.preload).toEqual([LEVEL_1, LEVEL_2, LEVEL_3]);
    expect(Object.keys(sealed.keys).sort()).toEqual([LEVEL_1, LEVEL_2].sort());
    expect(sealed.keys[LEVEL_1]).toBe(assetKey(LEVEL_1));
  });

  it("gives no keys before anything is shown", () => {
    expect(sealedAssets({ puzzle, solution, visible: [] }).keys).toEqual({});
  });
});
