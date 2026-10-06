import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeStill, fetchFilmStills, rankBackdrops, STILL_MAX_WIDTH, tmdbAuth, tmdbClient, type TmdbImage } from "./tmdb.mjs";

const V3_KEY = "0123456789abcdef0123456789abcdef";

const backdrop = (over: Partial<TmdbImage>): TmdbImage => ({
  file_path: "/a.jpg",
  width: 1920,
  height: 1080,
  iso_639_1: null,
  vote_average: 5,
  vote_count: 3,
  aspect_ratio: 1.778,
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TMDB auth", () => {
  it("sends v3 keys as api_key and v4 tokens as a bearer token", () => {
    expect(tmdbAuth(V3_KEY)).toEqual({ headers: {}, query: { api_key: V3_KEY } });
    expect(tmdbAuth("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln")).toEqual({ headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln" }, query: {} });
    expect(() => tmdbAuth("nope")).toThrow(/doesn't look like/);
  });

  it("fails with instructions when TMDB_API_KEY is missing", () => {
    vi.stubEnv("TMDB_API_KEY", "");
    expect(() => tmdbClient()).toThrow(/TMDB_API_KEY is not set.*themoviedb\.org/);
  });
});

describe("rankBackdrops", () => {
  it("keeps textless landscape images, wide ones first by votes", () => {
    const ranked = rankBackdrops([
      backdrop({ file_path: "/titled.jpg", iso_639_1: "en", vote_average: 9 }),
      backdrop({ file_path: "/small.jpg", width: 780, height: 439, vote_average: 8 }),
      backdrop({ file_path: "/portrait.jpg", aspect_ratio: 0.667, vote_average: 9 }),
      backdrop({ file_path: "/good.jpg", vote_average: 6 }),
      backdrop({ file_path: "/best.jpg", vote_average: 7 }),
    ]);
    expect(ranked.map((b) => b.file_path)).toEqual(["/best.jpg", "/good.jpg"]);
    // Small ones are used only when nothing wide exists.
    expect(rankBackdrops([backdrop({ file_path: "/small.jpg", width: 780 })]).map((b) => b.file_path)).toEqual(["/small.jpg"]);
  });
});

describe("stills", () => {
  it("re-encodes to webp at most 1280 px wide and strips metadata", async () => {
    const source = await sharp({ create: { width: 2400, height: 1000, channels: 3, background: { r: 200, g: 120, b: 30 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret source", ImageDescription: "Answer: Inception" } } })
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const still = await encodeStill(source);
    const meta = await sharp(still.bytes).metadata();
    expect(still).toMatchObject({ mime: "image/webp", width: STILL_MAX_WIDTH, height: 533 });
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(still.bytes.includes(Buffer.from("Inception"))).toBe(false);
  });

  it("asks TMDB for textless backdrops and downloads the best ones", async () => {
    const jpeg = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#336" } }).jpeg().toBuffer();
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/movie/27205/images")) {
        return Response.json({ id: 27205, backdrops: [backdrop({ file_path: "/one.jpg", vote_average: 6 }), backdrop({ file_path: "/two.jpg", vote_average: 7 })] });
      }
      return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    const client = tmdbClient(V3_KEY, { fetchImpl, log: () => {}, sleep: async () => {} });
    const stills = await fetchFilmStills(client, 27205, 1);
    expect(stills).toHaveLength(1);
    expect(stills[0]).toMatchObject({ source: "/two.jpg", mime: "image/webp", width: 1280, height: 720 });
    expect(urls[0]).toContain("include_image_language=null");
    expect(urls[0]).toContain(`api_key=${V3_KEY}`);
    expect(urls[1]).toBe("https://image.tmdb.org/t/p/w1280/two.jpg");
  });

  it("treats an unknown TMDB id as having no stills", async () => {
    const fetchImpl = (async () => new Response('{"status_code":34}', { status: 404 })) as unknown as typeof fetch;
    const client = tmdbClient(V3_KEY, { fetchImpl, log: () => {}, sleep: async () => {} });
    await expect(client.backdrops(1)).resolves.toEqual([]);
  });
});
