"use client";

import { useEffect, useSyncExternalStore } from "react";
import { portraitsResponseSchema, type Portrait } from "@/games/_movies/schemas";

/*
 * People's faces for the thread (see `src/server/portraits.ts`): which people have one, where it
 * loads from and its photo's credit, asked for once per person per visit and shared by every part
 * of the screen. A person without a face (or whose lookup failed) keeps a plain knot.
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

/** The faces of `ids` known so far (each looked up once); call `portraitOf(id)` while rendering. */
export function usePortraits(ids: readonly number[]): (id: number) => Portrait | null {
  const seen = useSyncExternalStore(subscribe, () => version, () => 0);
  const key = [...new Set(ids)].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const missing = key
      .split(",")
      .filter(Boolean)
      .map(Number)
      .filter((id) => !known.has(id) && !asking.has(id));
    for (let i = 0; i < missing.length; i += BATCH) void ask(missing.slice(i, i + BATCH));
  }, [key]);
  // A new function whenever a lookup lands, so whatever was drawn from the old one is redrawn.
  return lookupAt(seen);
}

function lookupAt(seen: number): (id: number) => Portrait | null {
  return (id) => (seen >= 0 ? (known.get(id) ?? null) : null);
}
