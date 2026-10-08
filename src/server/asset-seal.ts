import "server-only";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { referencedAssetIds, SEALED_NONCE_BYTES, type SealedAssets } from "@/core/assets";
import { serverEnv } from "./env";

/**
 * Sealed puzzle images (see `src/core/assets.ts`). Each asset has its own AES-256 key, derived from
 * the server's puzzle secret and the asset id, so nothing about keys is stored and every existing
 * image can be sealed. The distinct HKDF label keeps these keys apart from the puzzle seeds the same
 * secret makes.
 */
const SEAL_LABEL = "daily-games/puzzle-asset-seal/v1";

function sealKey(assetId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", serverEnv().PUZZLE_SEED_SECRET, assetId.toLowerCase(), SEAL_LABEL, 32));
}

/** The key the browser needs to open `assetId`'s sealed copy (base64url). */
export function assetKey(assetId: string): string {
  return sealKey(assetId).toString("base64url");
}

/**
 * `bytes` encrypted for `assetId`: a fresh random nonce, then AES-256-GCM ciphertext with its tag
 * (the layout WebCrypto's decrypt expects after the nonce). A new nonce every time, so sealing the
 * same id twice, even with different bytes, never reuses one.
 */
export function sealAsset(assetId: string, bytes: Uint8Array): Buffer {
  const nonce = randomBytes(SEALED_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealKey(assetId), nonce);
  return Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}

/**
 * A view's sealed images: every image id in the puzzle and solution to preload, and keys for those
 * in the parts the player sees (the asset access rule). The ids are random and the bytes sealed, so
 * listing a level before it is earned gives nothing away.
 */
export function sealedAssets(parts: { puzzle: unknown; solution: unknown; visible: readonly unknown[] }): SealedAssets {
  const preload = new Set([...referencedAssetIds(parts.puzzle), ...referencedAssetIds(parts.solution)]);
  const shown = new Set(parts.visible.flatMap((part) => [...referencedAssetIds(part)]));
  const keys: Record<string, string> = {};
  for (const id of [...shown].sort()) keys[id] = assetKey(id);
  // In the order the puzzle lists them (level 1 first), so the first levels arrive first.
  return { preload: [...preload], keys };
}
