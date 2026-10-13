"use client";

import { useEffect, useState } from "react";
import type { AssetRef } from "@/core/assets";
import { accentOf, columnMeans, cssTriplet, type Rgb } from "@/lib/film-palette";
import { assetBlob } from "@/lib/sealed-assets";

/*
 * The film is the room's one colour: the home takes today's strip the way the game does and presses
 * it into the Movies name (hard bars of flat colour in film order, as the game's own wordmark is
 * pressed), and its accent falls across the seams beside it and prints the reel's edge. Worked out
 * once, in the browser, from a small decode of the picture.
 */

/** What the room is lit with before the film's light is known: the game's warm house light. */
const HOUSE = "236 214 178";

/** The passes below draw from the picture at this size, decoded off the main thread. */
const SOURCE = { w: 600, h: 200 };
const SAMPLE = { w: 64, h: 22 };
const BANDS = { w: 160, h: 24 };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  // Each canvas is read back once or twice, so it stays on the GPU: `willReadFrequently` would put
  // it on the CPU, and its first `drawImage` would freeze the page for ~150 ms on a phone.
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return { c, ctx };
}

async function derive(id: string): Promise<{ columns: Rgb[]; accent: string }> {
  const bitmap = await createImageBitmap(await assetBlob(id), { resizeWidth: SOURCE.w, resizeHeight: SOURCE.h, resizeQuality: "medium" });
  try {
    const sample = canvas(SAMPLE.w, SAMPLE.h);
    sample.ctx.drawImage(bitmap, 0, 0, SAMPLE.w, SAMPLE.h);
    const accent = cssTriplet(accentOf(sample.ctx.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data));
    const strip = canvas(BANDS.w, BANDS.h);
    strip.ctx.drawImage(bitmap, 0, 0, BANDS.w, BANDS.h);
    return { columns: columnMeans(strip.ctx.getImageData(0, 0, BANDS.w, BANDS.h).data, BANDS.w, BANDS.h), accent };
  } finally {
    bitmap.close();
  }
}

/**
 * Today's film as light: `columns`, the strip's column colours to press a name from (null until
 * worked out), and `accent`, its colour as "r g b" (the house light until then, and if the picture
 * can't be read).
 */
export function useFilmLight(asset: AssetRef | null): { columns: Rgb[] | null; accent: string } {
  const [light, setLight] = useState<{ id: string; columns: Rgb[]; accent: string } | null>(null);
  const id = asset?.id ?? null;
  useEffect(() => {
    if (!id) return;
    let live = true;
    derive(id).then(
      (art) => live && setLight({ id, ...art }),
      () => {
        // Unreadable picture: the room keeps its house light.
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  return light && light.id === id ? { columns: light.columns, accent: light.accent } : { columns: null, accent: HOUSE };
}
