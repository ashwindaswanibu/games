import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer-core";

/**
 * Browser helpers for the E2E suites: the installed Chrome (no browser download), a phone-sized
 * viewport, and the few interactions the suites need, all found the way a player finds them (by
 * visible label and text), so a suite breaks when the UI a player relies on breaks.
 */

export const PHONE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;

/** Generous: the dev server compiles each route on its first request. */
export const WAIT_MS = 45_000;

export async function launchChrome(executablePath: string): Promise<Browser> {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions"],
  });
}

/** Console errors and uncaught page errors, which every suite treats as failures. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${new URL(page.url()).pathname}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${new URL(page.url()).pathname}: uncaught ${error instanceof Error ? error.message : String(error)}`));
  return errors;
}

export async function newPhonePage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport(PHONE_VIEWPORT);
  page.setDefaultTimeout(WAIT_MS);
  page.setDefaultNavigationTimeout(WAIT_MS);
  return page;
}

export async function signIn(page: Page, baseUrl: string, username: string, password: string): Promise<void> {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="username"]', username);
  await page.type('input[name="password"]', password);
  await clickButton(page, "Sign in");
  await page.waitForFunction(() => window.location.pathname === "/", { timeout: WAIT_MS });
}

/** The session cookies, as a `Cookie` header for requests made outside the page. */
export async function cookieHeader(browser: Browser, baseUrl: string): Promise<string> {
  const host = new URL(baseUrl).hostname;
  const cookies = await browser.cookies();
  return cookies
    .filter((cookie) => cookie.domain.replace(/^\./, "") === host)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

type TextMatch = string | { pattern: string; flags?: string };

function matcherSource(match: TextMatch): { exact: string | null; pattern: string | null; flags: string } {
  return typeof match === "string" ? { exact: match, pattern: null, flags: "" } : { exact: null, pattern: match.pattern, flags: match.flags ?? "" };
}

/** Waits for an enabled button whose visible text is `text` (whitespace-normalized) and clicks it. */
export async function clickButton(page: Page, text: TextMatch): Promise<void> {
  const m = matcherSource(text);
  const handle = await page.waitForFunction(
    (exact, pattern, flags) => {
      const re = pattern === null ? null : new RegExp(pattern, flags);
      for (const button of document.querySelectorAll("button")) {
        const label = (button.textContent ?? "").replace(/\s+/g, " ").trim();
        if (button.disabled || button.closest("[hidden]")) continue;
        if (exact !== null ? label === exact : re!.test(label)) return button;
      }
      return false;
    },
    { timeout: WAIT_MS },
    m.exact,
    m.pattern,
    m.flags,
  );
  await (handle.asElement() as ElementHandle<HTMLButtonElement>).click();
}

/** Waits until some element matching `selector` has exactly this (normalized) text. */
export async function waitForText(page: Page, selector: string, text: string, timeout = WAIT_MS): Promise<void> {
  await page.waitForFunction(
    (sel, want) => [...document.querySelectorAll(sel)].some((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim() === want),
    { timeout },
    selector,
    text,
  );
}

export async function hasText(page: Page, selector: string, text: string): Promise<boolean> {
  return page.evaluate(
    (sel, want) => [...document.querySelectorAll(sel)].some((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim() === want),
    selector,
    text,
  );
}

/** True when the page's visible text contains `text`. */
export async function pageSays(page: Page, text: string): Promise<boolean> {
  return page.evaluate((want) => document.body.innerText.replace(/\s+/g, " ").includes(want), text);
}

/** The `<input role="combobox">` labelled `label`. */
async function comboboxByLabel(page: Page, label: string): Promise<ElementHandle<HTMLInputElement>> {
  const handle = await page.waitForFunction(
    (want) => {
      const el = [...document.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === want);
      const input = el ? document.getElementById(el.htmlFor) : null;
      return input instanceof HTMLInputElement && input.getAttribute("role") === "combobox" && !input.disabled ? input : false;
    },
    { timeout: WAIT_MS },
    label,
  );
  return handle.asElement() as ElementHandle<HTMLInputElement>;
}

export interface OptionMatch {
  /** The hit's main line (film title, person name), exactly. */
  primary: string;
  /** The start of its second line (e.g. the film's year), to tell namesakes apart. */
  secondaryPrefix?: string | null;
}

/** Types `query` into the search labelled `label` and waits for an option matching `want`. */
export async function searchFor(page: Page, label: string, query: string, want: OptionMatch): Promise<ElementHandle<HTMLLIElement>> {
  const input = await comboboxByLabel(page, label);
  await input.evaluate((el) => {
    el.focus();
    el.select();
  });
  await input.type(query, { delay: 12 });
  const listId = await input.evaluate((el) => el.getAttribute("aria-controls"));
  if (!listId) throw new Error(`The "${label}" search has no listbox`);
  const option = await page.waitForFunction(
    (id, primary, prefix) => {
      const options = document.getElementById(id)?.querySelectorAll<HTMLLIElement>('[role="option"]') ?? [];
      for (const option of options) {
        const [first, second] = option.children;
        if ((first?.textContent ?? "") !== primary) continue;
        if (prefix === null || (second?.textContent ?? "").startsWith(prefix)) return option;
      }
      return false;
    },
    { timeout: WAIT_MS },
    listId,
    want.primary,
    want.secondaryPrefix ?? null,
  );
  return option.asElement() as ElementHandle<HTMLLIElement>;
}

/** Searches and picks the matching hit. */
export async function pickFromSearch(page: Page, label: string, query: string, want: OptionMatch): Promise<void> {
  const option = await searchFor(page, label, query, want);
  await option.click();
}

/** Waits until no game control is mid-move (inputs are disabled while a move is in flight). */
export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('input[role="combobox"][disabled]'), { timeout: WAIT_MS });
}

/** Waits for every `<img>` on the page to finish loading; returns the srcs that failed. */
export async function waitForImages(page: Page): Promise<string[]> {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), { timeout: WAIT_MS });
  return page.evaluate(() => [...document.images].filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute("src") ?? ""));
}

export async function imageSrcs(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.images].map((img) => img.getAttribute("src") ?? ""));
}

/** Widest scroll extent of the page; equal to the viewport width when nothing overflows sideways. */
export async function scrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
}
