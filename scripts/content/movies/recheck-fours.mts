/**
 * Re-checks the four stored with each Fade to Color day from tomorrow on, and re-picks only the
 * ones that mix kinds (animated, live-action/animated hybrid, live action, per Wikidata). The four
 * are visible from reel 1, so a mixed four would give the answer away.
 *
 *   npm run content:movies:recheck-fours -- [--dry-run] [--allow-remote]
 *
 * A day someone has played is never touched. Today is left out, so no one can play a day while it
 * is being re-checked (everyone who stops on a day must see the same four): review today's by hand.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { addDays, today, type PuzzleDate } from "@/core/day";
import { fadeToColor } from "@/games/fade-to-color/logic";
import { finalPickOptions } from "./lib/decoys.mjs";
import { pipelineDb, selectAllPages } from "./lib/pipeline.mjs";
import { filmKinds } from "./lib/wikidata-kind.mjs";

const { values: args } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, "allow-remote": { type: "boolean", default: false } },
  strict: true,
});

const storedSchema = z.object({ answer: z.object({ id: z.number(), title: z.string() }), options: z.array(z.object({ id: z.number(), title: z.string(), year: z.number().nullable() })) });

async function main() {
  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const from = addDays(today(), 1);
  const rows = await selectAllPages((a, b) => db.from("puzzles").select("puzzle_date, solution").eq("game_id", fadeToColor.id).gte("puzzle_date", from).order("puzzle_date").range(a, b));
  for (const row of rows) {
    const date = row.puzzle_date as PuzzleDate;
    const { count, error: countError } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", fadeToColor.id).eq("puzzle_date", date);
    if (countError) throw new Error(`Couldn't count plays for ${date}: ${countError.message}`);
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
    const kinds = await filmKinds([...qid.values()].filter((q): q is string => q !== null));
    const kind = (id: number) => kinds.get(qid.get(id) ?? "") ?? "live";
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
