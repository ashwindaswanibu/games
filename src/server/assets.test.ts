import { describe, expect, it, vi } from "vitest";
import { parsePuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { PlayView } from "@/core/view";
import { canViewAsset, decodeBytea } from "./assets";

// Only identity and availability matter to the access rule.
vi.mock("@/games/registry", () => {
  const games = new Map(
    (["live", "testing"] as const).map((availability) => [`${availability}-frames`, { id: `${availability}-frames`, availability }]),
  );
  return {
    getGame: (id: string) => games.get(id),
    canPlay: (game: AnyGame, isAdmin: boolean) => game.availability === "live" || isAdmin,
  };
});

const SHOWN = "11111111-1111-4111-8111-111111111111";
const EARNED = "22222222-2222-4222-8222-222222222222";
const SECRET = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-10-06";

const view = (overrides: Partial<PlayView> = {}): PlayView => ({
  gameId: "live-frames",
  date: parsePuzzleDate(DATE),
  version: 1,
  status: "in_progress",
  puzzle: { first: { id: SHOWN, width: 4, height: 3 } },
  state: { unlocked: [{ id: EARNED, width: 4, height: 3 }] },
  result: null,
  reveal: null,
  ...overrides,
});

const player = { id: "player", is_admin: false };
const admin = { id: "admin", is_admin: true };
const at = (id: string, gameId = "live-frames") => ({ id, gameId, puzzleDate: DATE });

describe("canViewAsset", () => {
  it("serves assets that appear in the player's current view", async () => {
    const loadView = vi.fn(async () => view());
    expect(await canViewAsset({ viewer: player, asset: at(SHOWN), loadView })).toBe(true);
    expect(await canViewAsset({ viewer: player, asset: at(EARNED), loadView })).toBe(true);
    expect(loadView).toHaveBeenCalledWith(expect.objectContaining({ id: "live-frames" }), DATE);
  });

  it("withholds assets that are only in the solution", async () => {
    expect(await canViewAsset({ viewer: player, asset: at(SECRET), loadView: async () => view() })).toBe(false);
  });

  it("serves solution assets once the reveal includes them", async () => {
    const finished = view({ status: "lost", reveal: { answer: { id: SECRET, width: 4, height: 3 } } });
    expect(await canViewAsset({ viewer: player, asset: at(SECRET), loadView: async () => finished })).toBe(true);
  });

  it("serves nothing before the player has started", async () => {
    expect(await canViewAsset({ viewer: player, asset: at(SHOWN), loadView: async () => null })).toBe(false);
  });

  it("serves nothing for unknown games", async () => {
    const loadView = vi.fn(async () => view());
    expect(await canViewAsset({ viewer: admin, asset: at(SHOWN, "no-such-game"), loadView })).toBe(false);
    expect(loadView).not.toHaveBeenCalled();
  });

  it("serves testing games' assets to admins only", async () => {
    const loadView = async () => view({ gameId: "testing-frames" });
    expect(await canViewAsset({ viewer: player, asset: at(SHOWN, "testing-frames"), loadView })).toBe(false);
    expect(await canViewAsset({ viewer: admin, asset: at(SHOWN, "testing-frames"), loadView })).toBe(true);
  });
});

describe("decodeBytea", () => {
  it("decodes PostgREST hex output", () => {
    expect([...decodeBytea("\\x89504e47")]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(decodeBytea("\\x").length).toBe(0);
  });

  it("rejects anything else", () => {
    expect(() => decodeBytea("iVBORw0KGgo=")).toThrow();
    expect(() => decodeBytea("\\x123")).toThrow();
  });
});
