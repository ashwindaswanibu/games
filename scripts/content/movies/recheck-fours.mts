/**
 * Re-checks the four stored with each Fade to Color day nobody has played yet, and re-picks only
 * the ones that mix kinds (an animated film among live-action ones, or the other way round). The
 * four are visible from reel 1, so a mixed four would give the answer away.
 *
 *   npm run content:movies:recheck-fours -- [--dry-run] [--allow-remote]
 *
 * A day someone has played is never touched.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { today, type PuzzleDate } from "@/core/day";
import { fadeToColor } from "@/games/fade-to-color/logic";
import { finalPickOptions } from "./lib/decoys.mjs";
import { pipelineDb, selectAllPages } from "./lib/pipeline.mjs";
import { knownAnimated } from "./lib/wikidata-kind.mjs";

const { values: args } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, "allow-remote": { type: "boolean", default: false } },
  strict: true,
});

const storedSchema = z.object({ answer: z.object({ id: z.number(), title: z.string() }), options: z.array(z.object({ id: z.number(), title: z.string(), year: z.number().nullable() })) });

async function main() {
  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const from = today();
  const rows = await selectAllPages((a, b) => db.from("puzzles").select("puzzle_date, solution").eq("game_id", fadeToColor.id).gte("puzzle_date", from).order("puzzle_date").range(a, b));
  for (const row of rows) {
    const date = row.puzzle_date as PuzzleDate;
    const { count } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", fadeToColor.id).eq("puzzle_date", date);
    const solution = storedSchema.safeParse(row.solution).data;
    if (!solution) {
      console.log(`${date}  skipped: no four stored`);
      continue;
    }
    if ((count ?? 0) > 0) {
      console.log(`${date}  ${solution.answer.title}: played, left alone`);
      continue;
    }
    const ids = solution.options.map((o) => o.id);
    const { data: films } = await db.from("movie_films").select("id, wikidata_id").in("id", ids);
    const qid = new Map((films ?? []).map((f) => [f.id, f.wikidata_id as string | null]));
    const animated = await knownAnimated([...qid.values()].filter((q): q is string => q !== null));
    const kind = (id: number) => (qid.get(id) && animated.has(qid.get(id)!) ? "animated" : "live");
    const answerKind = kind(solution.answer.id);
    const mixed = solution.options.filter((o) => kind(o.id) !== answerKind);
    if (mixed.length === 0) {
      console.log(`${date}  ${solution.answer.title}: the four are all ${answerKind}, kept`);
      continue;
    }
    const options = await finalPickOptions(db, solution.answer.id, date);
    console.log(`${date}  ${solution.answer.title}: ${mixed.map((m) => m.title).join(", ")} ${mixed.length === 1 ? "is" : "are"} the wrong kind → ${options.map((o) => o.title).join(" · ")}`);
    if (args["dry-run"]) continue;
    const { error } = await db.from("puzzles").update({ solution: { ...(row.solution as object), options } }).eq("game_id", fadeToColor.id).eq("puzzle_date", date);
    if (error) throw new Error(`Couldn't update ${date}: ${error.message}`);
  }
  console.log(args["dry-run"] ? "✓ dry run: nothing written" : "✓ done");
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
