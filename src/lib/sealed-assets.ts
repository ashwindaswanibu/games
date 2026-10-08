"use client";

import { useEffect, useState } from "react";
import { assetUrl, SEALED_NONCE_BYTES, sealedAssetUrl, type SealedAssets } from "@/core/assets";

/*
 * The browser side of sealed puzzle images (see `src/core/assets.ts`). A play view's `sealed.preload`
 * starts every image downloading, encrypted, as soon as the game opens; `sealed.keys` arrive with
 * the views that show them (the start, each earned level), and an image opens the moment both are
 * here. Without WebCrypto (a plain-http page) or a key, an image comes from the authorized route
 * instead, as before.
 *
 * One store for the page: images are the same whichever component asks, and each is downloaded,
 * opened and turned into an object URL once.
 */

const keys = new Map<string, string>();
const downloads = new Map<string, Promise<{ data: ArrayBuffer; type: string }>>();
const blobs = new Map<string, Promise<Blob>>();
const urls = new Map<string, Promise<string>>();

const canUnseal = () => typeof window !== "undefined" && window.isSecureContext && typeof crypto !== "undefined" && Boolean(crypto.subtle);

function download(id: string) {
  let pending = downloads.get(id);
  if (!pending) {
    pending = fetch(sealedAssetUrl(id)).then(async (response) => {
      if (!response.ok) throw new Error(`Sealed image ${id} didn't load (${response.status})`);
      return { data: await response.arrayBuffer(), type: response.headers.get("X-Asset-Type") ?? "" };
    });
    downloads.set(id, pending);
    pending.catch(() => downloads.delete(id));
  }
  return pending;
}

/** Takes in a view's sealed images: remembers its keys and starts downloading what it lists. */
export function receiveSealed(sealed: SealedAssets | undefined): void {
  if (!sealed || typeof window === "undefined") return;
  for (const [id, key] of Object.entries(sealed.keys)) keys.set(id, key);
  if (canUnseal()) for (const id of sealed.preload) void download(id);
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function unseal(id: string, key: string): Promise<Blob> {
  const { data, type } = await download(id);
  const cryptoKey = await crypto.subtle.importKey("raw", fromBase64Url(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, SEALED_NONCE_BYTES) }, cryptoKey, data.slice(SEALED_NONCE_BYTES));
  return new Blob([plain], { type });
}

async function plain(id: string): Promise<Blob> {
  const response = await fetch(assetUrl(id));
  if (!response.ok) throw new Error(`Image ${id} didn't load (${response.status})`);
  return response.blob();
}

/** An image the player's view shows, as a Blob: opened from its sealed copy, else from the authorized route. */
export function assetBlob(id: string): Promise<Blob> {
  let pending = blobs.get(id);
  if (!pending) {
    const key = keys.get(id);
    pending = key && canUnseal() ? unseal(id, key).catch(() => plain(id)) : plain(id);
    blobs.set(id, pending);
    pending.catch(() => blobs.delete(id));
  }
  return pending;
}

/** A same-origin object URL for an image the view shows (safe to draw to a canvas and read back). */
export function assetObjectUrl(id: string): Promise<string> {
  let pending = urls.get(id);
  if (!pending) {
    pending = assetBlob(id).then((blob) => URL.createObjectURL(blob));
    urls.set(id, pending);
    pending.catch(() => urls.delete(id));
  }
  return pending;
}

/** Forgets a failed image so the next ask starts over (a "Try again"). */
export function forgetAsset(id: string): void {
  downloads.delete(id);
  blobs.delete(id);
  urls.delete(id);
}

/** The object URL of `id` once it's open (null while it opens); `failed` if it couldn't be loaded. */
export function useAssetSrc(id: string | null, attempt = 0): { src: string | null; failed: boolean } {
  const [loaded, setLoaded] = useState<{ id: string; attempt: number; src: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    assetObjectUrl(id).then(
      (src) => live && setLoaded({ id, attempt, src, failed: false }),
      () => live && setLoaded({ id, attempt, src: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  return loaded && loaded.id === id && loaded.attempt === attempt ? { src: loaded.src, failed: loaded.failed } : { src: null, failed: false };
}
