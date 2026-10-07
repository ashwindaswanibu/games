import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { fetchDirectoryHtml, parseDirectory, type DirectoryEntry } from "./screencaps.mjs";

/**
 * What the Fade to Color pipeline keeps on disk about movie-screencaps.com between runs, in a
 * git-ignored folder (`content/movies/cache/` by default, `--cache-dir` to move it):
 *
 * - `screencaps-directory.html`: the site's directory page. Fetching it is one request; the copy is
 *   reused for `DIRECTORY_MAX_AGE_HOURS` (or until `--refresh-directory`), so planning many days,
 *   or planning and then rendering, asks the site once.
 * - `screencaps-verdicts.json`: what rendering found out about a gallery that its directory entry
 *   can't tell: that the film is black and white (refused on its thumbnails), in colour, or that the
 *   gallery is too short to be a whole film. The picker leaves out black-and-white films and short
 *   galleries, so a deterministic pick doesn't choose (and download) the same refused film again.
 *   Keyed by gallery URL, which doesn't depend on which database's catalog ids are in use.
 */

export const DEFAULT_CACHE_DIR = fileURLToPath(new URL("../../../../content/movies/cache/", import.meta.url));
export const DIRECTORY_MAX_AGE_HOURS = 24;
const DIRECTORY_FILE = "screencaps-directory.html";
const VERDICTS_FILE = "screencaps-verdicts.json";

/** Writes via a temp file and a rename, so an interrupted run never leaves half a file. */
function writeAtomically(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, contents);
  renameSync(temp, file);
}

export interface CachedDirectory {
  entries: DirectoryEntry[];
  /** When the page was fetched. */
  fetchedAt: Date;
  fromCache: boolean;
}

/**
 * The directory's entries, from the cached copy if it is younger than `maxAgeHours`, else fetched
 * (one request) and cached. A fetched page that lists no films is refused rather than cached: the
 * site's markup has probably changed, and an empty pool must never look like a real one.
 */
export async function loadDirectory({
  cacheDir = DEFAULT_CACHE_DIR,
  maxAgeHours = DIRECTORY_MAX_AGE_HOURS,
  refresh = false,
  now = new Date(),
  fetchHtml = fetchDirectoryHtml,
}: { cacheDir?: string; maxAgeHours?: number; refresh?: boolean; now?: Date; fetchHtml?: () => Promise<string> } = {}): Promise<CachedDirectory> {
  const file = path.join(cacheDir, DIRECTORY_FILE);
  if (!refresh) {
    const cached = (() => {
      try {
        return { html: readFileSync(file, "utf8"), modified: statSync(file).mtime };
      } catch {
        return null;
      }
    })();
    if (cached && now.getTime() - cached.modified.getTime() < maxAgeHours * 3_600_000) {
      const entries = parseDirectory(cached.html);
      if (entries.length > 0) return { entries, fetchedAt: cached.modified, fromCache: true };
    }
  }
  const html = await fetchHtml();
  const entries = parseDirectory(html);
  if (entries.length === 0) throw new Error("The movie-screencaps.com directory lists no films: has the page's markup changed? Nothing cached.");
  writeAtomically(file, html);
  return { entries, fetchedAt: now, fromCache: false };
}

// ---------------------------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------------------------

const verdictSchema = z.object({
  /** `colour` passes; `black-and-white` and `too-short` are never picked. */
  verdict: z.enum(["colour", "black-and-white", "too-short"]),
  /** The measurement behind it, e.g. "2.1% of pixels carry colour" or "640 caps". */
  detail: z.string().max(300),
  film: z.object({ title: z.string().max(300), year: z.number().int().nullable() }),
  checkedAt: z.string().max(40),
});
export type GalleryVerdict = z.infer<typeof verdictSchema>;
const verdictsFileSchema = z.record(z.string(), verdictSchema);

/** The verdicts file, read once and saved after every change. */
export class GalleryVerdicts {
  private readonly file: string;
  private readonly verdicts: Map<string, GalleryVerdict>;

  constructor(cacheDir = DEFAULT_CACHE_DIR) {
    this.file = path.join(cacheDir, VERDICTS_FILE);
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Couldn't read ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = verdictsFileSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${this.file} isn't a verdicts file (${parsed.error.issues[0]?.message}); fix or delete it`);
    this.verdicts = new Map(Object.entries(parsed.data));
  }

  get(galleryUrl: string): GalleryVerdict | undefined {
    return this.verdicts.get(galleryUrl);
  }

  /** Records a verdict and saves the file. */
  set(galleryUrl: string, verdict: Omit<GalleryVerdict, "checkedAt">, now = new Date()): void {
    this.verdicts.set(galleryUrl, verdictSchema.parse({ ...verdict, checkedAt: now.toISOString() }));
    const sorted = Object.fromEntries([...this.verdicts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    writeAtomically(this.file, `${JSON.stringify(sorted, null, 2)}\n`);
  }

  get size(): number {
    return this.verdicts.size;
  }

  get path(): string {
    return this.file;
  }
}
