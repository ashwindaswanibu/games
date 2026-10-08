import type { HTTPResponse, Page } from "puppeteer-core";

/**
 * Spoiler watch: proves that nothing the player hasn't earned ever reaches the browser.
 *
 * It records the body of every document, fetch and XHR response from the app (page loads, RSC
 * payloads, server action results, API calls). At each checkpoint the suite says what is still
 * secret (the keys of sealed images not yet in the player's view, answer titles while the play is in
 * progress) and the watch checks both the live page HTML and every response received since the last
 * checkpoint. Image ids themselves are not secret: a view lists every image of its puzzle, sealed,
 * for preloading (see src/core/assets.ts); only a key opens one.
 *
 * Catalog search responses are the player's own searches, so they are checked for keys but not for
 * titles (typing the answer into the search box shows the answer, by design).
 */

interface Captured {
  path: string;
  body: string;
  /** A catalog search result (titles in it are the player's own query). */
  search: boolean;
}

export interface Secrets {
  /** Keys of the sealed images the player's view doesn't contain yet. */
  assetKeys: Iterable<string>;
  /**
   * Positive control: keys of the images the player has earned. Each must have turned up in
   * something the watch scanned (the page HTML or a response, at this checkpoint or an earlier
   * one). If one hasn't, the watch isn't seeing the channel keys arrive on, and a clean result would
   * mean nothing.
   */
  earnedAssetKeys?: Iterable<string>;
  /** Strings that would give the answer away (titles, names). Short ones are skipped as too ambiguous. */
  texts?: Iterable<string>;
}

export interface Leak {
  where: string;
  secret: string;
}

/** Shorter strings appear in ordinary text by chance ("Up", "Heat"), so they can't be checked meaningfully. */
export const MIN_SECRET_TEXT = 5;

const IGNORED_PREFIXES = ["/_next/static/", "/_next/webpack-hmr", "/__nextjs", "/_next/image"];

function htmlEscaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

export class SpoilerWatch {
  private pending: Promise<Captured | null>[] = [];
  private readonly unreadable: string[] = [];
  /** Earned keys found in scanned material so far (for the positive control). */
  private readonly seen = new Set<string>();

  constructor(
    page: Page,
    private readonly origin: string,
  ) {
    page.on("response", (response) => this.record(response));
  }

  private record(response: HTTPResponse): void {
    const url = response.url();
    if (!url.startsWith(this.origin)) return;
    const path = new URL(url).pathname;
    if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
    if (!["document", "fetch", "xhr"].includes(response.request().resourceType())) return;
    const status = response.status();
    if (status >= 300 && status < 400) return; // redirects have no body
    const type = response.headers()["content-type"] ?? "";
    // Images, and sealed images (ciphertext, see src/app/api/assets/[id]/sealed/route.ts).
    if (type.startsWith("image/") || type.startsWith("application/octet-stream")) return;
    this.pending.push(
      response.text().then(
        (body) => ({ path, body, search: path.startsWith("/api/catalog/") }),
        (error: unknown) => {
          this.unreadable.push(`${path} (${error instanceof Error ? error.message : String(error)})`);
          return null;
        },
      ),
    );
  }

  /** Responses whose body couldn't be read, so couldn't be checked. A run with any is not clean. */
  takeUnreadable(): string[] {
    return this.unreadable.splice(0);
  }

  /**
   * Checks the page and every response since the last checkpoint against `secrets`. Returns the
   * leaks, and the earned ids the watch has never seen (see `Secrets.earnedAssetIds`).
   */
  async checkpoint(page: Page, secrets: Secrets): Promise<{ leaks: Leak[]; unseen: string[] }> {
    const responses = (await Promise.all(this.pending.splice(0))).filter((r): r is Captured => r !== null);
    const html = await page.content();
    // Keys are base64url: case matters.
    const keys = [...secrets.assetKeys];
    const texts = [...(secrets.texts ?? [])].filter((text) => text.length >= MIN_SECRET_TEXT);
    const earned = [...(secrets.earnedAssetKeys ?? [])];

    const leaks: Leak[] = [];
    const scan = (where: string, body: string, checkTexts: boolean) => {
      for (const key of keys) if (body.includes(key)) leaks.push({ where, secret: `key ${key.slice(0, 8)}…` });
      for (const key of earned) if (body.includes(key)) this.seen.add(key);
      if (!checkTexts) return;
      for (const text of texts) {
        if (body.includes(text) || body.includes(htmlEscaped(text)) || body.includes(JSON.stringify(text).slice(1, -1))) {
          leaks.push({ where, secret: `"${text}"` });
        }
      }
    };
    scan("page HTML", html, true);
    for (const response of responses) scan(`response ${response.path}`, response.body, !response.search);
    return { leaks, unseen: earned.filter((key) => !this.seen.has(key)).map((key) => `${key.slice(0, 8)}…`) };
  }
}
