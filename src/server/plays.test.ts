import { describe, expect, it, vi } from "vitest";
import type { FriendDetail } from "@/core/game";
import { fadeToColor, type State } from "@/games/fade-to-color/logic";
import type { Json } from "./database.types";
import { friendsResultsFrom, type FriendPlay } from "./plays";

const profile = (id: string, display_name: string) => ({ id, username: id, display_name });
const PROFILES = [profile("viewer", "Viewer"), profile("ana", "Ana"), profile("ben", "Ben"), profile("cy", "Cy"), profile("dee", "Dee")];

/** A play whose state carries a secret only the hook may pass on (`kept`) and one it must not (`typed`). */
const play = (user_id: string, status: FriendPlay["status"], score: number | null, kept: string): FriendPlay => ({
  user_id,
  status,
  score,
  result_label: score === null ? null : `${score}`,
  share_grid: score === null ? null : "🟩",
  state: { kept, typed: `${user_id}'s guesses` },
});

const PLAYS = [play("viewer", "won", 70, "v"), play("ana", "lost", 0, "a"), play("ben", "won", 90, "b"), play("cy", "in_progress", null, "c")];

/** A game that shares `kept` from each finished play's state. */
const sharing = () => ({ friendDetail: vi.fn((state: { kept: string }): FriendDetail => ({ kept: state.kept })) });

describe("friendsResultsFrom: the spoiler wall", () => {
  it("shows nothing until the viewer has started the puzzle, and reads no one's state", () => {
    const game = sharing();
    expect(friendsResultsFrom({ game, viewerId: "viewer", plays: PLAYS.slice(1), profiles: PROFILES })).toBeNull();
    expect(game.friendDetail).not.toHaveBeenCalled();
  });

  it("shows nothing while the viewer is still playing, and reads no one's state", () => {
    const game = sharing();
    const plays = [play("viewer", "in_progress", null, "v"), ...PLAYS.slice(1)];
    expect(friendsResultsFrom({ game, viewerId: "viewer", plays, profiles: PROFILES })).toBeNull();
    expect(game.friendDetail).not.toHaveBeenCalled();
  });

  it("once the viewer has finished, lists everyone: finished first, best score first", () => {
    const results = friendsResultsFrom({ game: {}, viewerId: "viewer", plays: PLAYS, profiles: PROFILES })!;
    expect(results.map((r) => [r.profile.id, r.status, r.score, r.label, r.shareGrid])).toEqual([
      ["ben", "won", 90, "90", "🟩"],
      ["viewer", "won", 70, "70", "🟩"],
      ["ana", "lost", 0, "0", "🟩"],
      ["cy", "in_progress", null, null, null],
      ["dee", "not_started", null, null, null],
    ]);
  });

  it("passes on each finished play's detail, and nothing else of its state", () => {
    const game = sharing();
    const results = friendsResultsFrom({ game, viewerId: "viewer", plays: PLAYS, profiles: PROFILES })!;
    expect(Object.fromEntries(results.map((r) => [r.profile.id, r.detail]))).toEqual({
      ben: { kept: "b" },
      viewer: { kept: "v" },
      ana: { kept: "a" },
      cy: undefined,
      dee: undefined,
    });
    expect(JSON.stringify(results)).not.toContain("guesses");
  });

  it("never reads the state of a play still in progress", () => {
    const game = sharing();
    friendsResultsFrom({ game, viewerId: "viewer", plays: PLAYS, profiles: PROFILES });
    expect(game.friendDetail.mock.calls.map(([state]) => state.kept).sort()).toEqual(["a", "b", "v"]);
  });

  it("adds no detail for a game without the hook (every other game)", () => {
    const results = friendsResultsFrom({ game: {}, viewerId: "viewer", plays: PLAYS, profiles: PROFILES })!;
    expect(results.every((r) => !("detail" in r))).toBe(true);
    expect(JSON.stringify(results)).not.toMatch(/guesses|kept/);
  });
});

describe("friendsResultsFrom: Fade to Color's picks", () => {
  const film = (id: number, title: string) => ({ id, title, year: 2000 });
  const four = [film(1, "One"), film(2, "Two"), film(3, "Three"), film(4, "Four")];
  const state = (over: Partial<State>): Json => ({ turns: [], unlocked: [], options: [], pick: null, ...over }) as unknown as Json;

  it("shows each finished player's pick and never their typed guesses", () => {
    const plays: FriendPlay[] = [
      { ...play("viewer", "won", 90, ""), state: state({ turns: [{ film: film(9, "Typed"), correct: true }] }) },
      { ...play("ana", "won", 45, ""), state: state({ turns: [{ film: film(3, "Three"), correct: false }], options: four, pick: { film: four[1]!, correct: true } }) },
      { ...play("ben", "lost", 0, ""), state: state({ options: four, pick: { film: four[3]!, correct: false } }) },
      { ...play("cy", "in_progress", null, ""), state: state({ turns: [{ film: film(1, "One"), correct: false }], options: four }) },
    ];
    const results = friendsResultsFrom({ game: fadeToColor, viewerId: "viewer", plays, profiles: PROFILES })!;
    expect(Object.fromEntries(results.map((r) => [r.profile.id, r.detail]))).toEqual({
      viewer: { pickId: null },
      ana: { pickId: 2 },
      ben: { pickId: 4 },
      cy: undefined,
      dee: undefined,
    });
    expect(JSON.stringify(results)).not.toMatch(/Typed|One|Three|turns|options/);
  });
});
