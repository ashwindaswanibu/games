"use client";

import { useEffect, useSyncExternalStore } from "react";
import { portraitsResponseSchema, viewPortraitsSchema, type Portrait } from "@/games/_movies/schemas";

/*
 * People's faces for the thread (see `src/server/portraits.ts`): which people have one, where it
 * loads from and its photo's credit. The board's own people come with the view (`PlayView.extras`,
 * from the page and each move), so they're drawn with it, even in the page's HTML; anyone else
 * (the cast search's faces, for their credits) is asked for once per person per visit and shared
 * by every part of the screen. A person without a face (or whose lookup failed) keeps a plain knot.
 */

const known = new Map<number, Portrait | null>();
const asking = new Set<number>();
const listeners = new Set<() => void>();
let version = 0;
/** As in `MAX_PORTRAIT_IDS` on the server. */
const BATCH = 40;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function ask(ids: number[]) {
  for (const id of ids) asking.add(id);
  try {
    const response = await fetch(`/api/catalog/portraits?ids=${ids.join(",")}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { portraits } = portraitsResponseSchema.parse(await response.json());
    const found = new Map(portraits.map((p) => [p.id, p]));
    for (const id of ids) known.set(id, found.get(id) ?? null);
  } catch {
    // A face is decoration: without one the knot stays plain. Asked again next visit.
    for (const id of ids) known.set(id, null);
  } finally {
    for (const id of ids) asking.delete(id);
    changed();
  }
}

/** The faces a view brought (`extras`), by person: null for someone looked up without one. */
function sentWith(extras: unknown): ReadonlyMap<number, Portrait | null> {
  const parsed = viewPortraitsSchema.safeParse(extras);
  if (!parsed.success) return new Map();
  return new Map<number, Portrait | null>([...parsed.data.without.map((id) => [id, null] as const), ...parsed.data.portraits.map((p) => [p.id, p] as const)]);
}

/**
 * The faces of `ids`: those the view brought (`extras`), else known so far (each looked up once);
 * call `portraitOf(id)` while rendering.
 */
export function usePortraits(ids: readonly number[], extras?: unknown): (id: number) => Portrait | null {
  const seen = useSyncExternalStore(subscribe, () => version, () => 0);
  const sent = sentWith(extras);
  const key = [...new Set(ids)]
    .filter((id) => !sent.has(id))
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    const missing = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !known.has(id) && !asking.has(id));
    for (let i = 0; i < missing.length; i += BATCH) void ask(missing.slice(i, i + BATCH));
  }, [key]);
  // A new function whenever a lookup lands, so whatever was drawn from the old one is redrawn.
  return lookupAt(seen, sent);
}

function lookupAt(seen: number, sent: ReadonlyMap<number, Portrait | null>): (id: number) => Portrait | null {
  return (id) => (sent.has(id) ? sent.get(id)! : seen >= 0 ? (known.get(id) ?? null) : null);
}
