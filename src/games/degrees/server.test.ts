import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND, PERSON_NOT_FOUND } from "@/games/_movies/server";
import { advancePlay } from "@/server/move-pipeline";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { degrees, type DegreesPuzzle, type DegreesSolution, type DegreesState } from "./logic";
import { degreesServer } from "./server";

const puzzle: DegreesPuzzle = { start: { id: 1, name: "Al Pacino" }, end: { id: 4, name: "Anthony Hopkins" }, par: 3 };
const solution: DegreesSolution = {
  path: [
    { film: { id: 10, title: "Heat", year: 1995 }, person: { id: 2, name: "Robert De Niro" } },
    { film: { id: 11, title: "Taxi Driver", year: 1976 }, person: { id: 3, name: "Jodie Foster" } },
    { film: { id: 12, title: "The Silence of the Lambs", year: 1991 }, person: { id: 4, name: "Anthony Hopkins" } },
  ],
};

function services() {
  return createFakeGameServices({
    films: [
      film({ id: 10, title: "Heat", year: 1995, popularity: 60 }),
      film({ id: 11, title: "Taxi Driver", year: 1976, popularity: 79 }),
      film({ id: 12, title: "The Silence of the Lambs", year: 1991, popularity: 102 }),
    ],
    people: [
      { id: 1, name: "Al Pacino" },
      { id: 2, name: "Robert De Niro" },
      { id: 3, name: "Jodie Foster" },
      { id: 4, name: "Anthony Hopkins" },
    ],
    credits: [
      { filmId: 10, personId: 1, billing: 1 },
      { filmId: 10, personId: 2, billing: 0 },
      { filmId: 11, personId: 2, billing: 0 },
      { filmId: 11, personId: 3, billing: 1 },
      { filmId: 12, personId: 3, billing: 0 },
      { filmId: 12, personId: 4, billing: 1 },
    ],
  });
}

const start: DegreesState = { links: [], gaveUp: false };
const resolve = (move: Parameters<typeof degreesServer.resolveMove>[0]["move"], state: DegreesState = start, fake = services()) =>
  degreesServer.resolveMove({ move, puzzle, solution, state }, fake);

describe("degreesServer.resolveMove", () => {
  it("is registered for the degrees game", () => {
    expect(degreesServer.gameId).toBe(degrees.id);
  });

  it("resolves a link whose actor and co-star are both in the film", async () => {
    const fake = services();
    const result = await resolve({ type: "link", filmId: 10, personId: 2 }, start, fake);
    expect(result).toEqual({
      ok: true,
      move: { type: "link", fromPersonId: 1, film: { id: 10, title: "Heat", year: 1995 }, person: { id: 2, name: "Robert De Niro" } },
    });
    if (result.ok) expect(degrees.resolvedMoveSchema!.safeParse(result.move).success).toBe(true);
    expect(fake.calls).toContain("credits.together(1,10)");
    expect(fake.calls).toContain("credits.together(2,10)");
  });

  it("checks credits from the current actor, the chain's last co-star", async () => {
    const state: DegreesState = { gaveUp: false, links: [solution.path[0]!] };
    const fake = services();
    const result = await resolve({ type: "link", filmId: 11, personId: 3 }, state, fake);
    expect(result).toMatchObject({ ok: true, move: { fromPersonId: 2, person: { id: 3, name: "Jodie Foster" } } });
    expect(fake.calls).toContain("credits.together(2,11)");
  });

  it("refuses a film the current actor isn't in", async () => {
    expect(await resolve({ type: "link", filmId: 11, personId: 3 })).toEqual({ ok: false, error: "Al Pacino isn't in the cast of Taxi Driver." });
  });

  it("refuses a co-star who isn't in the film", async () => {
    expect(await resolve({ type: "link", filmId: 10, personId: 3 })).toEqual({ ok: false, error: "Jodie Foster isn't in the cast of Heat." });
  });

  it("refuses linking the current actor to themselves without any lookups", async () => {
    const fake = services();
    expect(await resolve({ type: "link", filmId: 10, personId: 1 }, start, fake)).toEqual({
      ok: false,
      error: "Pick one of Al Pacino's co-stars, not Al Pacino again.",
    });
    expect(fake.calls).toEqual([]);
  });

  it("refuses unknown films and people", async () => {
    expect(await resolve({ type: "link", filmId: 99, personId: 2 })).toEqual({ ok: false, error: FILM_NOT_FOUND });
    expect(await resolve({ type: "link", filmId: 10, personId: 99 })).toEqual({ ok: false, error: PERSON_NOT_FOUND });
  });

  it("refuses an adult film like an unknown one: search hides it and par never uses it", async () => {
    const fake = createFakeGameServices({
      films: [film({ id: 10, title: "Heat", year: 1995, isAdult: true })],
      people: [
        { id: 1, name: "Al Pacino" },
        { id: 2, name: "Robert De Niro" },
      ],
      credits: [
        { filmId: 10, personId: 1, billing: 1 },
        { filmId: 10, personId: 2, billing: 0 },
      ],
    });
    expect(await resolve({ type: "link", filmId: 10, personId: 2 }, start, fake)).toEqual({ ok: false, error: FILM_NOT_FOUND });
  });

  it("passes undo and give-up through untouched", async () => {
    const fake = services();
    expect(await resolve({ type: "undo" }, start, fake)).toEqual({ ok: true, move: { type: "undo" } });
    expect(await resolve({ type: "give-up" }, start, fake)).toEqual({ ok: true, move: { type: "give-up" } });
    expect(fake.calls).toEqual([]);
  });
});

describe("degrees through the move pipeline", () => {
  const advance = (state: DegreesState, move: unknown) =>
    advancePlay({ game: degrees, server: degreesServer, services: services(), puzzle, solution, state, move, elapsedMs: 0 });

  it("plays a par chain to a win", async () => {
    let state: unknown = start;
    const moves = [
      { type: "link", filmId: 10, personId: 2 },
      { type: "link", filmId: 11, personId: 3 },
      { type: "link", filmId: 12, personId: 4 },
    ];
    let last;
    for (const move of moves) {
      last = await advance(state as DegreesState, move);
      if (!last.ok) throw new Error(last.error);
      state = last.state;
    }
    expect(last).toMatchObject({ ok: true, outcome: "won", result: { score: 100, label: "3 links · par 3", shareGrid: "🎞🎞🎞⭐" } });
  });

  it("surfaces resolver rejections without changing the state", async () => {
    expect(await advance(start, { type: "link", filmId: 12, personId: 4 })).toEqual({
      ok: false,
      error: "Al Pacino isn't in the cast of The Silence of the Lambs.",
    });
  });
});
