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
import { fadeToColor, LAST_REEL_SCORE, LEVEL_COUNT, MAX_GUESSES as BARCODE_GUESSES, OPTION_COUNT, pickWorth } from "@/games/fade-to-color/logic";
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
  WAIT_MS,
} from "./lib/browser.mjs";
import { assetIdsFor, decoyFilms, degreesDetour, e2eDb, loadPlay, loadPuzzle, profileByUsername, resetAssetBurst, resetPlays, waitForPlayVersion, type E2eDb } from "./lib/db.mjs";
import { e2eEnv } from "./lib/env.mjs";
import { Report } from "./lib/report.mjs";
import { SpoilerWatch } from "./lib/spoilers.mjs";

const MOVIES_GAMES: readonly AnyGame[] = [degrees, frameByFrame, fadeToColor];

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
// Fade to Color
// ---------------------------------------------------------------------------------------------

/** Fade to Color is full screen: its own start ("Roll film"), status line, end card and friends panel. */
async function playFadeToColor(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const { puzzle, solution } = loaded;
  const answer = solution.answer;
  const levels = solution.levels.map((l) => l.id);
  const secrets = [answer.title];
  report.note(`today's film: ${answer.title} (${answer.year})${puzzle.fixture ? " (DEV FIXTURE)" : ""}`);
  report.equal(`the puzzle has ${LEVEL_COUNT} stored levels`, (await assetIdsFor(ctx.db, fadeToColor.id, ctx.date)).size, LEVEL_COUNT);
  report.equal("level 1 is the puzzle's only image", puzzle.first.id, levels[0]);

  const onScreen = (id: string) =>
    page.waitForFunction((src) => [...document.images].some((img) => img.getAttribute("src") === src), {}, assetUrl(id));
  const status = () => fadeStatus(page);

  // --- Before the film: no app chrome, the leader, three rules and "Roll film". ---
  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(`h1[aria-label="${fadeToColor.name}"]`);
  report.equal("full screen: no app nav", await page.$$eval("nav", (navs) => navs.length), 0);
  report.check("the rules are on the opening screen", await pageSays(page, fadeToColor.rules[0]!));
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "before starting", secrets);
  await clickButton(page, "Roll film");
  const started = await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  report.equal("the play starts in progress", started.status, "in_progress");
  await onScreen(levels[0]!);
  report.check("level 1 is on screen", true);
  await page.waitForFunction(() => (document.querySelector("main p")?.textContent ?? "").includes("Reel 1 of 10"));
  report.check("the status line shows the reel and what's left", (await status()).startsWith(`Reel 1 of ${BARCODE_GUESSES} · ${BARCODE_GUESSES} left`), await status());
  await checkAssetAccess(ctx, "level 1", { shown: [levels[0]!], hidden: levels.slice(1) });
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "on level 1", secrets);

  // --- A wrong guess: choose a film, then Guess. No clues of any kind; level 2 unreels. ---
  const [decoy] = await decoyFilms(ctx.db, 1, [answer.id]);
  const missed = await playMove(ctx, fadeToColor, 1, async () => {
    await pickFromSearch(page, "Name the film", decoy.title, { primary: decoy.title, secondaryPrefix: String(decoy.year) });
    await clickButton(page, "Guess");
  });
  // Deep equality: the stored state is jsonb, which doesn't keep key order.
  const storedTurns = (missed.state as { turns: unknown[] }).turns;
  report.check(
    "the stored miss is just the film and the verdict",
    isDeepStrictEqual(storedTurns, [{ film: { id: decoy.id, title: decoy.title, year: decoy.year }, correct: false }]),
    storedTurns,
  );
  await onScreen(levels[1]!);
  report.check("the miss unreels level 2", true);
  await waitForText(page, "p", `Not ${decoy.title}`);
  report.check("the miss is named for a moment, and nothing else", true);
  report.equal("no clue chips anywhere", await page.$$eval('ul[aria-label^="Clues"]', (lists) => lists.length), 0);
  report.check("reel 2, nine left", (await status()).startsWith(`Reel 2 of ${BARCODE_GUESSES} · ${BARCODE_GUESSES - 1} left`), await status());
  await checkAssetAccess(ctx, "level 2", { shown: levels.slice(0, 2), hidden: levels.slice(2) });
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the wrong guess", secrets);
  await checkNoSidewaysScroll(ctx, "mid-play");
  await shot(ctx, "fade-to-color-mid");

  // --- A skip: level 3; earlier reels stay viewable from the contact strip. ---
  await playMove(ctx, fadeToColor, 2, () => clickButton(page, "Skip"));
  await onScreen(levels[2]!);
  report.equal(
    "three reels can be looked back at, seven are still unexposed",
    await page.$$eval('ol[aria-label="Reels"] button', (bs) => bs.map((b) => (b as HTMLButtonElement).disabled).join(",")),
    [false, false, false, true, true, true, true, true, true, true].join(","),
  );
  await checkAssetAccess(ctx, "level 3", { shown: levels.slice(0, 3), hidden: levels.slice(3) });
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the skip", secrets);

  // --- The answer: the film unreels to its last level and the end card names it. ---
  const row = await playMove(ctx, fadeToColor, 3, async () => {
    await pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) });
    await clickButton(page, "Guess");
  });
  report.equal("the play is won", row.status, "won");
  report.equal("stored score is as expected (100, 90, 80 … by reel)", row.score, attemptsScore(3, BARCODE_GUESSES, true, LAST_REEL_SCORE));
  report.equal("stored share grid is as expected", row.share_grid, "🟥⬛🟩");
  // Named live: the film says its name back (the title matte) before it rolls on to the end card.
  report.check("the film says its name back: a title card over the reel", await titleCardSays(page, answer.title));
  await waitForText(page, "h2", answer.title);
  // The end card comes up (and takes clicks) once the reel has unreeled to the film's last level.
  await page.waitForFunction(() => {
    const card = document.querySelector('section[aria-label="Today\'s film"]');
    return card !== null && card.closest("[inert]") === null;
  });
  report.check("the end card names the film", true);
  report.check("…and how it went", await hasText(page, "p", "Named on reel 3"));
  report.check("…with the score", await page.evaluate((want) => document.body.textContent!.replace(/\s+/g, " ").includes(want), `3/${BARCODE_GUESSES} · ${row.score} pts`));
  report.check("…and a Share button", await hasText(page, "button", "Share"));
  await onScreen(levels[LEVEL_COUNT - 1]!);
  report.check("the reel shows the film's last level", true);
  report.equal(
    "every level can be viewed after finishing",
    await page.$$eval('ol[aria-label="Reels"] button:not(:disabled)', (bs) => bs.length),
    LEVEL_COUNT,
  );
  await lookBackAt(page, 1, levels[0]!);
  report.check("looking back at reel 1 after the win: the title card stays gone", await page.evaluate(() => document.querySelector('[data-win="matte"], [class*="__titleCard"]') === null));
  report.check("…and the end card stays up", await endCardLive(page));
  await lookBackAt(page, LEVEL_COUNT, levels[LEVEL_COUNT - 1]!);
  await checkAssetAccess(ctx, "after finishing, every level", { shown: levels });

  // --- Everyone's results, in a panel. ---
  await clickButton(page, "How everyone did");
  await page.waitForSelector('[role="dialog"][aria-label="How everyone did"] li');
  const mine = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('[role="dialog"] li')];
    const own = rows.find((r) => r.querySelector("b")?.textContent?.trim() === name);
    return { rows: rows.length, text: own ? (own.textContent ?? "").replace(/\s+/g, " ") : null };
  }, ctx.displayName);
  report.check("friends' results list players", mine.rows > 0, mine);
  report.check("friends' results show @username and my label", mine.text !== null && mine.text.includes(`@${ctx.username}`) && mine.text.includes(row.result_label ?? "\0"), mine.text);
  await shot(ctx, "fade-to-color-friends");
  await page.keyboard.press("Escape");

  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after finishing");
  await checkFinishedImages(ctx, "finished");
  await checkNoSidewaysScroll(ctx, "finished");
  await shot(ctx, "fade-to-color-finished");
}

/** The win's title card (over the reel, for looking at only) shows `title`, within a few seconds. */
async function titleCardSays(page: Page, title: string): Promise<boolean> {
  return page
    .waitForFunction((want) => document.querySelector('[data-win="lit"]')?.textContent === want, { timeout: 4000 }, title)
    .then(() => true)
    .catch(() => false);
}

/**
 * Naming the film plays the title matte once, live: a tap skips straight to the end card, and that
 * tap goes no further (it can't press what's under it). A reload shows the end card at once.
 */
async function playFadeToColorWinSkipped(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const answer = loaded.solution.answer;
  await resetPlays(ctx.db, ctx.userId, [fadeToColor.id], ctx.date);

  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await clickButton(page, "Roll film");
  await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  await fourControlReady(page);
  const row = await playMove(ctx, fadeToColor, 1, async () => {
    await pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) });
    await clickButton(page, "Guess");
  });
  report.equal("named on reel 1", row.result_label, `1/${BARCODE_GUESSES}`);
  report.check("the title card comes up with the film's name", await titleCardSays(page, answer.title));
  report.check("…while the end card is still to come", await page.evaluate(() => document.querySelector('section[aria-label="Today\'s film"]') === null));

  // Count clicks that get past the skip (a listener below the window, where the skip stops them).
  await page.evaluate(() => {
    (window as unknown as { leaked: number }).leaked = 0;
    document.addEventListener("click", () => (window as unknown as { leaked: number }).leaked++);
  });
  const view = page.viewport()!;
  await page.mouse.click(view.width / 2, view.height * 0.8);
  await page.waitForFunction(
    () => {
      const card = document.querySelector('section[aria-label="Today\'s film"]');
      return card !== null && card.closest("[inert]") === null;
    },
    { timeout: 1000 },
  );
  report.check("a tap skips straight to the end card", true);
  report.equal("…and goes no further", await page.evaluate(() => (window as unknown as { leaked: number }).leaked), 0);
  report.check("…the title card is gone", await page.evaluate(() => document.querySelector('[data-win="lit"]') === null));
  report.check("…and nothing opened", await page.evaluate(() => document.querySelector('[role="dialog"]') === null));
  report.check("the end card names it on reel 1", await hasText(page, "p", "Named on reel 1"));

  await page.reload({ waitUntil: "networkidle0" });
  await waitForCredits(page);
  report.check("after a reload the end card is simply there: the win plays only live", await page.evaluate(() => document.querySelector("[data-win]") === null));
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the win");
  await shot(ctx, "fade-to-color-win-skipped");
}

/**
 * A key press skips the win too, and the player's next click is theirs: "How everyone did", pressed
 * at once, opens the panel over the whole room (not inside the end card, still rising).
 */
async function playFadeToColorWinKeySkipped(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const answer = loaded.solution.answer;
  await resetPlays(ctx.db, ctx.userId, [fadeToColor.id], ctx.date);

  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await clickButton(page, "Roll film");
  await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  await fourControlReady(page);
  await playMove(ctx, fadeToColor, 1, async () => {
    await pickFromSearch(page, "Name the film", answer.title, { primary: answer.title, secondaryPrefix: answer.year === null ? null : String(answer.year) });
    await clickButton(page, "Guess");
  });
  report.check("the title card comes up with the film's name", await titleCardSays(page, answer.title));
  await page.keyboard.press("a");
  await page.waitForFunction(
    () => {
      const card = document.querySelector('section[aria-label="Today\'s film"]');
      return card !== null && card.closest("[inert]") === null;
    },
    { timeout: 1000 },
  );
  report.check("a key press skips straight to the end card", true);
  await clickButton(page, "How everyone did");
  const opened = await page
    .waitForSelector('[role="dialog"][aria-label="How everyone did"]', { timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  report.check("…and the next click is the player's: everyone's results open at once", opened);
  const cover = await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"]')?.parentElement?.getBoundingClientRect();
    return box ? { box: [box.left, box.top, box.width, box.height], view: [0, 0, innerWidth, innerHeight] } : null;
  });
  report.check("…over the whole room", cover !== null && isDeepStrictEqual(cover.box, cover.view), cover);
  await page.keyboard.press("Escape");
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the win, skipped with a key");
}

/** Looks back at reel `reel` (1-based) from the contact strip; waits until its picture (`id`) is on screen and still. */
async function lookBackAt(page: Page, reel: number, id: string): Promise<void> {
  await page.click(`ol[aria-label="Reels"] li:nth-child(${reel}) button`);
  await page.waitForFunction(
    (src) => {
      const img = document.querySelector<HTMLImageElement>('[class*="__screen"] > img');
      return img !== null && img.getAttribute("src") === src && img.getAnimations().length === 0;
    },
    { timeout: WAIT_MS },
    assetUrl(id),
  );
}

/** The end card is up (or still rising) and takes clicks. */
function endCardLive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const card = document.querySelector('section[aria-label="Today\'s film"]');
    return card !== null && card.closest("[inert]") === null && card.parentElement!.hasAttribute("data-show");
  });
}

/** The status line under the contact strip ("Reel 4 of 10 · 7 left", "Reel 4 of 10 · stopped"). */
function fadeStatus(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector("main p")?.textContent ?? "").replace(/\s+/g, " ").trim());
}

/** The quiet control at the left of the guess line: the stake for stopping the film on this reel. */
const FOUR_CONTROL = /^(The four|Take the four)/;

/** Waits until the four's control is ready (the reel has settled, nothing is in flight); returns its spoken label. */
async function fourControlReady(page: Page): Promise<string> {
  const handle = await page.waitForFunction(
    (pattern) => {
      const button = [...document.querySelectorAll("button")].find((b) => new RegExp(pattern).test(b.getAttribute("aria-label") ?? ""));
      return button && !button.disabled ? button.getAttribute("aria-label") : false;
    },
    { timeout: WAIT_MS },
    FOUR_CONTROL.source,
  );
  return (await handle.jsonValue()) as string;
}

async function openFourConfirm(page: Page): Promise<void> {
  await fourControlReady(page);
  await page.evaluate((pattern) => {
    const button = [...document.querySelectorAll("button")].find((b) => new RegExp(pattern).test(b.getAttribute("aria-label") ?? ""));
    button!.click();
  }, FOUR_CONTROL.source);
}

/** The four as tiles: film id, whether it can be chosen, and its edge print (the year, or the reel it was guessed on). */
async function fourTiles(page: Page): Promise<{ id: number; disabled: boolean; meta: string }[]> {
  await page.waitForSelector('[role="radiogroup"] [role="radio"]');
  return page.$$eval('[role="radiogroup"] [role="radio"]', (tiles) =>
    tiles.map((tile) => ({
      id: Number((tile as HTMLElement).dataset.film),
      disabled: (tile as HTMLButtonElement).disabled,
      meta: (tile.lastElementChild?.textContent ?? "").trim(),
    })),
  );
}

/** The edge print along the reel's top rail says `text`. */
function edgeSays(page: Page, text: string): Promise<boolean> {
  return page.evaluate((want) => [...document.querySelectorAll('[class*="__edge"]')].some((el) => el.textContent?.trim() === want), text);
}

/** Waits for the end card to come up (and take clicks) once the reel has unreeled to the film's last level. */
async function waitForCredits(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const card = document.querySelector('section[aria-label="Today\'s film"]');
      return card !== null && card.closest("[inert]") === null;
    },
    { timeout: WAIT_MS },
  );
}

/** The end card's title is in the film's colors (the barcode) rather than plain ink. */
function endTitleLit(page: Page, title: string): Promise<boolean | null> {
  return page.evaluate((want) => {
    const h2 = [...document.querySelectorAll('section[aria-label="Today\'s film"] h2')].find((h) => h.textContent === want);
    return h2 ? h2.hasAttribute("data-lit") : null;
  }, title);
}

/** The result frames on the end card read as `label` to a screen reader. */
function framesSay(page: Page, label: string): Promise<boolean> {
  return page.evaluate((want) => document.querySelector(`section[aria-label="Today's film"] [role="img"][aria-label="${want}"]`) !== null, label);
}

/** The page's text (as written, before any CSS casing) contains `text`. */
function pageTextHas(page: Page, text: string): Promise<boolean> {
  return page.evaluate((want) => document.body.textContent!.replace(/\s+/g, " ").includes(want), text);
}

/**
 * The friends panel's "The four", read with each card's words for screen readers ("The film.",
 * "Picked by you."), plus its tally line. Opens the panel and leaves it open.
 */
async function everyonesFour(page: Page): Promise<{ tally: string; cards: string[] }> {
  await clickButton(page, "How everyone did");
  await page.waitForSelector('[role="dialog"] section[aria-labelledby="everyone-four"] li');
  // (No named helpers inside: the page can't see the bundler's `__name`.)
  return page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')!;
    return {
      tally: (panel.querySelector(":scope > p")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      cards: [...panel.querySelectorAll('section[aria-labelledby="everyone-four"] li')].map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim()),
    };
  });
}

/**
 * Stop the film on reel 1 and pick right: half of naming it there. On the way, backing out of the
 * confirm sends nothing, and the four's titles stay secret until the stop.
 */
async function playFadeToColorStopRight(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const { solution } = loaded;
  const answer = solution.answer;
  const fourTitles = solution.options.map((o) => o.title);
  const worth = pickWorth(1);
  await resetPlays(ctx.db, ctx.userId, [fadeToColor.id], ctx.date);

  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await clickButton(page, "Roll film");
  await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  const label = await fourControlReady(page);
  report.equal(`the four's control carries the stake for reel 1 (${worth})`, label, `The four: stop the film here, one pick worth ${worth}`);
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "on reel 1, before the stop", fourTitles);

  // --- The confirm, and backing out of it: nothing is sent, nothing leaks. ---
  await openFourConfirm(page);
  await waitForText(page, "p", `Stop the film on reel 1? Four titles, one pick, worth ${worth}. The rest stays in the can.`);
  report.check("the control asks first", true);
  await clickButton(page, "Keep watching");
  await page.waitForSelector('input[role="combobox"]');
  report.equal("Keep watching sends nothing", (await loadPlay(ctx.db, ctx.userId, fadeToColor.id, ctx.date))?.version, 0);
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after backing out of the stop", fourTitles);

  // --- The stop: the four come up, the rest stays in the can. ---
  await openFourConfirm(page);
  const stopped = await playMove(ctx, fadeToColor, 1, () => clickButton(page, "Stop the film"));
  const state = stopped.state as { turns: unknown[]; options: { id: number }[] };
  report.equal("the stop uses no attempt", state.turns.length, 0);
  report.check("…and brings up the four, in their stored order", isDeepStrictEqual(state.options, solution.options), state.options);
  const tiles = await fourTiles(page);
  report.check(`the ${OPTION_COUNT} are on screen in that order`, isDeepStrictEqual(tiles.map((t) => t.id), solution.options.map((o) => o.id)), tiles);
  report.check("…and any of them can be chosen", tiles.every((t) => !t.disabled), tiles);
  report.check("one pick, worth half of naming it", await hasText(page, "p", `One pick · ${worth} pts`));
  await page.waitForFunction(() => (document.querySelector("main p")?.textContent ?? "").includes("stopped"));
  report.check("the status line says the film is stopped", (await fadeStatus(page)).startsWith(`Reel 1 of ${BARCODE_GUESSES} · stopped`), await fadeStatus(page));
  report.check("the edge print holds the reel", await edgeSays(page, "Reel 01 ◂ Held"));
  report.equal(
    "the reels never seen are left in the can",
    await page.$$eval('ol[aria-label="Reels"] button', (bs) => bs.filter((b) => (b.getAttribute("aria-label") ?? "").endsWith("left in the can")).length),
    LEVEL_COUNT - 1,
  );
  report.check("Pick waits for a choice", await page.$$eval("button", (bs) => bs.some((b) => b.textContent?.trim() === "Pick" && (b as HTMLButtonElement).disabled)));
  // The four's titles are on screen now (the answer among them); the unseen reels are still secret.
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "with the four up");
  await checkNoSidewaysScroll(ctx, "the four up");
  await shot(ctx, "fade-to-color-four");

  // --- The pick: right, for half of reel 1. ---
  const row = await playMove(ctx, fadeToColor, 2, async () => {
    await page.click(`[role="radio"][data-film="${answer.id}"]`);
    await clickButton(page, "Pick");
  });
  report.equal("picking the answer wins", row.status, "won");
  report.equal(`…for ${worth} points`, row.score, worth);
  report.equal("…labelled by the reel it was stopped on", row.result_label, `Pick 1/${BARCODE_GUESSES}`);
  report.equal("…with a single circle for a share grid", row.share_grid, "🟡");
  await waitForCredits(page);
  report.check("the end card says it was picked by color alone", await hasText(page, "p", "Picked by color alone"));
  report.equal("…titles the film in its own colors", await endTitleLit(page, answer.title), true);
  report.check("…marks the pick inside the first frame", await framesSay(page, "Stopped on reel 1 and picked it"));
  report.check("…with the score", await pageTextHas(page, `Pick 1/${BARCODE_GUESSES} · ${worth} pts`));
  report.equal("focus moves to the end card", await page.evaluate(() => document.activeElement?.textContent?.trim()), "Share");
  await lookBackAt(page, 1, solution.levels[0]!.id);
  report.check("looking back at reel 1 after the pick: the room stays lit", await page.evaluate(() => document.querySelector("[data-dip]") === null));
  report.check("…and the end card stays up", await endCardLive(page));
  await lookBackAt(page, LEVEL_COUNT, solution.levels[LEVEL_COUNT - 1]!.id);
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the pick");
  await checkNoSidewaysScroll(ctx, "stopped and picked");
  await shot(ctx, "fade-to-color-stop-right");

  // --- Everyone's picks, in the friends panel. ---
  const everyone = await everyonesFour(page);
  report.check("the friends panel tallies the picks", /\d+ picked it/.test(everyone.tally), everyone.tally);
  report.check(
    "…and shows the four in their shared order",
    everyone.cards.length === OPTION_COUNT && everyone.cards.every((card, i) => card.startsWith(fourTitles[i]!)),
    everyone.cards,
  );
  const answerCard = everyone.cards[solution.options.findIndex((o) => o.id === answer.id)] ?? "";
  report.check("…with my pick under the film", answerCard.includes("The film.") && /Picked by .*\byou\b/.test(answerCard), answerCard);
  await shot(ctx, "fade-to-color-everyone");
  await page.keyboard.press("Escape");
}

/**
 * Guess one of the look-alikes on reel 1, stop on reel 2 and pick another: the guessed one is dark
 * and can't be chosen, and the wrong pick loses, with the film's title in ink.
 */
async function playFadeToColorStopWrong(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const { solution } = loaded;
  const answer = solution.answer;
  const [guessed, picked] = solution.options.filter((o) => o.id !== answer.id);
  const worth = pickWorth(2);
  await resetPlays(ctx.db, ctx.userId, [fadeToColor.id], ctx.date);

  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await clickButton(page, "Roll film");
  await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  await fourControlReady(page);
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "on reel 1, before guessing", solution.options.map((o) => o.title));

  await playMove(ctx, fadeToColor, 1, async () => {
    await pickFromSearch(page, "Name the film", guessed!.title, { primary: guessed!.title, secondaryPrefix: guessed!.year === null ? null : String(guessed!.year) });
    await clickButton(page, "Guess");
  });
  report.equal(`on reel 2 the stake is ${worth}`, await fourControlReady(page), `The four: stop the film here, one pick worth ${worth}`);
  await openFourConfirm(page);
  await waitForText(page, "p", `Stop the film on reel 2? Four titles, one pick, worth ${worth}. The rest stays in the can.`);
  await playMove(ctx, fadeToColor, 2, () => clickButton(page, "Stop the film"));
  const tiles = await fourTiles(page);
  const dark = tiles.find((t) => t.id === guessed!.id);
  report.check("the look-alike already guessed arrives dark, with the reel it was guessed on", dark?.disabled === true && dark.meta === "Guessed · reel 1", dark);
  report.check("…and the other three can be chosen", tiles.filter((t) => t.id !== guessed!.id).every((t) => !t.disabled), tiles);
  const focused = await page
    .waitForFunction(() => document.activeElement?.getAttribute("role") === "radio", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  report.check("once the four are up, focus is on them", focused);
  await page.keyboard.press("ArrowRight");
  report.check(
    "…so the arrow keys choose among them, and the reel stays put",
    (await page.evaluate(() => document.querySelector('[role="radio"][aria-checked="true"]') !== null)) && (await edgeSays(page, "Reel 02 ◂ Held")),
  );
  report.check("one pick, worth half of naming it on reel 2", await hasText(page, "p", `One pick · ${worth} pts`));

  const row = await playMove(ctx, fadeToColor, 3, async () => {
    await page.click(`[role="radio"][data-film="${picked!.id}"]`);
    await clickButton(page, "Pick");
  });
  report.equal("a wrong pick loses", row.status, "lost");
  report.equal("…for nothing", row.score, 0);
  report.equal("…labelled as a loss", row.result_label, `X/${BARCODE_GUESSES}`);
  report.equal("…with the miss, then a dark circle", row.share_grid, "🟥⚫");
  await waitForText(page, "h2", answer.title);
  await waitForCredits(page);
  report.check("the end card says where the film was stopped", await hasText(page, "p", "Stopped on reel 2 · the film was"));
  report.equal("…and titles it in ink, not color", await endTitleLit(page, answer.title), false);
  report.check("…marks the wrong pick inside the second frame", await framesSay(page, "Stopped on reel 2, wrong pick"));
  report.check("…with the score", await pageTextHas(page, `X/${BARCODE_GUESSES} · 0 pts`));
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the wrong pick");
  await checkNoSidewaysScroll(ctx, "wrong pick, finished");
  await shot(ctx, "fade-to-color-stop-wrong");

  // --- Everyone's picks: mine under the film I picked, never under the one I typed. ---
  const everyone = await everyonesFour(page);
  const card = (film: { id: number }) => everyone.cards[solution.options.findIndex((o) => o.id === film.id)] ?? "";
  const mine = (text: string) => /Picked by .*\byou\b/.test(text);
  report.check("the friends panel puts my pick under the film I picked", mine(card(picked!)), everyone.cards);
  report.check("…and never lists the film I typed as mine", !mine(card(guessed!)), everyone.cards);
  report.check("…and counts my wrong pick as one that didn't", /\d+ didn't/.test(everyone.tally), everyone.tally);
  await page.keyboard.press("Escape");
}

/** Nine skips and a wrong guess on the last reel: the four come up anyway (the run-out), worth 5. */
async function playFadeToColorRunOut(ctx: Ctx): Promise<void> {
  const { page, report } = ctx;
  const loaded = await loadPuzzle(ctx.db, fadeToColor, ctx.date);
  const { solution } = loaded;
  const answer = solution.answer;
  const secrets = [answer.title, ...solution.options.map((o) => o.title)];
  const worth = pickWorth(LEVEL_COUNT);
  await resetPlays(ctx.db, ctx.userId, [fadeToColor.id], ctx.date);

  await page.goto(`${ctx.baseUrl}/play/${fadeToColor.id}`, { waitUntil: "networkidle0" });
  await clickButton(page, "Roll film");
  await waitForPlayVersion(ctx.db, { userId: ctx.userId, gameId: fadeToColor.id, date: ctx.date, version: 0 });
  for (let reel = 1; reel < BARCODE_GUESSES; reel++) {
    await playMove(ctx, fadeToColor, reel, () => clickButton(page, "Skip"));
  }
  report.check("nine skips leave the last reel", await pageSays(page, `Reel ${BARCODE_GUESSES} of ${BARCODE_GUESSES}`));
  report.equal("…where the four are worth 5", await fourControlReady(page), `Take the four: one pick, worth ${worth}`);
  report.check("…and there's no Skip and no Give up", !(await hasText(page, "button", "Skip")) && !(await hasText(page, "button", "Give up")));
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "on reel 10, before the run-out", secrets);

  const [decoy] = await decoyFilms(ctx.db, 1, solution.options.map((o) => o.id));
  const missed = await playMove(ctx, fadeToColor, BARCODE_GUESSES, async () => {
    await pickFromSearch(page, "Name the film", decoy.title, { primary: decoy.title, secondaryPrefix: String(decoy.year) });
    await clickButton(page, "Guess");
  });
  report.equal("a wrong guess on reel 10 keeps the play going", missed.status, "in_progress");
  const tiles = await fourTiles(page);
  report.check(`…and brings up the ${OPTION_COUNT}, in their stored order`, isDeepStrictEqual(tiles.map((t) => t.id), solution.options.map((o) => o.id)), tiles);
  report.check("the status line says the reels ran out", (await fadeStatus(page)).startsWith(`Reel ${BARCODE_GUESSES} of ${BARCODE_GUESSES} · run-out`), await fadeStatus(page));
  report.check("…and so does the edge print", await edgeSays(page, "Reel 10 ◂ Run-out"));
  report.check("one pick, worth 5", await hasText(page, "p", `One pick · ${worth} pts`));
  report.check("Pick waits for a choice", await page.$$eval("button", (bs) => bs.some((b) => b.textContent?.trim() === "Pick" && (b as HTMLButtonElement).disabled)));

  const row = await playMove(ctx, fadeToColor, BARCODE_GUESSES + 1, async () => {
    await page.click(`[role="radio"][data-film="${answer.id}"]`);
    await clickButton(page, "Pick");
  });
  report.equal("picking the answer wins", row.status, "won");
  report.equal(`…for ${worth} points`, row.score, worth);
  report.equal("…labelled as a pick on the last reel", row.result_label, `Pick ${BARCODE_GUESSES}/${BARCODE_GUESSES}`);
  report.equal("…with ten reel marks and the pick's circle", row.share_grid, `${"⬛".repeat(BARCODE_GUESSES - 1)}🟥🟡`);
  await waitForText(page, "h2", answer.title);
  await waitForCredits(page);
  report.check("the end card says it was picked after the last reel", await hasText(page, "p", "Picked after the last reel"));
  report.check("…with the pick's mark set apart after the tenth frame", await framesSay(page, "Picked after the last reel"));
  await spoilerCheckpoint(ctx, fadeToColor, loaded, "after the run-out pick");
  await checkNoSidewaysScroll(ctx, "run-out, finished");
  await shot(ctx, "fade-to-color-run-out");
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
  report.equal("Movies holds exactly the three Movies games", movies.cards.length, MOVIES_GAMES.length);
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
  report.check(`today (${date}) has a puzzle for all three Movies games`, true);
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
    await report.runSection("Fade to Color", () => playFadeToColor(ctx));
    await report.runSection("Fade to Color: the win, skipped and reloaded", () => playFadeToColorWinSkipped(ctx));
    await report.runSection("Fade to Color: the win, skipped with a key", () => playFadeToColorWinKeySkipped(ctx));
    await report.runSection("Fade to Color: stop the film, pick right", () => playFadeToColorStopRight(ctx));
    await report.runSection("Fade to Color: stop the film, pick wrong", () => playFadeToColorStopWrong(ctx));
    await report.runSection("Fade to Color: the run-out", () => playFadeToColorRunOut(ctx));

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
