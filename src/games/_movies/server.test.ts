import { describe, expect, it } from "vitest";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { FILM_NOT_FOUND, PERSON_NOT_FOUND, resolveFilm, resolvePerson, toFilmDetails } from "./server";
import { filmDetailsSchema } from "./schemas";

const services = createFakeGameServices({
  films: [film({ id: 7, title: "Heat", year: 1995, genres: ["Crime"], directors: ["Michael Mann"], popularity: 80, tmdbId: 949 })],
  people: [{ id: 3, name: "Al Pacino", popularity: 90 }],
});

describe("resolveFilm", () => {
  it("returns a schema-valid snapshot without catalog-only fields", async () => {
    const result = await resolveFilm(services, 7);
    expect(result).toEqual({ ok: true, move: { id: 7, title: "Heat", year: 1995, genres: ["Crime"], directors: ["Michael Mann"] } });
    if (result.ok) expect(filmDetailsSchema.safeParse(result.move).success).toBe(true);
  });

  it("rejects ids that aren't in the catalog", async () => {
    expect(await resolveFilm(services, 8)).toEqual({ ok: false, error: FILM_NOT_FOUND });
  });
});

describe("toFilmDetails", () => {
  it("sanitizes a malformed catalog row into a schema-valid snapshot", () => {
    const details = toFilmDetails(
      film({
        id: 9,
        title: `  ${"Long ".repeat(70)}😀  `,
        year: 2001,
        genres: ["  Drama ", "", "   ", "x".repeat(61), ...Array.from({ length: 30 }, (_, i) => `Genre ${i}`)],
        directors: [" Jane Doe ", "y".repeat(201), ...Array.from({ length: 12 }, (_, i) => `Director ${i}`)],
      }),
    );
    expect(filmDetailsSchema.safeParse(details).success).toBe(true);
    expect(details.title.length).toBeLessThanOrEqual(300);
    expect(details.title.startsWith("Long Long")).toBe(true);
    expect(details.genres[0]).toBe("Drama");
    expect(details.genres).toHaveLength(20);
    expect(details.directors[0]).toBe("Jane Doe");
    expect(details.directors).toHaveLength(10);
  });

  it("never splits a character when it shortens a title", () => {
    const title = toFilmDetails(film({ id: 1, title: `${"a".repeat(299)}😀` })).title;
    expect(title).toBe("a".repeat(299));
  });
});

describe("resolvePerson", () => {
  it("returns the person's ref, or a rejection", async () => {
    expect(await resolvePerson(services, 3)).toEqual({ ok: true, move: { id: 3, name: "Al Pacino" } });
    expect(await resolvePerson(services, 4)).toEqual({ ok: false, error: PERSON_NOT_FOUND });
  });
});
