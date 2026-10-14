/**
 * Builds the words a Lexicon day's nine letters are made from, once (they're committed in `./data/`):
 *
 *   tsx scripts/content/words/lexicon-seed-data.mts --wordnet <WordNet dict dir>
 *
 * WordNet 3.1's database is https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz (see
 * `lexicon-data.mts`); the guess list is the committed `data/lexicon-words.txt`.
 *
 * A day's letters are one common nine-letter word or two common words that make nine together
 * (owner, 2026-10-13: "start with a nine letter word", "merge 5,4 words too"). How common a word
 * is comes from how often WordNet's tagged corpus used it, summed over its senses. Writes:
 * - `data/lexicon-seeds.txt`: nine-letter guess words used `WHOLE_MIN_TAGGED` times or more.
 * - `data/lexicon-seed-parts.txt`: 3–6-letter guess words used `PART_MIN_TAGGED` times or more
 *   (short words need more: the corpus is full of them), or marked rude in any sense. The corpus is
 *   edited prose, so it hardly ever swears, but everyone knows those words, and grim and rude words
 *   are fair game for a jumble (owner, 2026-10-13). Senses marked as slurs or disparagement never
 *   count: a word known only as one stays out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { JUMBLE_SIZE } from "@/games/lexicon/letters";
import {
  parseSenseIndex,
  parseWordNetData,
  parseWordNetIndex,
  RUDE_USAGE_LEMMAS,
  SLUR_USAGE_LEMMAS,
  usageDomains,
  WORDNET_FILES,
  type Synset,
  type WordNetPos,
} from "./lib/word-sources.mjs";
import { SEED_PART_LENGTHS } from "./lib/lexicon-day.mjs";

/** Corpus uses that make a nine-letter word common (outskirts, champagne; not somnolent). */
const WHOLE_MIN_TAGGED = 3;
/** Corpus uses that make a short word common (fruit, plank, reckon; not gnaw). */
const PART_MIN_TAGGED = 10;

const { values: args } = parseArgs({
  options: {
    wordnet: { type: "string" },
    out: { type: "string", default: new URL("./data/", import.meta.url).pathname },
  },
});

function main() {
  const wordnet = args.wordnet;
  if (!wordnet) throw new Error("Pass --wordnet <dir> (see the header for where to get it).");
  const out = args.out!;
  const read = (name: string) => readFileSync(path.join(wordnet, name), "latin1");

  const guesses = readFileSync(path.join(out, "lexicon-words.txt"), "utf8").split("\n").filter(Boolean);
  const data = new Map<string, Synset>();
  for (const pos of Object.keys(WORDNET_FILES) as WordNetPos[]) {
    for (const [offset, synset] of parseWordNetData(read(`data.${WORDNET_FILES[pos]}`))) data.set(`${pos}:${offset}`, synset);
  }
  const nouns = parseWordNetIndex(read("index.noun"), "noun");
  const rude = usageDomains(nouns, RUDE_USAGE_LEMMAS);
  const slurs = usageDomains(nouns, SLUR_USAGE_LEMMAS);

  const tagged = new Map<string, number>();
  const rudeWords = new Set<string>();
  for (const sense of parseSenseIndex(read("index.sense"))) {
    const usage = data.get(`${sense.pos}:${sense.offset}`)?.usage ?? [];
    if (usage.some((u) => slurs.has(u))) continue;
    if (usage.some((u) => rude.has(u))) rudeWords.add(sense.lemma);
    tagged.set(sense.lemma, (tagged.get(sense.lemma) ?? 0) + sense.tagged);
  }

  const uses = (w: string) => tagged.get(w) ?? 0;
  const seeds = guesses.filter((w) => w.length === JUMBLE_SIZE && uses(w) >= WHOLE_MIN_TAGGED);
  const parts = guesses.filter(
    (w) => w.length >= SEED_PART_LENGTHS.min && w.length <= SEED_PART_LENGTHS.max && (uses(w) >= PART_MIN_TAGGED || rudeWords.has(w)),
  );
  writeFileSync(path.join(out, "lexicon-seeds.txt"), `${seeds.join("\n")}\n`);
  writeFileSync(path.join(out, "lexicon-seed-parts.txt"), `${parts.join("\n")}\n`);
  console.log(`${seeds.length} nine-letter seeds, ${parts.length} seed parts (${parts.filter((w) => rudeWords.has(w) && uses(w) < PART_MIN_TAGGED).length} of them in for being rude).`);
}

main();
