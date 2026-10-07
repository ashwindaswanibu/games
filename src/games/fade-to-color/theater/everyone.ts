import type { FriendResult } from "@/core/view";
import type { FilmRef } from "@/games/_movies/schemas";
import { parseGrid } from "./grid";

/** How everyone's finished plays went: named by typing, picked from the four, or got away. */
export interface Tally {
  named: number;
  picked: number;
  missed: number;
}

export function tallyOf(results: readonly FriendResult[]): Tally {
  const tally: Tally = { named: 0, picked: 0, missed: 0 };
  for (const r of results) {
    if (r.status === "lost") tally.missed++;
    else if (r.status === "won") {
      if (r.shareGrid !== null && parseGrid(r.shareGrid).pick === "right") tally.picked++;
      else tally.named++;
    }
  }
  return tally;
}

/** "4 named it · 2 picked it · 1 didn't", leaving out what nobody did. */
export function tallyLine({ named, picked, missed }: Tally): string {
  return [named && `${named} named it`, picked && `${picked} picked it`, missed && `${missed} didn't`].filter(Boolean).join(" · ");
}

/** Someone who picked a film from the four. */
export interface Picker {
  id: string;
  name: string;
  initials: string;
  you: boolean;
}

/** One of the four as everyone saw it: whether it was the film, and who picked it. */
export interface FourCard {
  film: FilmRef;
  answer: boolean;
  pickers: Picker[];
}

/** The film a finished play picked from the four (its `friendDetail`), if any. */
export function pickIdOf(result: FriendResult): number | null {
  const id = result.detail?.pickId;
  return typeof id === "number" ? id : null;
}

/**
 * The four in their shared order, each with the players who picked it (in the results' order);
 * null when nobody picked. Only picks are shown: never the films anyone typed.
 */
export function everyonesPicks(options: readonly FilmRef[], answerId: number, results: readonly FriendResult[], viewerId: string): FourCard[] | null {
  const picks = results.flatMap((r) => {
    const pickId = pickIdOf(r);
    return pickId !== null && options.some((f) => f.id === pickId) ? [{ result: r, pickId }] : [];
  });
  if (picks.length === 0) return null;
  const initials = initialsOf(picks.map((p) => p.result.profile.display_name));
  return options.map((film) => ({
    film,
    answer: film.id === answerId,
    pickers: picks.flatMap((p, i) =>
      p.pickId === film.id ? [{ id: p.result.profile.id, name: p.result.profile.display_name, initials: initials[i]!, you: p.result.profile.id === viewerId }] : [],
    ),
  }));
}

/**
 * Initials for a row of names: the first letter of the first and last words ("Priya Shah" → "PS",
 * "Dev" → "D"). Where two would read the same, more of the first word, until they don't or it runs
 * out ("Sam" and "Sara" → "SAM" and "SAR").
 */
export function initialsOf(names: readonly string[]): string[] {
  const parts = names.map((name) => {
    const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const first = [...(words[0] ?? "?")];
    const last = words.length > 1 ? ([...words.at(-1)!][0] ?? "") : "";
    return { first, last };
  });
  const take = names.map(() => 1);
  const label = (i: number) => parts[i]!.first.slice(0, take[i]).join("") + parts[i]!.last;
  for (let grew = true; grew; ) {
    grew = false;
    const groups = new Map<string, number[]>();
    names.forEach((_, i) => groups.set(label(i), [...(groups.get(label(i)) ?? []), i]));
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const i of group) {
        if (take[i]! < parts[i]!.first.length) {
          take[i] = take[i]! + 1;
          grew = true;
        }
      }
    }
  }
  return names.map((_, i) => label(i));
}
