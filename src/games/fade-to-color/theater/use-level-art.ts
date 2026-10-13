"use client";

import { useEffect, useRef, useState } from "react";
import { assetUrl, type AssetRef } from "@/core/asset-urls";
import { assetBlob, assetObjectUrl } from "@/lib/sealed-assets";
import { accentOf, columnMeans, cssTriplet, gradeRgb, litBands, type Rgb } from "../palette";

/**
 * Everything the screen draws from one level, derived once in the browser from the image. The
 * picture comes first, as soon as it's opened and decoded; its colours follow once they're worked
 * out (`developed`), the house light standing in until then.
 */
export interface LevelArt {
  /** The level itself, as the reel shows it. */
  src: string;
  /** The colours below are the level's own (until then: the house light, and nothing to draw). */
  developed: boolean;
  /** The level's accent, "r g b". */
  accent: string;
  /** A one-pixel-tall strip of the barcode as light (see `litBands`), as a data URL. */
  bands: string;
  /** The same strip through the title light's grade (`gradeRgb`), baked in so no layer is filtered live. */
  graded: string;
  /** The barcode's light at its lowest frequency, a 12-pixel strip (see `ROOM`): the wash across the room. */
  room: string;
  /** The level's columns, each one's mean colour (`columnMeans`): what the titles are pressed from (`bars.ts`). */
  columns: readonly Rgb[];
  /** A small copy for the contact strip. */
  thumb: string;
}

/** What the room is lit with before the first level arrives: plain projector white. */
export const HOUSE_ACCENT = "230 229 225";

const SAMPLE = { w: 64, h: 22 };
const BANDS = { w: 160, h: 24 };
/** One column per band of the first reel. */
const COLUMNS = { w: 480, h: 24 };
/** The wash is the bands averaged into this many bins: scaled up smoothly, it reads as light, with no seams. */
const ROOM = 12;
const THUMB = { w: 192, h: 64 };

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

/** One row of colours as a one-pixel-tall PNG. */
function stripUrl(colors: readonly Rgb[]): string {
  const line = canvas(colors.length, 1);
  const row = line.ctx.createImageData(colors.length, 1);
  colors.forEach(([r, g, b], x) => row.data.set([r, g, b, 255], x * 4));
  line.ctx.putImageData(row, 0, 0);
  return line.c.toDataURL("image/png");
}

/** Every pass below draws from the level decoded at this size, never the full image. */
const SOURCE = { w: 600, h: 200 };

/** `colors` averaged into `n` equal bins, in order. */
function binned(colors: readonly Rgb[], n: number): Rgb[] {
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * colors.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * colors.length) / n));
    const run = colors.slice(from, to);
    return [0, 1, 2].map((c) => Math.round(run.reduce((sum, rgb) => sum + rgb[c], 0) / run.length)) as unknown as Rgb;
  });
}

/** A level whose picture is in and whose colours are still being worked out (or couldn't be). */
function undeveloped(src: string, developed = false): LevelArt {
  return { src, developed, accent: HOUSE_ACCENT, bands: "", graded: "", room: "", columns: [], thumb: "" };
}

function derive(img: ImageBitmap, src: string): LevelArt {
  const sample = canvas(SAMPLE.w, SAMPLE.h);
  sample.ctx.drawImage(img, 0, 0, SAMPLE.w, SAMPLE.h);
  const accent = cssTriplet(accentOf(sample.ctx.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data));

  const strip = canvas(BANDS.w, BANDS.h);
  strip.ctx.drawImage(img, 0, 0, BANDS.w, BANDS.h);
  const lit = litBands(strip.ctx.getImageData(0, 0, BANDS.w, BANDS.h).data, BANDS.w, BANDS.h);

  const cols = canvas(COLUMNS.w, COLUMNS.h);
  cols.ctx.drawImage(img, 0, 0, COLUMNS.w, COLUMNS.h);
  const columns = columnMeans(cols.ctx.getImageData(0, 0, COLUMNS.w, COLUMNS.h).data, COLUMNS.w, COLUMNS.h);

  const thumb = canvas(THUMB.w, THUMB.h);
  thumb.ctx.drawImage(img, 0, 0, THUMB.w, THUMB.h);

  return {
    src,
    developed: true,
    accent,
    bands: stripUrl(lit),
    graded: stripUrl(lit.map((rgb) => gradeRgb(rgb))),
    room: stripUrl(binned(lit, ROOM)),
    columns,
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

async function load(ref: AssetRef, priority: number, onPicture: (art: LevelArt) => void): Promise<LevelArt> {
  // Usually already downloaded (sealed) when the game opened; its key came with this level.
  const [blob, src] = await Promise.all([assetBlob(ref.id), assetObjectUrl(ref.id)]);
  const bitmap = await createImageBitmap(blob, { resizeWidth: SOURCE.w, resizeHeight: SOURCE.h, resizeQuality: "medium" });
  // The picture is open and decodes: it can go up now, while its colours wait for an idle moment.
  onPicture(undeveloped(src));
  try {
    return await whenIdle(priority, () => derive(bitmap, src));
  } finally {
    bitmap.close();
  }
}

/**
 * Loads each level the player may see and derives its art, keyed by asset id: first the picture
 * alone (`developed` false), then with its colours. Levels arrive one at a time as they are earned;
 * each is fetched and worked out once, the latest first (the newest reel, or the film's last once
 * it's over). A level that fails to load gets plain art (the image URL and the house light) so the
 * screen never waits on it forever.
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
      const picture = (art: LevelArt) => {
        if (mounted.current) setArt((prev) => (prev.has(ref.id) ? prev : new Map(prev).set(ref.id, art)));
      };
      load(ref, index, picture)
        .catch(() => undeveloped(assetUrl(ref.id), true))
        .then((done) => {
          if (mounted.current) setArt((prev) => new Map(prev).set(ref.id, done));
        });
    });
    // `ids` stands for `levels`: a new array with the same levels needs no work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return art;
}
