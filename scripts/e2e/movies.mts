/**
 * End-to-end suite for the Movies bucket: drives the installed Chrome at phone size against a local
 * dev server and plays every Movies game to the end, as the local admin test account.
 *
 *   npx next dev -p 3300            (in another terminal)
 *   npm run test:e2e
 *
 * For each game it starts today's puzzle, makes a wrong move and checks the feedback, plays to a win,
 * and checks the result card, share grid and friends' results. Throughout, it proves the spoiler
 * wall: no asset id the player hasn't earned (and no answer title, while playing) ever appears in
 * the page HTML or in any response the browser receives, and `/api/assets/<id>` refuses ids that
 * aren't in the player's view yet. The right answers come from the stored solutions, read with the
 * service-role key inside this script only.
 *
 * The run starts by deleting the test account's plays of today's Movies puzzles (local database
 * only), so it can be repeated. Screenshots go to design/overnight-shots/.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Browser, Page } from "puppeteer-core";
import { z } from "zod";
import { assetUrl, referencedAssetIds } from "@/core/assets";
import { today, type PuzzleDate } from "@/core/day";
import type { AnyGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { describeClue, spokenClues } from "@/games/_movies/clue-text";
import { computeClues } from "@/games/_movies/hints";
import type { ClueKind, FilmDetails, PersonRef } from "@/games/_movies/schemas";
import { colorBarcode, LEVEL_COUNT, MAX_GUESSES as BARCODE_GUESSES } from "@/games/color-barcode/logic";
import { colorGrade, CLUE_KINDS as GRADE_CLUES, MAX_TRIES } from "@/games/color-grade/logic";
import { chainScore, degrees, maxLinks } from "@/games/degrees/logic";
import { FRAME_COUNT, frameByFrame, CLUE_KINDS as FRAME_CLUES } from "@/games/frame-by-frame/logic";
import type { PlayRow } from "@/server/database.types";
import {
  clickButton,
  collectPageErrors,
  cookieHeader,
  hasText,
  imageSrcs,
  launchChrome,
  newPhonePage,
  pageSays,
  pickFromSearch,
  scrollWidth,
  searchFor,
  signIn,
  waitForIdle,
  waitForImages,
  waitForText,
  PHONE_VIEWPORT,
} from "./lib/browser.mjs";
import { assetIdsFor, decoyFilms, degreesDetour, e2eDb, loadPlay, loadPuzzle, profileByUsername, resetAssetBurst, resetPlays, waitForPlayVersion, type E2eDb } from "./lib/db.mjs";
import { e2eEnv } from "./lib/env.mjs";
import { Report } from "./lib/report.mjs";
import { SpoilerWatch } from "./lib/spoilers.mjs";

const MOVIES_GAMES: readonly AnyGame[] = [degrees, frameByFrame, colorGrade, colorBarcode];

interface Ctx {
  page: Page;
  browser: Browser;
  db: E2eDb;
  report: Report;
  watch: SpoilerWatch;
  baseUrl: string;
  shotsDir: string;
  userId: string;
  username: string;
  displayName: string;
  date: PuzzleDate;
}

// ---------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------

/**
 * Checks the spoiler wall at this point of the play: every stored asset not in the player's current
 * view (puzzle, state and, once finished, reveal) is secret, and so are `secretTexts`.
 */
async function spoilerCheckpoint(
  ctx: Ctx,
  game: AnyGame,
  loaded: { puzzle: unknown; solution: unknown },
  label: string,
  secretTexts: readonly string[] = [],
): Promise<void> {
  const row = await loadPlay(ctx.db, ctx.userId, game.id, ctx.date);
  const visible = new Set<string>();
  if (row) {
    const finished = row.status !== "in_progress";
    const reveal = finished && game.reveal ? game.reveal({ puzzle: loaded.puzzle, solution: loaded.solution }) : null;
    for (const part of [loaded.puzzle, row.state, reveal]) for (const id of referencedAssetIds(part)) visible.add(id);
  }
  const stored = [...(await assetIdsFor(ctx.db, game.id, ctx.date))];
  const hidden = stored.filter((id) => !visible.has(id));
  const earned = stored.filter((id) => visible.has(id));
  const { leaks, unseen } = await ctx.watch.checkpoint(ctx.page, { assetIds: hidden, texts: secretTexts, earnedAssetIds: earned });
  ctx.report.check(`no spoilers ${label} (${hidden.length} secret assets, ${secretTexts.length} secret titles)`, leaks.length === 0, leaks);
  if (earned.length > 0) ctx.report.check(`spoiler scan has seen all ${earned.length} earned assets arrive (positive control) ${label}`, unseen.length === 0, unseen);
}

async function assetStatus(ctx: Ctx, id: string, signedIn = true): Promise<{ status: number; type: string }> {
  const headers: Record<string, string> = signedIn ? { Cookie: await cookieHeader(ctx.browser, ctx.baseUrl) } : {};
  const response = await fetch(`${ctx.baseUrl}${assetUrl(id)}`, { headers, redirect: "manual" });
  await response.arrayBuffer();
  return { status: response.status, type: response.headers.get("content-type") ?? "" };
}

/** `/api/assets/<id>` serves exactly the ids in the player's view: images for `shown`, 403/404 for `hidden`. */
async function checkAssetAccess(ctx: Ctx, label: string, access: { shown?: readonly string[]; hidden?: readonly string[] }): Promise<void> {
  await resetAssetBurst(ctx.db, ctx.userId);
  for (const id of access.shown ?? []) {
    const { status, type } = await assetStatus(ctx, id);
    ctx.report.check(`${label}: earned asset ${id.slice(0, 8)} is served`, status === 200 && type.startsWith("image/"), { status, type });
  }
  for (const id of access.hidden ?? []) {
    const { status } = await assetStatus(ctx, id);
    ctx.report.check(`${label}: unrevealed asset ${id.slice(0, 8)} is refused`, status === 403 || status === 404, { status });
  }
}

async function shot(ctx: Ctx, name: string): Promise<void> {
  const file = path.join(ctx.shotsDir, `movies-${name}.png`);
  // Full-page captures freeze fixed and sticky chrome where it was on screen; from the top, the
  // header and nav sit where a player first sees them.
  await ctx.page.evaluate(() => window.scrollTo(0, 0));
  await ctx.page.screenshot({ path: file as `${string}.png`, fullPage: true });
  ctx.report.note(`screenshot ${path.relative(process.cwd(), file)}`);
}

async function checkNoSidewaysScroll(ctx: Ctx, label: string): Promise<void> {
  const width = await scrollWidth(ctx.page);
  ctx.report.check(`${label}: no sideways scroll at ${PHONE_VIEWPORT.width}px`, width <= PHONE_VIEWPORT.width, { scrollWidth: width });
}

/** Opens the game's page, checks the spoiler wall before anything is played, and presses Start. */
async function openAndStart(ctx: Ctx, game: AnyGame, loaded: { puzzle: unknown; solution: unknown }, secretTexts: readonly string[]): Promise<PlayRow> {
  const { page, report } = ctx;
  await page.goto(`${ctx.baseUrl}/play/${game.id}`, { waitUntil: "networkidle0" });
  await waitForText(page, "h1", game.name);
  report.check("friends' results are locked before playing", await pageSays(page, "Finish the puzzle to see how your friends did."));
  await spoilerCheckpoint(ctx, game, loaded, "before starting", secretTexts);

  await clickButton(page, "Start");
  const row = await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: game.id, date: ctx.date, version: 0 });
  report.equal("the play starts in progress", row.status, "in_progress");
  await waitForText(page, "h2", game.name);
  return row;
}

/** Runs a UI action that submits one move and waits until the server has applied it. */
async function playMove(ctx: Ctx, game: AnyGame, version: number, action: () => Promise<void>): Promise<PlayRow> {
  await action();
  const row = await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: game.id, date: ctx.date, version });
  await waitForIdle(ctx.page);
  return row;
}

/** The chip texts a wrong guess must show, computed from the catalog facts (glyph + words). */
function expectedChips(guess: FilmDetails, answer: FilmDetails, kinds: readonly ClueKind[]): string[] {
  return computeClues(guess, answer, kinds).map((clue) => {
    const chip = describeClue(clue);
    return `${chip.glyph}${chip.text}`;
  });
}

/** Checks row `index` (0-based) of the guess log labelled `logLabel`. */
async function checkLogRow(
  ctx: Ctx,
  logLabel: string,
  index: number,
  expected: { kind: "miss"; film: FilmDetails; chips: string[] } | { kind: "skip" } | { kind: "hit"; film: FilmDetails },
): Promise<void> {
  const name = `${logLabel} row ${index + 1}`;
  await ctx.page.waitForFunction(
    (label, i) => (document.querySelector(`ol[aria-label="${label}"]`)?.children.length ?? 0) > i,
    {},
    logLabel,
    index,
  );
  const row = await ctx.page.evaluate(
    (label, i, title) => {
      const li = document.querySelector(`ol[aria-label="${label}"]`)!.children[i] as HTMLElement;
      // The chip as seen: its glyph and words, without the screen-reader-only full text. (No named
      // helper functions in here: tsx's __name wrapper doesn't exist in the page.)
      const chips = title
        ? [...document.querySelectorAll(`ul[aria-label="Clues from ${CSS.escape(title)}"] li`)].map((chip) => {
            const copy = chip.cloneNode(true) as Element;
            copy.querySelectorAll("[data-sr-only]").forEach((el) => el.remove());
            return (copy.textContent ?? "").trim();
          })
        : [];
      return { text: (li.textContent ?? "").replace(/\s+/g, " "), chips };
    },
    logLabel,
    index,
    expected.kind === "skip" ? null : expected.film.title,
  );
  if (expected.kind === "skip") {
    ctx.report.check(`${name} shows the skip`, row.text.includes("Skipped"), row.text);
    return;
  }
  ctx.report.check(`${name} names ${expected.film.title}`, row.text.includes(expected.film.title), row.text);
  if (expected.kind === "hit") {
    ctx.report.check(`${name} is marked correct`, row.text.includes("Got it"), row.text);
    return;
  }
  ctx.report.check(`${name} is marked as a miss`, row.text.includes("Miss"), row.text);
  ctx.report.equal(expected.chips.length > 0 ? `${name} shows the right clues` : `${name} shows no clues`, row.chips, expected.chips);
}

/**
 * After a wrong guess, its verdict and clues must be on screen without scrolling (above the fixed
 * bottom nav, right under the search), and a screen reader must hear the clues.
 */
async function checkLastGuess(ctx: Ctx, game: string, guess: FilmDetails, answer: FilmDetails, kinds: readonly ClueKind[]): Promise<void> {
  const { page, report } = ctx;
  const clues = computeClues(guess, answer, kinds);
  await page.waitForSelector('section[aria-label="Your last guess"]');
  // The board scrolls it into view after the move (smoothly): give that a moment to finish.
  await page
    .waitForFunction(
      () => {
        const box = document.querySelector('section[aria-label="Your last guess"]')!.getBoundingClientRect();
        const nav = document.querySelector('[data-app-chrome="bottom-nav"]');
        return box.top >= 0 && box.bottom <= (nav ? nav.getBoundingClientRect().top : window.innerHeight);
      },
      { timeout: 3000 },
    )
    .catch(() => undefined);
  const seen = await page.evaluate(() => {
    const box = document.querySelector('section[aria-label="Your last guess"]')!;
    const nav = document.querySelector('[data-app-chrome="bottom-nav"]');
    const floor = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    const rect = box.getBoundingClientRect();
    const status = [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "").join(" | ");
    return { text: (box.textContent ?? "").replace(/\s+/g, " "), top: rect.top, bottom: rect.bottom, floor, status };
  });
  report.check(`${game}: the last guess names ${guess.title} as a miss`, seen.text.includes(`Not ${guess.title}`), seen.text);
  const what = clues.length > 0 ? "the clues" : "the miss (no clues)";
  report.check(`${game}: the last guess ${clues.length > 0 ? "and its clues are" : "is"} in view without scrolling`, seen.top >= 0 && seen.bottom <= seen.floor, seen);
  report.check(`${game}: a screen reader hears ${what}`, seen.status.includes(`${guess.title} isn't it. ${spokenClues(clues)}`), seen.status);
}

/** The platform result card: outcome line, score, label and share grid, matched against the stored play. */
async function checkResultCard(ctx: Ctx, row: PlayRow, expected: { score: number; label: string; grid: string }): Promise<void> {
  const { page, report } = ctx;
  await waitForText(page, "p", `points · ${expected.label}`);
  const card = await page.evaluate((label) => {
    const points = [...document.querySelectorAll("p")].find((p) => (p.textContent ?? "").trim() === `points · ${label}`)!;
    const head = points.parentElement!;
    const cardEl = head.parentElement!;
    return {
      outcome: (head.children[0]?.textContent ?? "").trim(),
      score: (head.children[1]?.textContent ?? "").trim(),
      grid: (head.nextElementSibling?.textContent ?? "").trim(),
      share: [...cardEl.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "Share result"),
    };
  }, expected.label);
  report.equal("result card says solved", card.outcome, "Solved");
  report.equal("stored score is as expected", row.score, expected.score);
  report.equal("result card shows the score", card.score, String(expected.score));
  report.equal("stored share grid is as expected", row.share_grid, expected.grid);
  report.equal("result card shows the share grid", card.grid, expected.grid);
  report.check("result card has a share button", card.share);
}

/** Friends' results unlock once the play is finished and include the player's own row. */
async function checkFriendsResults(ctx: Ctx, row: PlayRow): Promise<void> {
  const { page, report } = ctx;
  await waitForText(page, "h2", "How everyone did");
  const mine = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll("h2")].find((h) => (h.textContent ?? "").trim() === "How everyone did")!;
    const rows = [...(heading.closest("section")?.querySelectorAll(":scope > div:last-child > div") ?? [])];
    const own = rows.find((r) => r.querySelector("p")?.textContent?.trim() === name);
    return { rows: rows.length, text: own ? (own.textContent ?? "").replace(/\s+/g, " ") : null };
  }, ctx.displayName);
  report.check("friends' results list players", mine.rows > 0, mine);
  report.check("friends' results show @username next to the display name", mine.text !== null && mine.text.includes(`@${ctx.username}`), mine.text);
  report.check(
    "friends' results show my score, label and grid",
    mine.text !== null && mine.text.includes(row.share_grid ?? "\0") && mine.text.includes(row.result_label ?? "\0") && mine.text.includes(String(row.score)),
    mine.text,
  );
  report.check("the locked-results note is gone", !(await pageSays(page, "Finish the puzzle to see how your friends did.")));
}

async function checkFinishedImages(ctx: Ctx, label: string): Promise<void> {
  const failed = await waitForImages(ctx.page);
  ctx.report.check(`${label}: every image loaded`, failed.length === 0, failed);
}

// ---------------------------------------------------------------------------------------------
// Degrees of Separation
// ---------------------------------------------------------------------------------------------

const degreesStateSchema = z.object({
  links: z.array(z.object({ film: z.object({ id: z.number() }), person: z.object({ id: z.number() }) })),
});

async function playDegrees(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, degrees, ctx.date);
  const { puzzle, solution } = loaded;
  const route = solution.path;
  report.note(`today: ${puzzle.start.name} → ${puzzle.end.name}, par ${puzzle.par}${puzzle.fixture ? " (DEV FIXTURE)" : ""}`);

  /** Route films and co-stars the player hasn't put in their chain are secret while playing. */
  const secretsFor = async (): Promise<string[]> => {
    const row = await loadPlay(ctx.db, ctx.userId, degrees.id, ctx.date);
    if (row && row.status !== "in_progress") return [];
    const links = row ? degreesStateSchema.parse(row.state).links : [];
    return route.flatMap((link) => [
      ...(links.some((l) => l.film.id === link.film.id) ? [] : [link.film.title]),
      ...(link.person.id === puzzle.end.id || links.some((l) => l.person.id === link.person.id) ? [] : [link.person.name]),
    ]);
  };

  await openAndStart(ctx, degrees, loaded, await secretsFor());
  const limit = maxLinks(puzzle);
  report.check(`countdown shows ${limit} links left`, await page.$(`[role="img"][aria-label="${limit} links left"]`).then(Boolean));

  // --- Wrong moves: a co-star already in the chain is refused; an off-route link costs a link. ---
  const detour = await degreesDetour(
    ctx.db,
    puzzle.start,
    route.map((l) => l.film.id),
    [puzzle.end.id, ...route.map((l) => l.person.id)],
  );
  report.note(`detour: ${puzzle.start.name} → ${detour.film.title} → ${detour.person.name}`);
  await pickFromSearch(page, `A film with ${puzzle.start.name}`, detour.film.title, {
    primary: detour.film.title,
    secondaryPrefix: detour.film.year === null ? null : String(detour.film.year),
  });
  const castLabel = `Who else is in ${detour.film.title}?`;
  const self = await searchFor(page, castLabel, puzzle.start.name, { primary: puzzle.start.name });
  const selfState = await self.evaluate((li) => ({ disabled: li.getAttribute("aria-disabled"), note: (li.children[1]?.textContent ?? "").trim() }));
  report.check("picking the current actor again is refused with a note", selfState.disabled === "true" && selfState.note.startsWith("Already in your chain"), selfState);
  await self.click();
  report.check("the refused pick sends no move", (await loadPlay(ctx.db, ctx.userId, degrees.id, ctx.date))?.version === 0);

  await playMove(ctx, degrees, 1, () => pickFromSearch(page, castLabel, detour.person.name, { primary: detour.person.name }));
  await waitForText(page, "span", detour.person.name);
  report.check("the off-route link joins the chain", await hasText(page, "span", "Co-star 1"));
  report.check(`countdown drops to ${limit - 1} links left`, await page.$(`[role="img"][aria-label="${limit - 1} links left"]`).then(Boolean));
  await spoilerCheckpoint(ctx, degrees, loaded, "after the off-route link", await secretsFor());
  await checkNoSidewaysScroll(ctx, "mid-play");
  await shot(ctx, "degrees-mid");

  const undone = await playMove(ctx, degrees, 2, () => clickButton(page, { pattern: "Undo last link$" }));
  report.equal("undo removes the link", degreesStateSchema.parse(undone.state).links.length, 0);
  await page.waitForFunction(() => ![...document.querySelectorAll("span")].some((s) => s.textContent === "Co-star 1"));
  report.check(`countdown is back to ${limit} links left`, await page.$(`[role="img"][aria-label="${limit} links left"]`).then(Boolean));

  // --- The optimal route. ---
  let from: PersonRef = puzzle.start;
  let version = 2;
  let row = undone;
  for (const [i, link] of route.entries()) {
    await pickFromSearch(page, `A film with ${from.name}`, link.film.title, {
      primary: link.film.title,
      secondaryPrefix: link.film.year === null ? null : String(link.film.year),
    });
    version += 1;
    row = await playMove(ctx, degrees, version, () => pickFromSearch(page, `Who else is in ${link.film.title}?`, link.person.name, { primary: link.person.name }));
    from = link.person;
    if (i < route.length - 1) await spoilerCheckpoint(ctx, degrees, loaded, `after link ${i + 1}`, await secretsFor());
  }

  report.equal("the play is won", row.status, "won");
  const label = `${route.length} ${route.length === 1 ? "link" : "links"} · par ${puzzle.par}`;
  await checkResultCard(ctx, row, { score: chainScore(route.length, puzzle.par), label, grid: `${"🎞".repeat(route.length)}⭐` });
  await waitForText(page, "h3", `Our route matches yours · par ${puzzle.par}`);
  report.check("the reveal shows the route", true);
  await checkFriendsResults(ctx, row);
  await spoilerCheckpoint(ctx, degrees, loaded, "after finishing");
  await checkNoSidewaysScroll(ctx, "finished");
  await shot(ctx, "degrees-finished");
}

// ---------------------------------------------------------------------------------------------
// Frame by Frame
// ---------------------------------------------------------------------------------------------

async function playFrameByFrame(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, frameByFrame, ctx.date);
  const { puzzle, solution } = loaded;
  const answer = solution.answer;
  const frames = [puzzle.first.id, ...solution.later.map((f) => f.id)];
  const secrets = [answer.title];
  report.note(`today's film: ${answer.title} (${answer.year})${puzzle.fixture ? " (DEV FIXTURE)" : ""}`);
  report.equal("the puzzle has six stored frames", (await assetIdsFor(ctx.db, frameByFrame.id, ctx.date)).size, FRAME_COUNT);

  await openAndStart(ctx, frameByFrame, loaded, secrets);
  report.check("frame 1 is on screen", (await imageSrcs(page)).includes(assetUrl(frames[0])));
  await checkAssetAccess(ctx, "frame 1", { shown: [frames[0]], hidden: frames.slice(1) });
  const signedOut = await assetStatus(ctx, frames[0], false);
  report.equal("signed out, even an earned frame needs sign-in (401)", signedOut.status, 401);
  await spoilerCheckpoint(ctx, frameByFrame, loaded, "on frame 1", secrets);

  // --- A wrong guess: clues, and frame 2. ---
  const [decoy] = await decoyFilms(ctx.db, 1, [answer.id]);
  await playMove(ctx, frameByFrame, 1, () =>
    pickFromSearch(page, "Name the film", decoy.title, { primary: decoy.title, secondaryPrefix: String(decoy.year) }),
  );
  await checkLogRow(ctx, "Your guesses", 0, { kind: "miss", film: decoy, chips: expectedChips(decoy, answer, FRAME_CLUES) });
  await checkLastGuess(ctx, "frame by frame", decoy, answer, FRAME_CLUES);
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(frames[1]));
  report.check("the miss reveals frame 2", true);
  await checkAssetAccess(ctx, "frame 2", { shown: frames.slice(0, 2), hidden: frames.slice(2) });
  await spoilerCheckpoint(ctx, frameByFrame, loaded, "after the wrong guess", secrets);
  await waitForImages(page);
  await checkNoSidewaysScroll(ctx, "mid-play");
  await shot(ctx, "frame-by-frame-mid");

  // --- A skip: frame 3. ---
  await playMove(ctx, frameByFrame, 2, () => clickButton(page, { pattern: "Skip to frame 3$" }));
  await checkLogRow(ctx, "Your guesses", 1, { kind: "skip" });
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(frames[2]));
  await checkAssetAccess(ctx, "frame 3", { shown: [frames[2]], hidden: frames.slice(3) });
  await spoilerCheckpoint(ctx, frameByFrame, loaded, "after the skip", secrets);

  // --- The answer. ---
  const row = await playMove(ctx, frameByFrame, 3, () =>
    pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) }),
  );
  report.equal("the play is won", row.status, "won");
  await checkLogRow(ctx, "Your guesses", 2, { kind: "hit", film: answer });
  await checkResultCard(ctx, row, { score: attemptsScore(3, FRAME_COUNT, true), label: `3/${FRAME_COUNT}`, grid: "🟥⬛🟩⬜⬜⬜" });
  await waitForText(page, "p", "✓ You named it on frame 3");
  report.check("the title card names the film", await hasText(page, "p", answer.title));
  report.equal(
    "the contact sheet shows all six frames",
    await page.$$eval('ol[aria-label="All frames"] > li', (items) => items.length),
    FRAME_COUNT,
  );
  await checkAssetAccess(ctx, "after finishing, every frame", { shown: frames });
  await checkFriendsResults(ctx, row);
  await spoilerCheckpoint(ctx, frameByFrame, loaded, "after finishing");
  await checkFinishedImages(ctx, "finished");
  await checkNoSidewaysScroll(ctx, "finished");
  await shot(ctx, "frame-by-frame-finished");
}

// ---------------------------------------------------------------------------------------------
// Color Grade
// ---------------------------------------------------------------------------------------------

async function playColorGrade(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, colorGrade, ctx.date);
  const { puzzle, solution } = loaded;
  const answer = solution.answer;
  const { neutral, graded, blurred, still } = { neutral: solution.neutral.id, graded: solution.graded.id, blurred: solution.blurred.id, still: solution.still.id };
  const secrets = [answer.title];
  report.note(`today's film: ${answer.title} (${answer.year})${puzzle.fixture ? " (DEV FIXTURE)" : ""}`);

  await openAndStart(ctx, colorGrade, loaded, secrets);
  const swatches = await page.$$eval('ul[aria-label="The film\'s palette, largest share first"] button', (buttons) =>
    buttons.map((b) => b.getAttribute("aria-label") ?? ""),
  );
  report.check(
    "the palette shows the puzzle's five colors",
    swatches.length === puzzle.palette.length && puzzle.palette.every((s, i) => swatches[i]?.includes(s.hex)),
    swatches,
  );
  report.check("no image is on screen at the palette stage", (await imageSrcs(page)).length === 0, await imageSrcs(page));
  await checkAssetAccess(ctx, "palette stage", { hidden: [neutral, graded, blurred, still] });
  await spoilerCheckpoint(ctx, colorGrade, loaded, "at the palette stage", secrets);

  // --- A wrong guess: clues, and the graded photo. ---
  const [decoy] = await decoyFilms(ctx.db, 1, [answer.id]);
  await playMove(ctx, colorGrade, 1, () =>
    pickFromSearch(page, "Name the film", decoy.title, { primary: decoy.title, secondaryPrefix: String(decoy.year) }),
  );
  await checkLogRow(ctx, "Your tries", 0, { kind: "miss", film: decoy, chips: expectedChips(decoy, answer, GRADE_CLUES) });
  await checkLastGuess(ctx, "color grade", decoy, answer, GRADE_CLUES);
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(graded));
  report.check("the miss reveals the graded photo", true);
  await checkAssetAccess(ctx, "graded stage", { shown: [neutral, graded], hidden: [blurred, still] });
  await spoilerCheckpoint(ctx, colorGrade, loaded, "after the wrong guess", secrets);
  await waitForImages(page);
  await checkNoSidewaysScroll(ctx, "mid-play");
  await shot(ctx, "color-grade-mid");

  // --- A skip: the blurred still. ---
  await playMove(ctx, colorGrade, 2, () => clickButton(page, "Skip to the blur"));
  await checkLogRow(ctx, "Your tries", 1, { kind: "skip" });
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(blurred));
  await checkAssetAccess(ctx, "blurred stage", { shown: [blurred], hidden: [still] });
  await spoilerCheckpoint(ctx, colorGrade, loaded, "after the skip", secrets);

  // --- The answer. ---
  const row = await playMove(ctx, colorGrade, 3, () =>
    pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) }),
  );
  report.equal("the play is won", row.status, "won");
  await checkLogRow(ctx, "Your tries", 2, { kind: "hit", film: answer });
  await checkResultCard(ctx, row, { score: attemptsScore(3, MAX_TRIES, true), label: `3/${MAX_TRIES}`, grid: "🟥⬛🟩⬜⬜" });
  await waitForText(page, "h3", answer.title);
  report.check("the verdict names the film", await hasText(page, "p", "✓ You named it on try 3"));
  await checkAssetAccess(ctx, "after finishing, every image", { shown: [neutral, graded, blurred, still] });
  await checkFriendsResults(ctx, row);
  await spoilerCheckpoint(ctx, colorGrade, loaded, "after finishing");
  await checkFinishedImages(ctx, "finished");
  await checkNoSidewaysScroll(ctx, "finished");
  await shot(ctx, "color-grade-finished");
}

// ---------------------------------------------------------------------------------------------
// Color Barcode
// ---------------------------------------------------------------------------------------------

async function playColorBarcode(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, colorBarcode, ctx.date);
  const { puzzle, solution } = loaded;
  const answer = solution.answer;
  const levels = solution.levels.map((l) => l.id);
  const secrets = [answer.title];
  report.note(`today's film: ${answer.title} (${answer.year})${puzzle.fixture ? " (DEV FIXTURE)" : ""}`);
  report.equal(`the puzzle has ${LEVEL_COUNT} stored levels`, (await assetIdsFor(ctx.db, colorBarcode.id, ctx.date)).size, LEVEL_COUNT);
  report.equal("level 1 is the puzzle's only image", puzzle.first.id, levels[0]);

  await openAndStart(ctx, colorBarcode, loaded, secrets);
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(levels[0]!));
  report.check("level 1 is on screen", true);
  await checkAssetAccess(ctx, "level 1", { shown: [levels[0]!], hidden: levels.slice(1) });
  await spoilerCheckpoint(ctx, colorBarcode, loaded, "on level 1", secrets);

  // --- A wrong guess: no clues of any kind, and level 2 replaces level 1. ---
  const [decoy] = await decoyFilms(ctx.db, 1, [answer.id]);
  const missed = await playMove(ctx, colorBarcode, 1, () =>
    pickFromSearch(page, "Name the film", decoy.title, { primary: decoy.title, secondaryPrefix: String(decoy.year) }),
  );
  await checkLogRow(ctx, "Your guesses", 0, { kind: "miss", film: decoy, chips: [] });
  await checkLastGuess(ctx, "color barcode", decoy, answer, []);
  report.equal("no clue chips anywhere on the board", await page.$$eval('ul[aria-label^="Clues"]', (lists) => lists.length), 0);
  // Deep equality: the stored state is jsonb, which doesn't keep key order.
  const storedTurns = (missed.state as { turns: unknown[] }).turns;
  report.check(
    "the stored miss is just the film and the verdict",
    isDeepStrictEqual(storedTurns, [{ film: { id: decoy.id, title: decoy.title, year: decoy.year }, correct: false }]),
    storedTurns,
  );
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(levels[1]!));
  report.check("the miss reveals level 2", true);
  await checkAssetAccess(ctx, "level 2", { shown: levels.slice(0, 2), hidden: levels.slice(2) });
  await spoilerCheckpoint(ctx, colorBarcode, loaded, "after the wrong guess", secrets);
  await waitForImages(page);
  await checkNoSidewaysScroll(ctx, "mid-play");
  await shot(ctx, "color-barcode-mid");

  // --- A skip: level 3. ---
  await playMove(ctx, colorBarcode, 2, () => clickButton(page, { pattern: "Skip to level 3$" }));
  await checkLogRow(ctx, "Your guesses", 1, { kind: "skip" });
  await page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(levels[2]!));
  // Levels 1 and 2 stay viewable for looking back.
  await checkAssetAccess(ctx, "level 3", { shown: levels.slice(0, 3), hidden: levels.slice(3) });
  await spoilerCheckpoint(ctx, colorBarcode, loaded, "after the skip", secrets);

  // --- The answer. ---
  const row = await playMove(ctx, colorBarcode, 3, () =>
    pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) }),
  );
  report.equal("the play is won", row.status, "won");
  await checkLogRow(ctx, "Your guesses", 2, { kind: "hit", film: answer });
  await checkResultCard(ctx, row, { score: attemptsScore(3, BARCODE_GUESSES, true), label: `3/${BARCODE_GUESSES}`, grid: "🟥⬛🟩" });
  await waitForText(page, "h3", answer.title);
  report.check("the reveal names the film", await hasText(page, "p", "✓ You named it on level 3"));
  report.equal(
    "every level can be viewed after finishing",
    await page.$$eval('ol[aria-label="Levels"] > li', (items) => items.length),
    LEVEL_COUNT,
  );
  await checkAssetAccess(ctx, "after finishing, every level", { shown: levels });
  await checkFriendsResults(ctx, row);
  await spoilerCheckpoint(ctx, colorBarcode, loaded, "after finishing");
  await checkFinishedImages(ctx, "finished");
  await checkNoSidewaysScroll(ctx, "finished");
  await shot(ctx, "color-barcode-finished");
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

async function checkToday(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  await page.goto(`${ctx.baseUrl}/`, { waitUntil: "networkidle0" });
  const movies = await page.evaluate(() => {
    const heading = document.getElementById("bucket-movies");
    const section = heading?.closest("section");
    return {
      heading: (heading?.textContent ?? "").trim(),
      cards: [...(section?.querySelectorAll<HTMLAnchorElement>('a[href^="/play/"]') ?? [])].map((a) => ({
        href: a.getAttribute("href"),
        text: (a.textContent ?? "").replace(/\s+/g, " "),
      })),
    };
  });
  report.equal("Today has a Movies bucket", movies.heading, "Movies");
  for (const game of MOVIES_GAMES) {
    const card = movies.cards.find((c) => c.href === `/play/${game.id}`);
    report.check(`Movies lists ${game.name}`, card !== undefined && card.text.includes(game.name), movies.cards);
    report.check(`${game.name} is marked Testing and ready to play`, card !== undefined && card.text.includes("Testing") && card.text.includes("Play"), card?.text);
  }
  report.equal("Movies holds exactly the four Movies games", movies.cards.length, MOVIES_GAMES.length);
  await checkNoSidewaysScroll(ctx, "Today");
  await shot(ctx, "today");
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

async function main(): Promise<boolean> {
  const env = e2eEnv();
  const report = new Report();
  const db = e2eDb(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const date = today();
  const shotsDir = path.resolve(env.E2E_SHOTS_DIR);
  mkdirSync(shotsDir, { recursive: true });

  report.section("setup");
  const profile = await profileByUsername(db, env.E2E_TEST_USERNAME);
  if (!report.check(`${profile.username} is an admin (Movies games are still in testing)`, profile.is_admin)) return false;
  for (const game of MOVIES_GAMES) await loadPuzzle(db, game, date);
  report.check(`today (${date}) has a puzzle for all four Movies games`, true);
  const removed = await resetPlays(db, profile.id, MOVIES_GAMES.map((g) => g.id), date);
  report.note(`reset ${removed} earlier play${removed === 1 ? "" : "s"} of today's Movies puzzles`);
  const health = await fetch(`${env.E2E_BASE_URL}/login`).catch((error: unknown) => error);
  if (!report.check(`the dev server answers at ${env.E2E_BASE_URL}`, health instanceof Response && health.ok, health instanceof Error ? health.message : undefined)) {
    return false;
  }

  const browser = await launchChrome(env.E2E_CHROME_PATH);
  try {
    const page = await newPhonePage(browser);
    const errors = collectPageErrors(page);
    const watch = new SpoilerWatch(page, env.E2E_BASE_URL);
    await signIn(page, env.E2E_BASE_URL, env.E2E_TEST_USERNAME, env.E2E_TEST_PASSWORD);
    report.check("signed in as the test account", true);

    const ctx: Ctx = { page, browser, db, report, watch, baseUrl: env.E2E_BASE_URL, shotsDir, userId: profile.id, username: profile.username, displayName: profile.display_name, date };
    await report.runSection("Today", () => checkToday(ctx));
    await report.runSection("Degrees of Separation", () => playDegrees(ctx));
    await report.runSection("Frame by Frame", () => playFrameByFrame(ctx));
    await report.runSection("Color Grade", () => playColorGrade(ctx));
    await report.runSection("Color Barcode", () => playColorBarcode(ctx));

    report.section("browser health");
    report.check("no console errors or uncaught page errors", errors.length === 0, errors);
    const unreadable = watch.takeUnreadable();
    report.check("every response body could be checked for spoilers", unreadable.length === 0, unreadable);
  } finally {
    await browser.close();
  }

  console.log(report.summary());
  return !report.failed;
}

main().then(
  (passed) => process.exit(passed ? 0 : 1),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
