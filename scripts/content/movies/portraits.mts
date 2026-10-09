/**
 * Faces for the catalog's people, for Degrees of Separation's thread.
 *
 *   npm run content:movies:portraits                     everyone in Degrees puzzles from today on
 *   npm run content:movies:portraits -- --top 2000       … and the 2,000 best-known actors
 *   npm run content:movies:portraits -- --people 12,34   just these people
 *   npm run content:movies:portraits -- --refresh        fetch again, even people who have a face
 *   npm run content:movies:portraits -- --dry-run --preview /tmp/faces   crop, write the crops there, store nothing
 *   npm run content:movies:portraits -- --concurrency 2                  downloads at once (default 2; Wikimedia limits bursts)
 *
 * For each person: their photo on Wikidata (P18) → its Wikimedia Commons file, if its license is
 * one we can use with a credit (`isUsableLicense`) → a 960px copy → Apple Vision finds the face
 * (`lib/faces.mts`, so this runs on a Mac) → a square around it (`faceCrop`) as a 384px WebP →
 * `movie_person_portraits`, with the photo's author, license and Commons page for the credit. A
 * photo without one clear face is skipped: a bad crop is worse than a plain knot. Downloads go to
 * the temp directory and are deleted as soon as they're cropped. Toning happens on screen, not here.
 *
 * A non-local database needs `--allow-remote` to write, or `--allow-remote-read` for a dry run.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { today } from "@/core/day";
import { toBytea } from "../lib/db.mjs";
import { findFaces } from "./lib/faces.mjs";
import { chunk, fetchWithRetry, mapPool, USER_AGENT } from "./lib/http.mjs";
import { pipelineDb, positiveInt, selectAllPages, type ContentDb } from "./lib/pipeline.mjs";
import { faceCrop, isUsableLicense, mainFace, pickImage, plainCredit, PORTRAIT_SIZE, type ImageClaim } from "./lib/portraits.mjs";

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    top: { type: "string", default: "0" },
    people: { type: "string" },
    refresh: { type: "boolean", default: false },
    concurrency: { type: "string", default: "2" },
    "dry-run": { type: "boolean", default: false },
    preview: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
});

/** Commons' thumbnail width to fetch: a standard step (served from cache), big enough for a 384px face crop. */
const FETCH_WIDTH = 960;
/** People per round of downloads, face finding and writes. */
const ROUND = 24;
/**
 * Wikimedia's image servers turn away fast bursts (HTTP 429): downloads start at least this far
 * apart, and a refused one waits several seconds before trying again.
 */
const DOWNLOAD_SPACING_MS = 400;
let nextDownload = 0;
async function downloadSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextDownload);
  nextDownload = at + DOWNLOAD_SPACING_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

interface Person {
  id: number;
  name: string;
  wikidata_id: string;
}

interface Photo {
  person: Person;
  file: string;
  thumb: string;
  page: string;
  license: string;
  licenseUrl: string | null;
  author: string | null;
}

type Outcome = "written" | "previewed" | "no photo" | "license" | "no face" | "failed";

const json = async <T,>(url: string, label: string): Promise<T> => {
  const response = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }, { label });
  return (await response.json()) as T;
};

/** Everyone in Degrees puzzles from `from` on: start and end actors, and our routes' co-stars. */
async function puzzlePeople(db: ContentDb, from: string): Promise<number[]> {
  const rows = await selectAllPages<{ payload: unknown; solution: unknown }>((first, last) =>
    db.from("puzzles").select("payload, solution").eq("game_id", "degrees").gte("puzzle_date", from).order("puzzle_date").range(first, last),
  );
  const ids = new Set<number>();
  for (const { payload, solution } of rows) {
    const p = payload as { start?: { id?: number }; end?: { id?: number } };
    const s = solution as { path?: { person?: { id?: number } }[] };
    for (const id of [p.start?.id, p.end?.id, ...(s.path ?? []).map((l) => l.person?.id)]) if (typeof id === "number") ids.add(id);
  }
  return [...ids];
}

async function topActors(db: ContentDb, count: number): Promise<number[]> {
  if (count === 0) return [];
  const ids: number[] = [];
  for (let from = 0; from < count; from += 1000) {
    const { data, error } = await db
      .from("movie_people")
      .select("id")
      .eq("is_actor", true)
      .not("wikidata_id", "is", null)
      .order("popularity", { ascending: false })
      .order("id")
      .range(from, Math.min(count, from + 1000) - 1);
    if (error) throw new Error(`Couldn't list actors: ${error.message}`);
    ids.push(...data.map((row) => row.id));
    if (data.length < 1000) break;
  }
  return ids;
}

async function loadPeople(db: ContentDb, ids: readonly number[]): Promise<Person[]> {
  const people: Person[] = [];
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from("movie_people").select("id, name, wikidata_id").in("id", part);
    if (error) throw new Error(`Couldn't load people: ${error.message}`);
    for (const row of data) if (row.wikidata_id) people.push({ id: row.id, name: row.name, wikidata_id: row.wikidata_id });
  }
  return people;
}

async function havePortraits(db: ContentDb, ids: readonly number[]): Promise<Set<number>> {
  const have = new Set<number>();
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from("movie_person_portraits").select("person_id").in("person_id", part);
    if (error) throw new Error(`Couldn't read portraits: ${error.message}`);
    for (const row of data) have.add(row.person_id);
  }
  return have;
}

/** Each person's photo file on Commons (Wikidata P18), for those who have one. */
async function photoFiles(people: readonly Person[]): Promise<Map<number, string>> {
  const files = new Map<number, string>();
  for (const part of chunk(people, 50)) {
    const url = `${WIKIDATA_API}?${new URLSearchParams({ action: "wbgetentities", ids: part.map((p) => p.wikidata_id).join("|"), props: "claims", format: "json" })}`;
    const body = await json<{ entities?: Record<string, { claims?: { P18?: ImageClaim[] } }> }>(url, "wikidata entities");
    for (const person of part) {
      const file = pickImage(body.entities?.[person.wikidata_id]?.claims?.P18);
      if (file) files.set(person.id, file);
    }
  }
  return files;
}

interface CommonsPage {
  title: string;
  missing?: boolean;
  imageinfo?: {
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** What Commons says about each file: a sized copy, its page, its license and its author. */
async function describePhotos(people: readonly Person[], files: ReadonlyMap<number, string>): Promise<{ photos: Photo[]; unlicensed: number }> {
  const photos: Photo[] = [];
  let unlicensed = 0;
  const wanted = people.filter((p) => files.has(p.id));
  for (const part of chunk(wanted, 50)) {
    const titles = part.map((p) => `File:${files.get(p.id)!}`);
    const url = `${COMMONS_API}?${new URLSearchParams({
      action: "query",
      titles: titles.join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(FETCH_WIDTH),
      format: "json",
      formatversion: "2",
    })}`;
    const body = await json<{ query?: { normalized?: { from: string; to: string }[]; pages?: CommonsPage[] } }>(url, "commons imageinfo");
    const renamed = new Map((body.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const pages = new Map((body.query?.pages ?? []).map((page) => [page.title, page]));
    part.forEach((person, i) => {
      const page = pages.get(renamed.get(titles[i]!) ?? titles[i]!);
      const info = page?.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      const license = plainCredit(meta.LicenseShortName?.value, 80);
      if (!info?.thumburl || !info.descriptionurl || !license) return;
      if (!isUsableLicense(license)) {
        unlicensed++;
        return;
      }
      const licenseUrl = meta.LicenseUrl?.value && /^https?:\/\//.test(meta.LicenseUrl.value) ? meta.LicenseUrl.value : null;
      photos.push({ person, file: files.get(person.id)!, thumb: info.thumburl, page: info.descriptionurl, license, licenseUrl, author: plainCredit(meta.Artist?.value) });
    });
  }
  return { photos, unlicensed };
}

/** One round: download, find the faces, crop and store (or preview). Every download is deleted after. */
async function processRound(db: ContentDb, photos: readonly Photo[], work: string, concurrency: number): Promise<Map<number, Outcome>> {
  const outcomes = new Map<number, Outcome>();
  const local = new Map<number, string>();
  await mapPool(photos, concurrency, async (photo) => {
    try {
      await downloadSlot();
      const response = await fetchWithRetry(photo.thumb, { headers: { "User-Agent": USER_AGENT } }, { label: "commons thumbnail", baseDelayMs: 5000, attempts: 6 });
      // Upright and plain: the face finder and the crop must see the same pixels.
      const upright = await sharp(Buffer.from(await response.arrayBuffer())).rotate().jpeg({ quality: 92 }).toBuffer();
      const file = path.join(work, `${photo.person.id}.jpg`);
      await writeFile(file, upright);
      local.set(photo.person.id, file);
    } catch (error) {
      outcomes.set(photo.person.id, "failed");
      console.error(`  ✗ ${photo.person.name}: download failed (${error instanceof Error ? error.message : String(error)})`);
    }
  });

  const found = await findFaces([...local.values()]);
  for (const photo of photos) {
    const file = local.get(photo.person.id);
    if (!file) continue;
    try {
      const faces = found.get(file);
      const face = faces ? mainFace(faces.faces) : null;
      if (!faces || !face) {
        outcomes.set(photo.person.id, "no face");
        continue;
      }
      const crop = faceCrop(faces.width, faces.height, face);
      const bytes = await sharp(file)
        .extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size })
        .resize(PORTRAIT_SIZE, PORTRAIT_SIZE)
        .webp({ quality: 78 })
        .toBuffer();
      const version = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      if (args.preview) await writeFile(path.join(args.preview, `${photo.person.id}-${slug(photo.person.name)}.webp`), bytes);
      if (args["dry-run"]) {
        outcomes.set(photo.person.id, "previewed");
        continue;
      }
      const { error } = await db.from("movie_person_portraits").upsert(
        {
          person_id: photo.person.id,
          bytes: toBytea(bytes),
          version,
          width: PORTRAIT_SIZE,
          height: PORTRAIT_SIZE,
          source_file: photo.file.slice(0, 300),
          source_url: photo.page,
          author: photo.author,
          license: photo.license,
          license_url: photo.licenseUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "person_id" },
      );
      if (error) throw new Error(error.message);
      outcomes.set(photo.person.id, "written");
    } catch (error) {
      outcomes.set(photo.person.id, "failed");
      console.error(`  ✗ ${photo.person.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(file, { force: true });
    }
  }
  return outcomes;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function main() {
  const dryRun = args["dry-run"];
  if (args["allow-remote-read"] && !args["allow-remote"] && !dryRun) {
    throw new Error("--allow-remote-read is for a --dry-run; writing to a non-local database needs --allow-remote (owner only)");
  }
  const top = positiveInt(args.top, "top", { min: 0, max: 50_000 });
  const concurrency = positiveInt(args.concurrency, "concurrency", { min: 1, max: 8 });
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });
  if (args.preview) await mkdir(args.preview, { recursive: true });

  const named = args.people ? args.people.split(",").map((id) => positiveInt(id.trim(), "people")) : null;
  const ids = named ?? [...new Set([...(await puzzlePeople(db, args.from ?? today())), ...(await topActors(db, top))])];
  const have = args.refresh ? new Set<number>() : await havePortraits(db, ids);
  const people = (await loadPeople(db, ids)).filter((p) => !have.has(p.id));
  console.log(`${ids.length} people asked for; ${have.size} already have a face; ${people.length} to look up.`);

  const files = await photoFiles(people);
  const { photos, unlicensed } = await describePhotos(people, files);
  console.log(`${files.size} have a photo on Wikidata; ${photos.length} usable (${unlicensed} skipped for their license).`);

  const counts: Record<Outcome, number> = { written: 0, previewed: 0, "no photo": people.length - files.size, license: unlicensed, "no face": 0, failed: 0 };
  const work = await mkdtemp(path.join(tmpdir(), "games-portraits-"));
  try {
    const rounds = chunk(photos, ROUND);
    for (const [i, round] of rounds.entries()) {
      for (const outcome of (await processRound(db, round, work, concurrency)).values()) counts[outcome]++;
      console.log(`  round ${i + 1}/${rounds.length}: ${counts.written + counts.previewed} faces so far`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(
    `\n${dryRun ? `Dry run: ${counts.previewed} faces cropped, nothing stored.` : `${counts.written} faces stored.`} ` +
      `No photo: ${counts["no photo"]}. License: ${counts.license}. No clear face: ${counts["no face"]}. Failed: ${counts.failed}.`,
  );
  if (counts.failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
