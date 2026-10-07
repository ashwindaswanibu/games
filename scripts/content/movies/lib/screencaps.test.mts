import { describe, expect, it } from "vitest";
import {
  checkGallerySize,
  GallerySizeError,
  matchGalleries,
  MIN_FILM_CAPS,
  canonicalGalleryUrl,
  capUrl,
  decodeEntities,
  findGallery,
  normalizeTitle,
  parseCaps,
  parseDirectory,
  parseLastPage,
  type DirectoryEntry,
} from "./screencaps.mjs";

const GALLERY = "https://movie-screencaps.com/dune-part-two-2024-4k/";

/** A gallery page as the site serves it: thumbnails from the CDN, wrapped in links to an image proxy. */
function galleryPage(numbers: number[], lastPage: number): string {
  const caps = numbers
    .map(
      (n) =>
        `<a href="https://i0.wp.com/imgs.screencaps.us/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-${n}.jpg?ssl=1" title="screencap ${n}">` +
        `<img src="https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-${n}.jpg?class=thumbnail" width="200" class="thumb" /></a>`,
    )
    .join("\n");
  const sidebar = `<img src="https://i0.wp.com/movie-screencaps.com/wp-content/uploads/2026/08/battleship-movie-screencaps.com-.jpg" />`;
  const pages = [2, 3, lastPage].map((p) => `<a class="page" title="Go to page ${p} of ${lastPage}" href="${GALLERY}page/${p}">${p}</a>`).join("");
  return `<html><body>${caps}${sidebar}<nav>${pages}<a href="https://movie-screencaps.com/other-film/page/999">x</a></nav></body></html>`;
}

describe("gallery pages", () => {
  it("reads the CDN pattern from the thumbnails, not the proxy links or the sidebar", () => {
    const { pattern, numbers } = parseCaps(galleryPage([1, 2, 3, 180], 131));
    expect(pattern).toEqual({ prefix: "https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-", suffix: ".jpg" });
    expect(numbers).toEqual([1, 2, 3, 180]);
  });

  it("finds the gallery's last page, ignoring other galleries' pagination", () => {
    expect(parseLastPage(galleryPage([1], 131), GALLERY)).toBe(131);
    expect(parseLastPage("<p>one page</p>", GALLERY)).toBe(1);
  });

  it("fails clearly on a page with no screencaps", () => {
    expect(() => parseCaps("<html><img src='/logo.png'></html>")).toThrow(/No screencaps/);
  });

  it("refuses a gallery that can't be a whole film: one page, or too few caps", () => {
    const url = "https://movie-screencaps.com/barbie-2023-4k/";
    expect(() => checkGallerySize(url, { lastPage: 73, frameCount: 13_052 })).not.toThrow();
    // Pagination markup changed: the last page isn't found, so only page 1's 180 caps are known.
    expect(() => checkGallerySize(url, { lastPage: 1, frameCount: 180 })).toThrow(/only one gallery page/);
    expect(() => checkGallerySize(url, { lastPage: 4, frameCount: MIN_FILM_CAPS - 1 })).toThrow(/fewer than 1000/);
    expect(() => checkGallerySize(url, { lastPage: 1, frameCount: 180 }, true)).not.toThrow();
    expect(() => checkGallerySize(url, { lastPage: 1, frameCount: 40 }, true)).toThrow(/too few/);
  });

  it("says what kind of too small a gallery is, so only real verdicts are recorded", () => {
    const url = "https://movie-screencaps.com/short-2020/";
    const kind = (info: { lastPage: number; frameCount: number }) => {
      try {
        checkGallerySize(url, info);
      } catch (error) {
        return error instanceof GallerySizeError ? error.kind : "other";
      }
      return null;
    };
    expect(kind({ lastPage: 1, frameCount: 60 })).toBe("tiny");
    expect(kind({ lastPage: 1, frameCount: 180 })).toBe("one-page");
    expect(kind({ lastPage: 4, frameCount: 640 })).toBe("few-caps");
    expect(kind({ lastPage: 60, frameCount: 10_000 })).toBeNull();
  });

  it("builds thumbnail and sized URLs for a cap", () => {
    const gallery = { url: GALLERY, pattern: parseCaps(galleryPage([1], 1)).pattern, frameCount: 23457 };
    expect(capUrl(gallery, 42, { thumbnail: true })).toBe("https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-42.jpg?class=thumbnail");
    expect(capUrl(gallery, 42, { width: 1920 })).toBe("https://caps2.b-cdn.net/202/4-dune-part-two-4k/full/dune-part-two-4k-movie-screencaps.com-42.jpg?width=1920");
  });

  it("accepts only movie-screencaps.com galleries, in canonical form", () => {
    expect(canonicalGalleryUrl("https://movie-screencaps.com/dune-part-two-2024-4k/page/7")).toBe(GALLERY);
    expect(canonicalGalleryUrl("https://movie-screencaps.com/dune-part-two-2024-4k")).toBe(GALLERY);
    expect(() => canonicalGalleryUrl("http://movie-screencaps.com/dune/")).toThrow();
    expect(() => canonicalGalleryUrl("https://evil.example/dune/")).toThrow();
  });
});

describe("the movie directory", () => {
  const item = (href: string, text: string) =>
    `<li\n\t\tclass="asc-index-item"\n\t\tdata-index-name="${text.toLowerCase()}"\n\t>\n\t\t<a href="${href}">\n\t\t\t${text}\t\t</a>\n\t</li>`;
  const html = [
    item("https://movie-screencaps.com/dune-1984/", "Dune (1984)"),
    item("https://movie-screencaps.com/dune-2021/", "Dune (2021) [4K]"),
    item("https://movie-screencaps.com/dune-part-two-2024-4k/", "Dune: Part Two (2024) [4K]"),
    item("https://movie-screencaps.com/barbie-2023/", "Barbie (2023)"),
    item("https://movie-screencaps.com/barbie-2023-4k/", "Barbie (2023) [4K]"),
    item("https://movie-screencaps.com/amelie-2001/", "Am&#233;lie (2001)"),
    item("https://movie-screencaps.com/angels-demons-2009/", "Angels &#038; Demons (2009)"),
    item("https://movie-screencaps.com/society-of-the-snow/", "Society of the Snow (La sociedad de la nieve) [4K]"),
    `<li class="other"><a href="https://movie-screencaps.com/contact/">Contact</a></li>`,
  ].join("\n");
  const entries: DirectoryEntry[] = parseDirectory(html);

  it("lists every film with its year, tags and canonical URL", () => {
    expect(entries).toHaveLength(8);
    expect(entries[2]).toEqual({ title: "Dune: Part Two", year: 2024, tags: ["4k"], url: "https://movie-screencaps.com/dune-part-two-2024-4k/" });
    expect(entries.find((e) => e.url.includes("angels"))!.title).toBe("Angels & Demons");
    expect(entries.find((e) => e.url.includes("snow"))).toMatchObject({ year: null, tags: ["4k"] });
  });

  it("matches a catalog film by normalised title and year", () => {
    expect(findGallery(entries, { title: "Dune: Part Two", year: 2024 }).url).toBe("https://movie-screencaps.com/dune-part-two-2024-4k/");
    expect(findGallery(entries, { title: "Dune", year: 1984 }).url).toBe("https://movie-screencaps.com/dune-1984/");
    expect(findGallery(entries, { title: "Dune", year: 2021 }).url).toBe("https://movie-screencaps.com/dune-2021/");
    expect(findGallery(entries, { title: "Amélie", year: 2001 }).url).toBe("https://movie-screencaps.com/amelie-2001/");
    expect(findGallery(entries, { title: "Angels and Demons", year: 2009 }).url).toBe("https://movie-screencaps.com/angels-demons-2009/");
  });

  it("prefers the 4K gallery when a film has two", () => {
    expect(findGallery(entries, { title: "Barbie", year: 2023 }).url).toBe("https://movie-screencaps.com/barbie-2023-4k/");
  });

  it("accepts a year one off (release years differ by country), but not more", () => {
    expect(findGallery(entries, { title: "Barbie", year: 2024 }).url).toBe("https://movie-screencaps.com/barbie-2023-4k/");
    expect(() => findGallery(entries, { title: "Dune", year: 2000 })).toThrow(/Near misses[\s\S]*dune-1984/);
  });

  it("explains how to proceed when the film isn't listed", () => {
    expect(() => findGallery(entries, { title: "Heat", year: 1995 })).toThrow(/--url/);
  });

  describe("matching a whole catalog at once", () => {
    const film = (id: number, title: string, year: number | null, popularity = 50) => ({ id, title, year, popularity });

    it("gives each film the gallery findGallery would", () => {
      const films = [film(1, "Dune: Part Two", 2024), film(2, "Dune", 1984), film(3, "Dune", 2021), film(4, "Barbie", 2023), film(5, "Amélie", 2001), film(6, "Heat", 1995)];
      const matched = matchGalleries(entries, films);
      expect([...matched.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
      for (const { film: f, gallery } of matched.values()) expect(gallery).toEqual(findGallery(entries, f));
    });

    it("gives a gallery two films claim to the exact year, then the better-known film", () => {
      const twoBarbies = matchGalleries(entries, [film(10, "Barbie", 2024, 99), film(11, "Barbie", 2023, 1)]);
      expect([...twoBarbies.keys()]).toEqual([11]);
      const sameYear = matchGalleries(entries, [film(12, "Barbie", 2022, 10), film(13, "Barbie", 2024, 80)]);
      expect([...sameYear.keys()]).toEqual([13]);
      const tie = matchGalleries(entries, [film(15, "Barbie", 2022, 10), film(14, "Barbie", 2024, 10)]);
      expect([...tie.keys()]).toEqual([14]);
    });

    it("leaves out films without a year (a title alone is too weak)", () => {
      expect(matchGalleries(entries, [film(20, "Barbie", null)]).size).toBe(0);
    });
  });
});

describe("text helpers", () => {
  it("decodes the entities the site uses", () => {
    expect(decodeEntities("Beethoven&#8217;s 2nd &amp; Batman &#038; Robin &#x41;")).toBe("Beethoven’s 2nd & Batman & Robin A");
  });

  it("normalises titles for matching", () => {
    expect(normalizeTitle("The Lord of the Rings: The Return of the King")).toBe("lord of the rings the return of the king");
    expect(normalizeTitle("Amélie")).toBe(normalizeTitle("Amelie"));
    expect(normalizeTitle("Beethoven’s 2nd")).toBe(normalizeTitle("Beethoven's 2nd"));
    expect(normalizeTitle("Angels & Demons")).toBe(normalizeTitle("Angels and Demons"));
  });
});
