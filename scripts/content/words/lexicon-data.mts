/**
 * Builds Lexicon's word files from the free sources, once (they're committed in `./data/`):
 *
 *   tsx scripts/content/words/lexicon-data.mts --twelve-dicts <12dicts dir> --wordnet <WordNet dict dir>
 *
 * Get 12dicts 6.0.2 from http://wordlist.aspell.net/12dicts/ and WordNet 3.1's database from
 * https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz, unpack both, and pass their directories.
 *
 * Writes:
 * - `data/lexicon-words.txt`: every word a guess may be, 3–9 letters (12dicts' word-game list).
 * - `data/lexicon-answers.tsv`: the words a day's answer may be, with their dictionary entry:
 *   `word<TAB>part of speech<TAB>definition`. A common headword (frequency groups 1–12), 5–7
 *   letters, in the guess list, with a WordNet definition, and not marked vulgar, obscene, a slur or
 *   disparaging in any of its senses, nor on `BLOCKED` (grim words nobody wants as the day's word).
 *
 * The sources' notices are in `data/README.md`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ANSWER_LENGTHS, JUMBLE_SIZE, MIN_WORD } from "@/games/lexicon/letters";
import {
  definitionOf,
  OFFENSIVE_USAGE_LEMMAS,
  parseFrequencyGroups,
  parseGameList,
  parseWordNetData,
  parseWordNetIndex,
  usageDomains,
  WORDNET_FILES,
  type IndexEntry,
  type Synset,
  type WordNetPos,
} from "./lib/word-sources.mjs";

const { values: args } = parseArgs({
  options: {
    "twelve-dicts": { type: "string" },
    wordnet: { type: "string" },
    out: { type: "string", default: new URL("./data/", import.meta.url).pathname },
    "max-group": { type: "string", default: "12" },
  },
});

/** Words a day shouldn't be about, whatever the dictionaries say. */
const BLOCKED = new Set([
  "abort", "abortion", "abuse", "abuser", "assault", "cancer", "corpse", "genocide", "hitler", "hostage", "incest", "kidnap", "killer",
  "lynch", "massacre", "molest", "murder", "murderer", "nazi", "racism", "racist", "rapist", "slave", "slavery", "suicide", "terror",
  "terrorist", "torture", "victim", "whore", "bastard", "nigger", "faggot", "retard", "porno", "pornography",
  // Common enough to pass the frequency cut, but not a word for the day: rude, intimate or morbid.
  "bitch", "naked", "nude", "virgin", "breast", "toilet", "funeral", "death", "bloody", "sexual", "lesbian",
]);

const POS_ORDER: WordNetPos[] = ["noun", "verb", "adjective", "adverb"];

function main() {
  const twelve = args["twelve-dicts"];
  const wordnet = args.wordnet;
  if (!twelve || !wordnet) throw new Error("Pass --twelve-dicts <dir> and --wordnet <dir> (see the header for where to get them).");
  const read = (...parts: string[]) => readFileSync(path.join(...parts), "latin1");

  const guesses = parseGameList(read(twelve, "International", "3of6game.txt"), MIN_WORD, JUMBLE_SIZE);
  const guessSet = new Set(guesses);
  const groups = parseFrequencyGroups(read(twelve, "Lemmatized", "2+2+3frq.txt"));

  const index = new Map<WordNetPos, Map<string, IndexEntry>>();
  const data = new Map<string, Synset>();
  for (const pos of POS_ORDER) {
    index.set(pos, parseWordNetIndex(read(wordnet, `index.${WORDNET_FILES[pos]}`), pos));
    // Offsets are per file, so key synsets by part of speech too.
    for (const [offset, synset] of parseWordNetData(read(wordnet, `data.${WORDNET_FILES[pos]}`))) data.set(`${pos}:${offset}`, synset);
  }
  const offensive = usageDomains(index.get("noun")!, OFFENSIVE_USAGE_LEMMAS);

  const maxGroup = Number(args["max-group"]);
  const answers: string[] = [];
  const skipped = { notCommon: 0, noDefinition: 0, offensive: 0, blocked: 0 };
  for (const [word, group] of groups) {
    if (!/^[a-z]+$/.test(word) || word.length < ANSWER_LENGTHS.min || word.length > ANSWER_LENGTHS.max || !guessSet.has(word)) continue;
    if (group > maxGroup) {
      skipped.notCommon++;
      continue;
    }
    if (BLOCKED.has(word)) {
      skipped.blocked++;
      continue;
    }
    const entries = POS_ORDER.map((pos) => index.get(pos)!.get(word)).filter((e): e is IndexEntry => e !== undefined);
    if (entries.length === 0) {
      skipped.noDefinition++;
      continue;
    }
    // Marked offensive in any sense, as any part of speech: out.
    const marked = entries.some((e) => e.offsets.some((o) => (data.get(`${e.pos}:${o}`)?.usage ?? []).some((u) => offensive.has(u))));
    if (marked) {
      skipped.offensive++;
      continue;
    }
    // Its commonest part of speech (most tagged senses; ties in noun, verb, adjective, adverb order), and that one's first sense.
    const best = entries.reduce((a, b) => (b.tagged > a.tagged ? b : a));
    const definition = definitionOf(data.get(`${best.pos}:${best.offsets[0]}`)?.gloss ?? "");
    if (!definition) {
      skipped.noDefinition++;
      continue;
    }
    answers.push(`${word}\t${best.pos}\t${definition.replace(/\t/g, " ")}`);
  }
  answers.sort();

  const out = args.out!;
  writeFileSync(path.join(out, "lexicon-words.txt"), `${guesses.join("\n")}\n`);
  writeFileSync(path.join(out, "lexicon-answers.tsv"), `${answers.join("\n")}\n`);
  console.log(`${guesses.length} guess words, ${answers.length} answers.`);
  console.log(`Skipped: ${skipped.notCommon} less common, ${skipped.noDefinition} without a definition, ${skipped.offensive} marked offensive, ${skipped.blocked} blocked.`);
}

main();
