/**
 * Proves, on a production build, that players can't fetch games still in testing: no JavaScript a
 * non-admin page can load contains a testing game's name, tagline or rules, or so much as the URL
 * of a chunk that only a testing game's page uses. (Puzzles and solutions are server-side either
 * way; this is about not leaking what's coming.)
 *
 *   npm run build && npm run test:bundles
 *
 * It reads the client reference manifests Next writes per route (.next/server/app/**), which list
 * every client chunk a route's HTML and RSC payload can reference, plus the root files every page
 * loads, and searches those chunks' contents.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GAMES } from "@/games/registry";

const NEXT_DIR = path.resolve(".next");
const SERVER_APP = path.join(NEXT_DIR, "server", "app");
if (!existsSync(SERVER_APP)) throw new Error("No production build found; run `npm run build` first");

interface RscManifest {
  entryJSFiles: Record<string, string[]>;
  clientModules: Record<string, { chunks?: string[] }>;
}

/** Route (e.g. `/(app)/play/degrees/page`) → the client chunk files it can make the browser load. */
function routeChunks(): Map<string, Set<string>> {
  const routes = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith("_client-reference-manifest.js")) {
        // The manifest is a script that assigns `globalThis.__RSC_MANIFEST[route]`.
        const sandbox = { __RSC_MANIFEST: {} as Record<string, RscManifest> };
        new Function("globalThis", "self", readFileSync(file, "utf8"))(sandbox, sandbox);
        for (const [route, manifest] of Object.entries(sandbox.__RSC_MANIFEST)) {
          const chunks = new Set<string>();
          const add = (chunk: string) => chunks.add(chunk.replace(/^\/?_next\//, ""));
          for (const files of Object.values(manifest.entryJSFiles)) files.forEach(add);
          for (const mod of Object.values(manifest.clientModules)) (mod.chunks ?? []).forEach(add);
          routes.set(route, chunks);
        }
      }
    }
  };
  walk(SERVER_APP);
  return routes;
}

/** Files every page loads, whatever the route. */
function rootFiles(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(NEXT_DIR, "build-manifest.json"), "utf8")) as {
    rootMainFiles: string[];
    polyfillFiles: string[];
    lowPriorityFiles: string[];
  };
  return [...manifest.rootMainFiles, ...manifest.polyfillFiles, ...manifest.lowPriorityFiles];
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

const routes = routeChunks();
const testing = GAMES.filter((g) => g.availability === "testing");
const adminOnlyRoutes = new Set(["/(app)/admin/page", ...testing.map((g) => `/(app)/play/${g.id}/page`)]);
for (const route of adminOnlyRoutes) if (!route.endsWith("/admin/page")) check(`${route} exists in the build`, routes.has(route));

const publicChunks = new Set(rootFiles());
for (const [route, chunks] of routes) if (!adminOnlyRoutes.has(route)) chunks.forEach((c) => publicChunks.add(c));
const publicSource = [...publicChunks]
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({ file, source: readFileSync(path.join(NEXT_DIR, file), "utf8") }));
check("found the chunks non-admin pages load", publicSource.length > 0, publicSource.length);

for (const game of testing) {
  const own = [...(routes.get(`/(app)/play/${game.id}/page`) ?? [])].filter((file) => !publicChunks.has(file));
  check(`${game.id} has client chunks of its own`, own.length > 0, own);

  // Rules with non-ASCII characters may be escaped in the output; the ASCII ones are plenty.
  const secrets = [game.name, game.tagline, ...game.rules].filter((text) => /^[\x20-\x7e]+$/.test(text));
  const leaks = publicSource.flatMap(({ file, source }) => [
    ...secrets.filter((text) => source.includes(text)).map((text) => `${file}: "${text}"`),
    ...own.filter((chunk) => source.includes(path.basename(chunk))).map((chunk) => `${file}: references ${chunk}`),
  ]);
  check(`nothing a player loads names ${game.id} or points at its code`, leaks.length === 0, leaks);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nTesting games stay out of players' bundles");
process.exit(failures ? 1 : 0);
