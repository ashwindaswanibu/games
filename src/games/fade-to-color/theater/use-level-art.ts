"use client";

import { useEffect, useRef, useState } from "react";
import { assetUrl, type AssetRef } from "@/core/assets";
import { accentOf, cssTriplet, litBands } from "../palette";

/** Everything the screen draws from one level, derived once in the browser from the image. */
export interface LevelArt {
  /** The level itself, as the reel shows it. */
  src: string;
  /** The level's accent, "r g b". */
  accent: string;
  /** A one-pixel-tall strip of the barcode as light (see `litBands`), as a data URL. */
  bands: string;
  /** The level flipped and softened, for the reflection on the floor below the reel. */
  reflection: string;
  /** A small copy for the contact strip. */
  thumb: string;
}

/** What the room is lit with before the first level arrives: warm projector light. */
export const HOUSE_ACCENT = "236 214 178";

const SAMPLE = { w: 64, h: 22 };
const BANDS = { w: 160, h: 24 };
const REFLECTION = { w: 600, h: 200 };
const THUMB = { w: 192, h: 64 };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return { c, ctx };
}

function derive(img: HTMLImageElement, src: string): LevelArt {
  const sample = canvas(SAMPLE.w, SAMPLE.h);
  sample.ctx.drawImage(img, 0, 0, SAMPLE.w, SAMPLE.h);
  const accent = cssTriplet(accentOf(sample.ctx.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data));

  const strip = canvas(BANDS.w, BANDS.h);
  strip.ctx.drawImage(img, 0, 0, BANDS.w, BANDS.h);
  const lit = litBands(strip.ctx.getImageData(0, 0, BANDS.w, BANDS.h).data, BANDS.w, BANDS.h);
  const line = canvas(BANDS.w, 1);
  const row = line.ctx.createImageData(BANDS.w, 1);
  lit.forEach(([r, g, b], x) => row.data.set([r, g, b, 255], x * 4));
  line.ctx.putImageData(row, 0, 0);

  const floor = canvas(REFLECTION.w, REFLECTION.h);
  floor.ctx.filter = "blur(1.5px)"; // one static pass; ignored where unsupported
  floor.ctx.translate(0, REFLECTION.h);
  floor.ctx.scale(1, -1);
  floor.ctx.drawImage(img, 0, 0, REFLECTION.w, REFLECTION.h);

  const thumb = canvas(THUMB.w, THUMB.h);
  thumb.ctx.drawImage(img, 0, 0, THUMB.w, THUMB.h);

  return {
    src,
    accent,
    bands: line.c.toDataURL("image/png"),
    reflection: floor.c.toDataURL("image/jpeg", 0.72),
    thumb: thumb.c.toDataURL("image/jpeg", 0.8),
  };
}

async function load(ref: AssetRef): Promise<LevelArt> {
  const src = assetUrl(ref.id);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return derive(img, src);
}

/**
 * Loads each level the player may see and derives its art, keyed by asset id. Levels arrive one
 * at a time as they are earned; each is fetched and worked out once. A level that fails to load
 * gets plain art (the image URL and the house light) so the screen never waits on it forever.
 */
export function useLevelArt(levels: readonly AssetRef[]): ReadonlyMap<string, LevelArt> {
  const [art, setArt] = useState<ReadonlyMap<string, LevelArt>>(() => new Map());
  const started = useRef(new Set<string>());
  const mounted = useRef(false);
  const ids = levels.map((l) => l.id).join(",");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const ref of levels) {
      if (started.current.has(ref.id)) continue;
      started.current.add(ref.id);
      load(ref)
        .catch((): LevelArt => ({ src: assetUrl(ref.id), accent: HOUSE_ACCENT, bands: "", reflection: "", thumb: "" }))
        .then((done) => {
          if (mounted.current) setArt((prev) => new Map(prev).set(ref.id, done));
        });
    }
    // `ids` stands for `levels`: a new array with the same levels needs no work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return art;
}
