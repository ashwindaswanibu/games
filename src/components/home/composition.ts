/**
 * The day's composition: every seeded cut, angle and position on the home, from the date alone.
 * Pure, and run on the server: the client root receives plain strings, so the picture is identical
 * on every device for a day and nothing about it is computed (or can shift) after the first paint.
 * Colours are fixed (they must hold in every light); only the cuts and angles change by date.
 */

import type { HomeView } from "@/core/home-view";
import { DAY_INK, DAY_LSB, DAY_RSB, LG_CAP, MONTH_ADVANCE } from "./type-metrics";
import { between, cutRect, cutWord, fixed, polygon, rng, sheetClip, tornTopClip, type CutWord } from "./geometry";

export interface HomeComposition {
  /** The teal strip behind the title: its cut, where it stands and how far it leans. */
  strip: { clip: string; left: string; rotate: string };
  /** The TODAY band's angle (degrees) and cut. */
  band: { rotate: string; clip: string };
  /** One cut per bucket: its open sheet, its In production card. */
  sheets: Readonly<Record<string, string>>;
  wings: Readonly<Record<string, string>>;
  /** One title card per game for the set-in (`date:card:<gameId>`). */
  cards: Readonly<Record<string, string>>;
  /** The slips: welcome, up next; FIN's vermilion plate. */
  slips: { welcome: string; upNext: string; fin: string };
  /** The phone's torn tab bar. */
  tabTear: string;
  /** Cut letters: the Words title, the opening's Words card, FIN. */
  words: CutWord;
  wordsCard: CutWord;
  fin: CutWord;
  /** North by Northwest: the vanishing point, as a fraction of the head's width. */
  vanishX: number;
  /** The dial's rim seed. */
  dialSeed: string;
  /** League Gothic metrics for today's month and numeral (em), as inline CSS variables. */
  type: { monthAdvance: number; dayInk: number; dayLsb: number; dayRsb: number; cap: number };
}

export function composeHome(view: Pick<HomeView, "day" | "buckets">): HomeComposition {
  const seed = view.day.date;
  const r = rng(`${seed}:composition`);

  const stripR = rng(`${seed}:strip`);
  const strip = {
    left: `${fixed(between(stripR, 26, 34), 1)}%`,
    rotate: `${fixed(-between(stripR, 13, 18), 1)}deg`,
    clip: polygon(cutRect(stripR, { j: 2, a: 0.8, n: [2, 7, 2, 7] })),
  };

  const band = {
    rotate: `${fixed(-between(r, 1.0, 2.2))}deg`,
    clip: polygon(cutRect(rng(`${seed}:band`), { j: 0.5, a: 0.4, n: [6, 1, 6, 1], tear: { r: true }, tn: 6, ta: 1.6 })),
  };

  const sheets: Record<string, string> = {};
  const wings: Record<string, string> = {};
  for (const b of view.buckets) {
    sheets[b.id] = sheetClip(rng(`${seed}:sheet:${b.id}`), { cut: 2.4, depth: 6, tornBottom: true });
    wings[b.id] = sheetClip(rng(`${seed}:wing:${b.id}`), { cut: 2.2, depth: 5, tornBottom: false });
  }
  const cards: Record<string, string> = {};
  for (const b of view.buckets) for (const g of b.games) cards[g.id] = sheetClip(rng(`${seed}:card:${g.id}`), { cut: 3, depth: 9, tornBottom: true });

  const month = view.day.month.toUpperCase();
  const day = String(view.day.dayOfMonth);

  return {
    strip,
    band,
    sheets,
    wings,
    cards,
    slips: {
      welcome: sheetClip(rng(`${seed}:slip:welcome`), { cut: 2, depth: 4, tornBottom: true }),
      upNext: sheetClip(rng(`${seed}:slip:up-next`), { cut: 2, depth: 4, tornBottom: true }),
      fin: polygon(cutRect(rng(`${seed}:fin-plate`), { j: 2.4, a: 0.9, n: [3, 2, 3, 2] })),
    },
    tabTear: tornTopClip(rng(`${seed}:tab-bar`), 9),
    words: cutWord("WORDS", `${seed}:words`, { rot: 3, dy: 3 }),
    wordsCard: cutWord("WORDS", `${seed}:words-card`, { rot: 4.5, dy: 5, gap: 9 }),
    fin: cutWord("FIN", `${seed}:fin`, { rot: 3, dy: 3, gap: 10 }),
    vanishX: 0.58 + r() * 0.08,
    dialSeed: `${seed}:dial`,
    type: {
      monthAdvance: MONTH_ADVANCE[month] ?? 2.5,
      dayInk: DAY_INK[day] ?? 0.65,
      dayLsb: DAY_LSB[day] ?? 0.03,
      dayRsb: DAY_RSB[day] ?? 0.03,
      cap: LG_CAP,
    },
  };
}
