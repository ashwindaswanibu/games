import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GalleryVerdicts, loadDirectory } from "./screencaps-cache.mjs";

const item = (slug: string, text: string) => `<li class="asc-index-item"><a href="https://movie-screencaps.com/${slug}/">${text}</a></li>`;
const DIRECTORY = [item("dune-1984", "Dune (1984)"), item("barbie-2023-4k", "Barbie (2023) [4K]")].join("\n");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "screencaps-cache-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the directory copy", () => {
  it("fetches once, then reuses the copy while it is fresh", async () => {
    let requests = 0;
    const fetchHtml = async () => {
      requests++;
      return DIRECTORY;
    };
    const first = await loadDirectory({ cacheDir: dir, fetchHtml });
    expect(first.fromCache).toBe(false);
    expect(first.entries.map((e) => e.title)).toEqual(["Dune", "Barbie"]);
    const second = await loadDirectory({ cacheDir: dir, fetchHtml });
    expect(second.fromCache).toBe(true);
    expect(second.entries).toEqual(first.entries);
    expect(requests).toBe(1);
  });

  it("fetches again when the copy is older than the limit, or when asked to", async () => {
    let requests = 0;
    const fetchHtml = async () => {
      requests++;
      return DIRECTORY;
    };
    await loadDirectory({ cacheDir: dir, fetchHtml });
    const file = path.join(dir, "screencaps-directory.html");
    const old = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(file, old, old);
    expect((await loadDirectory({ cacheDir: dir, fetchHtml })).fromCache).toBe(false);
    expect((await loadDirectory({ cacheDir: dir, fetchHtml, refresh: true })).fromCache).toBe(false);
    expect(requests).toBe(3);
  });

  it("refuses to cache a page that lists no films", async () => {
    await expect(loadDirectory({ cacheDir: dir, fetchHtml: async () => "<html>maintenance</html>" })).rejects.toThrow(/lists no films/);
    expect(() => readFileSync(path.join(dir, "screencaps-directory.html"))).toThrow();
  });
});

describe("gallery verdicts", () => {
  const URL = "https://movie-screencaps.com/night-of-the-living-dead-1968/";

  it("start empty, and keep what is recorded across runs", () => {
    const verdicts = new GalleryVerdicts(dir);
    expect(verdicts.size).toBe(0);
    verdicts.set(URL, { verdict: "black-and-white", detail: "0.4% of its pixels carry colour", film: { title: "Night of the Living Dead", year: 1968 } }, new Date("2026-10-07T00:00:00Z"));
    const reread = new GalleryVerdicts(dir);
    expect(reread.get(URL)).toEqual({
      verdict: "black-and-white",
      detail: "0.4% of its pixels carry colour",
      film: { title: "Night of the Living Dead", year: 1968 },
      checkedAt: "2026-10-07T00:00:00.000Z",
    });
    expect(reread.get("https://movie-screencaps.com/other/")).toBeUndefined();
  });

  it("refuse a file that isn't theirs rather than overwrite it", () => {
    writeFileSync(path.join(dir, "screencaps-verdicts.json"), JSON.stringify({ [URL]: { verdict: "grey" } }));
    expect(() => new GalleryVerdicts(dir)).toThrow(/isn't a verdicts file/);
    writeFileSync(path.join(dir, "screencaps-verdicts.json"), "{ not json");
    expect(() => new GalleryVerdicts(dir)).toThrow(/Couldn't read/);
  });
});
