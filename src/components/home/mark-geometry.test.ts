import { describe, expect, it } from "vitest";
import type { MarkForm, ShareMarkKind } from "@/core/home-view";
import { buildMark, placedPieces } from "./mark-geometry";

const NH: MarkForm = { kind: "slots", count: 7 };
const FTC: MarkForm = { kind: "frames", count: 10, aspect: "3:2", finalPick: true };
const FBF: MarkForm = { kind: "frames", count: 6, aspect: "4:3", finalPick: false };
const DEGREES: MarkForm = { kind: "chain", par: 2 };

const kinds = (form: MarkForm, marks: ShareMarkKind[]) =>
  buildMark(form, "finished", marks, "t").slots.map((s) => s.piece?.kind ?? (s.unused ? (s.unused.dot ? "dot" : "hair") : "none"));

describe("mark forms (spec §6.2)", () => {
  it("are as wide as the spec draws them", () => {
    expect(buildMark(NH, "not_started", null, "t").w).toBeCloseTo(8.8);
    expect(buildMark(FTC, "not_started", null, "t").w).toBeCloseTo(13.64);
    expect(buildMark(FBF, "not_started", null, "t").w).toBeCloseTo(7.42);
  });

  it("draw the empty form as keylines, one per slot, before a finish", () => {
    for (const state of ["not_started", "in_progress", "unavailable"] as const) {
      const m = buildMark(FTC, state, null, "t");
      expect(m.finished).toBe(false);
      expect(m.slots).toHaveLength(11);
      expect(placedPieces(m)).toHaveLength(0);
    }
    // Degrees before a finish: start node, par films, the star.
    expect(buildMark(DEGREES, "not_started", null, "t").slots).toHaveLength(4);
  });

  it("Number Hunt 4/7: arrows printed, the find cut, the rest not needed", () => {
    expect(kinds(NH, ["up", "down", "up", "hit"])).toEqual(["spent", "spent", "spent", "earned", "dot", "dot", "dot"]);
  });

  it("Fade to Color 3/10: spent, spent, earned, then hairlines; the pick never reached is left out", () => {
    expect(kinds(FTC, ["miss", "miss", "hit"])).toEqual(["spent", "spent", "earned", "hair", "hair", "hair", "hair", "hair", "hair", "hair", "none"]);
  });

  it("Fade to Color on the final pick: eleven marks, the pick a cut disc", () => {
    const marks: ShareMarkKind[] = [...Array<ShareMarkKind>(10).fill("miss"), "near"];
    expect(kinds(FTC, marks).at(-1)).toBe("earned");
  });

  it("Frame by Frame X/6: printed and skipped frames", () => {
    expect(kinds(FBF, ["miss", "miss", "skip", "miss", "miss", "miss"])).toEqual(["spent", "spent", "skip", "spent", "spent", "spent"]);
  });

  it("Degrees: links printed, the star earned; giving up ends on a pennant", () => {
    expect(kinds(DEGREES, ["link", "link", "link", "win"])).toEqual(["spent", "spent", "spent", "spent", "earned"]);
    expect(kinds(DEGREES, ["link", "flag"])).toEqual(["spent", "spent", "spent"]);
  });

  it("a future game falls back to a row of its own marks", () => {
    const m = buildMark({ kind: "row", count: null }, "finished", ["miss", "near", "hit", "other"], "t");
    expect(m.slots).toHaveLength(5);
    expect(m.slots.map((s) => s.piece?.kind ?? null)).toEqual(["spent", "earned", "earned", "skip", null]);
  });

  it("is deterministic for a seed", () => {
    expect(buildMark(FTC, "finished", ["miss", "hit"], "2026-10-07:x")).toEqual(buildMark(FTC, "finished", ["miss", "hit"], "2026-10-07:x"));
  });
});
