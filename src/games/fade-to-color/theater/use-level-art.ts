"use client";

import { useEffect, useRef, useState } from "react";
import { assetUrl, type AssetRef } from "@/core/assets";
import { accentOf, cssTriplet, gradeRgb, litBands, type Rgb } from "../palette";

/** Everything the screen draws from one level, derived once in the browser from the image. */
export interface LevelArt {
  /** The level itself, as the reel shows it. */
  src: string;
  /** The level's accent, "r g b". */
  accent: string;
  /** A one-pixel-tall strip of the barcode as light (see `litBands`), as a data URL. */
  bands: string;
  /** The same strip through the lit titles' grade (`gradeRgb`), baked in so no layer is filtered live. */
  graded: string;
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

/** One row of colours as a one-pixel-tall PNG. */
function stripUrl(colors: readonly Rgb[]): string {
  const line = canvas(colors.length, 1);
  const row = line.ctx.createImageData(colors.length, 1);
  colors.forEach(([r, g, b], x) => row.data.set([r, g, b, 255], x * 4));
  line.ctx.putImageData(row, 0, 0);
  return line.c.toDataURL("image/png");
}

/** Every pass below draws from the level at this size (the largest of them), never the full image. */
const SOURCE = REFLECTION;

function derive(img: ImageBitmap, src: string): LevelArt {
  const sample = canvas(SAMPLE.w, SAMPLE.h);
  sample.ctx.drawImage(img, 0, 0, SAMPLE.w, SAMPLE.h);
  const accent = cssTriplet(accentOf(sample.ctx.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data));

  const strip = canvas(BANDS.w, BANDS.h);
  strip.ctx.drawImage(img, 0, 0, BANDS.w, BANDS.h);
  const lit = litBands(strip.ctx.getImageData(0, 0, BANDS.w, BANDS.h).data, BANDS.w, BANDS.h);

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
    bands: stripUrl(lit),
    graded: stripUrl(lit.map((rgb) => gradeRgb(rgb))),
    reflection: floor.c.toDataURL("image/jpeg", 0.72),
    thumb: thumb.c.toDataURL("image/jpeg", 0.8),
  };
}

/*
 * Working out a level's art takes a few canvas passes and image encodes, and several levels can
 * arrive at once (the whole film, at the end), right as the screen is animating. So the image is
 * decoded off the main thread, already at the small size the passes need (`createImageBitmap`),
 * and the passes run one level at a time, each in an idle moment with room for it (or once it has
 * waited long enough regardless), the highest `priority` first.
 */

/** An idle moment with less time left than this goes by without a derive. */
const MIN_IDLE_MS = 8;
/** No level waits longer than this for an idle moment. */
const MAX_WAIT_MS = 800;

const jobs: { priority: number; since: number; run(): void }[] = [];
let pumping = false;

function pump(deadline?: IdleDeadline) {
  pumping = false;
  if (jobs.length === 0) return;
  const now = performance.now();
  const overdue = jobs.some((job) => now - job.since >= MAX_WAIT_MS);
  if (deadline && !deadline.didTimeout && !overdue && deadline.timeRemaining() < MIN_IDLE_MS) return schedule();
  jobs.sort((a, b) => b.priority - a.priority);
  jobs.shift()!.run();
  schedule();
}

function schedule() {
  if (pumping || jobs.length === 0) return;
  pumping = true;
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(pump, { timeout: MAX_WAIT_MS });
  else setTimeout(pump, 16);
}

function whenIdle<T>(priority: number, work: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    jobs.push({
      priority,
      since: performance.now(),
      run() {
        try {
          resolve(work());
        } catch (error) {
          reject(error);
        }
      },
    });
    schedule();
  });
}

async function load(ref: AssetRef, priority: number): Promise<LevelArt> {
  const src = assetUrl(ref.id);
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Level ${ref.id} didn't load (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: SOURCE.w, resizeHeight: SOURCE.h, resizeQuality: "medium" });
  try {
    return await whenIdle(priority, () => derive(bitmap, src));
  } finally {
    bitmap.close();
  }
}

/**
 * Loads each level the player may see and derives its art, keyed by asset id. Levels arrive one
 * at a time as they are earned; each is fetched and worked out once, the latest first (the newest
 * reel, or the film's last once it's over). A level that fails to load gets plain art (the image
 * URL and the house light) so the screen never waits on it forever.
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
    levels.forEach((ref, index) => {
      if (started.current.has(ref.id)) return;
      started.current.add(ref.id);
      load(ref, index)
        .catch((): LevelArt => ({ src: assetUrl(ref.id), accent: HOUSE_ACCENT, bands: "", graded: "", reflection: "", thumb: "" }))
        .then((done) => {
          if (mounted.current) setArt((prev) => new Map(prev).set(ref.id, done));
        });
    });
    // `ids` stands for `levels`: a new array with the same levels needs no work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return art;
}
