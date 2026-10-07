import { describe, expect, it } from "vitest";
import { createRng } from "@/core/random";
import { planCatalogWrites, planCredits, planTitles, type IdPlan, type IncomingIds, type StoredIds } from "./catalog-plan.mjs";

const stored = (id: number, wikidataId: string | null, imdbId: string | null, tmdbId: number | null = null): StoredIds => ({ id, wikidataId, imdbId, tmdbId });
const incoming = (key: string, wikidataId: string | null, imdbId: string | null, tmdbId: number | null = null): IncomingIds => ({ key, wikidataId, imdbId, tmdbId });

describe("planCatalogWrites", () => {
  it("updates matched rows under their own id and inserts the rest without one", () => {
    const plan = planCatalogWrites(
      [stored(30, "Q44578", "tt0120338", 597), stored(31, "Q47703", "tt0068646", 238)],
      [incoming("tt0068646", "Q47703", "tt0068646", 238), incoming("tt0248126", "Q466443", "tt0248126", 10757), incoming("tt0120338", "Q44578", "tt0120338", 597)],
    );
    expect(plan.updates).toEqual([
      { id: 31, key: "tt0068646", wikidataId: "Q47703", imdbId: "tt0068646", tmdbId: 238 },
      { id: 30, key: "tt0120338", wikidataId: "Q44578", imdbId: "tt0120338", tmdbId: 597 },
    ]);
    expect(plan.inserts).toEqual([{ key: "tt0248126", wikidataId: "Q466443", imdbId: "tt0248126", tmdbId: 10757 }]);
    expect(plan.inserts.every((row) => !("id" in row))).toBe(true);
    expect(plan.conflicts).toEqual([]);
  });

  it("matches by IMDb id when the Wikidata id doesn't match, and fills in missing ids", () => {
    // A person stored from Wikidata gains their IMDb id; an IMDb-only person gains a Wikidata item.
    const plan = planCatalogWrites(
      [stored(1, "Q1", null), stored(2, null, "nm0000002")],
      [incoming("Q1", "Q1", "nm0000001"), incoming("Q2", "Q2", "nm0000002")],
    );
    expect(plan.updates).toEqual([
      { id: 1, key: "Q1", wikidataId: "Q1", imdbId: "nm0000001", tmdbId: null },
      { id: 2, key: "Q2", wikidataId: "Q2", imdbId: "nm0000002", tmdbId: null },
    ]);
    expect(plan.inserts).toEqual([]);
  });

  it("never changes a stored external id", () => {
    // Q7 was merged into Q8 on Wikidata: the row is still the same film by IMDb id and keeps Q7.
    const plan = planCatalogWrites([stored(5, "Q7", "tt0000007", 70)], [incoming("tt0000007", "Q8", "tt0000007", 71)]);
    expect(plan.updates).toEqual([{ id: 5, key: "tt0000007", wikidataId: "Q7", imdbId: "tt0000007", tmdbId: 70 }]);
    expect(plan.conflicts).toHaveLength(1);
  });

  it("lets the Wikidata match win when the two ids point at two different rows", () => {
    const plan = planCatalogWrites(
      [stored(1, "Q1", null), stored(2, null, "tt0000001")],
      [incoming("tt0000001", "Q1", "tt0000001")],
    );
    // Row 1 is the film; row 2 keeps its IMDb id and is left alone. Nothing is merged or moved.
    expect(plan.updates).toEqual([{ id: 1, key: "tt0000001", wikidataId: "Q1", imdbId: null, tmdbId: null }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.conflicts.join()).toMatch(/tt0000001/);
  });

  it("inserts without an IMDb id a stored row holds for another match", () => {
    const plan = planCatalogWrites(
      [stored(1, "Q1", "tt0000001")],
      [incoming("a", "Q1", "tt0000002"), incoming("b", "Q2", "tt0000001")],
    );
    expect(plan.updates).toEqual([{ id: 1, key: "a", wikidataId: "Q1", imdbId: "tt0000001", tmdbId: null }]);
    expect(plan.inserts).toEqual([{ key: "b", wikidataId: "Q2", imdbId: null, tmdbId: null }]);
  });

  it("gives a contested TMDB id to the row that holds it, else to the first incoming row", () => {
    const plan = planCatalogWrites(
      [stored(1, "Q1", "tt0000001", 9), stored(2, "Q2", "tt0000002")],
      [incoming("tt0000002", "Q2", "tt0000002", 9), incoming("tt0000003", "Q3", "tt0000003", 10), incoming("tt0000004", "Q4", "tt0000004", 10)],
    );
    expect(plan.updates).toEqual([{ id: 2, key: "tt0000002", wikidataId: "Q2", imdbId: "tt0000002", tmdbId: null }]);
    expect(plan.inserts.map((i) => i.tmdbId)).toEqual([10, null]);
  });

  it("holds the id contract on random catalogs", () => {
    const rng = createRng([7, 11, 13, 17]);
    const int = (n: number) => Math.floor(rng.next() * n);
    const maybe = <T,>(value: T, p = 0.7): T | null => (rng.next() < p ? value : null);
    for (let round = 0; round < 300; round++) {
      const pool = 12;
      const storedRows: StoredIds[] = [];
      const used = { w: new Set<string>(), i: new Set<string>(), t: new Set<number>() };
      const unique = <T,>(set: Set<T>, value: T | null) => (value === null || set.has(value) ? null : (set.add(value), value));
      for (let id = 1; id <= int(10); id++) {
        storedRows.push(
          stored(
            id * 7,
            unique(used.w, maybe(`Q${int(pool) + 1}`)),
            unique(used.i, maybe(`tt${String(int(pool) + 1).padStart(7, "0")}`)),
            unique(used.t, maybe(int(pool) + 1, 0.5)),
          ),
        );
      }
      const seen = { w: new Set<string>(), i: new Set<string>() };
      const incomingRows: IncomingIds[] = [];
      for (let k = 0; k < int(12); k++) {
        // Snapshot rows have unique Wikidata and IMDb ids among themselves; TMDB ids may repeat.
        const wikidataId = unique(seen.w, maybe(`Q${int(pool) + 1}`));
        const imdbId = unique(seen.i, maybe(`tt${String(int(pool) + 1).padStart(7, "0")}`, 0.9));
        if (!wikidataId && !imdbId) continue;
        incomingRows.push(incoming(`k${k}`, wikidataId, imdbId, maybe(int(pool) + 1, 0.5)));
      }
      assertContract(storedRows, incomingRows, planCatalogWrites(storedRows, incomingRows));
    }
  });
});

/** The invariants the apply step relies on. */
function assertContract(storedRows: readonly StoredIds[], incomingRows: readonly IncomingIds[], plan: IdPlan) {
  const storedById = new Map(storedRows.map((row) => [row.id, row]));
  // Stored ids appear only as updates, each at most once; inserts never carry one.
  const updatedIds = plan.updates.map((u) => u.id);
  expect(new Set(updatedIds).size).toBe(updatedIds.length);
  for (const id of updatedIds) expect(storedById.has(id)).toBe(true);
  for (const insert of plan.inserts) expect(insert).not.toHaveProperty("id");
  // Every incoming row is planned exactly once.
  expect([...plan.updates, ...plan.inserts].map((r) => r.key).sort()).toEqual(incomingRows.map((r) => r.key).sort());
  // A stored row's non-empty external ids never change.
  for (const update of plan.updates) {
    const before = storedById.get(update.id)!;
    if (before.wikidataId) expect(update.wikidataId).toBe(before.wikidataId);
    if (before.imdbId) expect(update.imdbId).toBe(before.imdbId);
    if (before.tmdbId != null) expect(update.tmdbId).toBe(before.tmdbId);
  }
  // Afterwards every external id is still unique across the whole table.
  const after = new Map<number | string, StoredIds | (typeof plan.inserts)[number]>(storedRows.map((row) => [row.id, row]));
  for (const update of plan.updates) after.set(update.id, update);
  plan.inserts.forEach((insert, i) => after.set(`new${i}`, insert));
  for (const field of ["wikidataId", "imdbId", "tmdbId"] as const) {
    const values = [...after.values()].map((row) => row[field]).filter((v) => v !== null && v !== undefined);
    expect(new Set(values).size).toBe(values.length);
  }
  // A matched row is the same item: it shares the Wikidata id, or else the IMDb id.
  for (const update of plan.updates) {
    const row = incomingRows.find((r) => r.key === update.key)!;
    const before = storedById.get(update.id)!;
    expect((row.wikidataId !== null && row.wikidataId === before.wikidataId) || (row.imdbId !== null && row.imdbId === before.imdbId)).toBe(true);
  }
}

describe("planTitles", () => {
  it("adds new names and removes original/alias names no source lists, comparing by search key", () => {
    const plan = planTitles(
      [
        { title: "Kabhi Khushi Kabhie Gham", kind: "display" },
        { title: "Sometimes Happiness Sometimes Sadness...", kind: "former" },
        { title: "Amélie", kind: "alias" },
        { title: "Old alias", kind: "alias" },
        { title: "K3G", kind: "alias" },
      ],
      [
        { title: "Amelie", kind: "alias" },
        { title: "k3g", kind: "alias" },
        { title: "Kabhi Khushi Kabhie Gham...", kind: "original" },
        { title: "Happiness and Tears", kind: "alias" },
      ],
    );
    expect(plan.remove).toEqual(["Old alias"]);
    expect(plan.add).toEqual([{ title: "Happiness and Tears", kind: "alias" }]);
  });
});

describe("planCredits", () => {
  it("writes only what changed and never removes a protected credit", () => {
    const plan = planCredits({
      imdb: [3],
      wikidata: [1, 2, 3],
      stored: new Map([
        [1, 0],
        [2, 1],
        [3, 2],
        [8, 3],
        [9, 4],
      ]),
      protectedPeople: new Set([9]),
      popularity: () => 0,
    });
    expect(plan.upsert).toEqual([
      { personId: 3, billing: 0 },
      { personId: 1, billing: 1 },
      { personId: 2, billing: 2 },
    ]);
    expect(plan.remove).toEqual([8]);
  });

  it("is a no-op on its own output", () => {
    const stored = new Map<number, number | null>([
      [3, 0],
      [1, 1],
      [2, 2],
      [7, null],
    ]);
    expect(planCredits({ imdb: [3], wikidata: [1, 2, 3, 7], stored, protectedPeople: new Set(), popularity: () => 0 })).toEqual({ upsert: [], remove: [] });
  });
});
