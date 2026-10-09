/**
 * Portraits for the catalog's people (see `../portraits.mts`): the pure parts. Which Commons
 * licenses we may use, the credit as plain text, which of a person's photos to take, and the
 * square crop around a face.
 */

/** Square side of a stored portrait, in pixels (shown up to ~320 CSS px, dim and soft-edged). */
export const PORTRAIT_SIZE = 384;

/**
 * Licenses we can use with a credit: public domain, CC0 and Creative Commons Attribution (and
 * ShareAlike, whose adaptation, our crop, stays under it). Commons only hosts free files, but some
 * carry terms beyond these (GFDL-only, "attribution only" variants); those are skipped, not guessed.
 */
export function isUsableLicense(shortName: string): boolean {
  const name = shortName.trim();
  return /^(public domain|pd\b|cc0\b|cc[- ]zero)/i.test(name) || /^cc[- ]by(-sa)?[- ]\d(\.\d)?(\b|$)/i.test(name);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Commons' `Artist` field as one line of plain text (it's HTML: links, spans, line breaks), or null. */
export function plainCredit(html: string | null | undefined, max = 300): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One Wikidata claim on P18 (image), as `wbgetentities` returns it. */
export interface ImageClaim {
  rank?: "preferred" | "normal" | "deprecated";
  mainsnak?: { datavalue?: { value?: unknown } };
}

/** The photo to use from a person's P18 claims: a preferred one, else the first normal one; never a deprecated one. */
export function pickImage(claims: readonly ImageClaim[] | undefined): string | null {
  const usable = (claims ?? []).filter((c) => c.rank !== "deprecated" && typeof c.mainsnak?.datavalue?.value === "string");
  const best = usable.find((c) => c.rank === "preferred") ?? usable[0];
  return best ? (best.mainsnak!.datavalue!.value as string) : null;
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detector confidence, 0–1. */
  c: number;
}

/** Faces below this confidence are ignored. */
export const MIN_FACE_CONFIDENCE = 0.5;

/** The face to frame: the largest confident one (a group photo's subject is usually the largest). */
export function mainFace(faces: readonly FaceBox[]): FaceBox | null {
  const confident = faces.filter((f) => f.c >= MIN_FACE_CONFIDENCE);
  return confident.reduce<FaceBox | null>((best, f) => (best && best.w * best.h >= f.w * f.h ? best : f), null);
}

/**
 * The square to cut from a `width`×`height` photo around `face`: about twice the face across (head
 * and some shoulder), with the face's centre 44% of the way down, where the screen's round mask is
 * brightest. Shrunk to fit a small photo, then slid inside its edges.
 */
export function faceCrop(width: number, height: number, face: Pick<FaceBox, "x" | "y" | "w" | "h">): { left: number; top: number; size: number } {
  const size = Math.max(1, Math.round(Math.min(width, height, 2.1 * Math.max(face.w, face.h))));
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(0, value), max));
  return { left: clamp(cx - size / 2, width - size), top: clamp(cy - 0.44 * size, height - size), size };
}
