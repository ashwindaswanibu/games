import type { BucketId } from "@/core/game";

/**
 * Each bucket's sheet. Constant in every light (§3.1). Bright sheets (vermilion, ochre) take ink
 * print; deep sheets (teal, ultramarine) take cream print.
 */
export const BUCKET_COLOR: Readonly<Record<BucketId, string>> = {
  words: "var(--verm)",
  movies: "var(--ochre)",
  geography: "var(--teal)",
  chess: "var(--ultra)",
};

export const BUCKET_TIER: Readonly<Record<BucketId, "bright" | "deep">> = {
  words: "bright",
  movies: "bright",
  geography: "deep",
  chess: "deep",
};

/** The colour each sheet spills into the dark room (sRGB, for the night canvas). */
export const BUCKET_RGB: Readonly<Record<BucketId, string>> = {
  words: "214,89,56",
  movies: "224,165,62",
  geography: "37,113,104",
  chess: "47,70,147",
};
