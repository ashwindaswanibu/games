# Lexicon: decisions and their alternatives

Every call made building Lexicon (Words bucket, live for admins since 2026-10-10), with what it
could have been instead, so any of them can be flipped. Yours are marked **(owner)**.

## The game

| Decision | Chosen | Alternatives considered | Why |
|---|---|---|---|
| Core loop | Guess any word the nine letters spell; learn whether today's word is before or after it alphabetically **(owner)** | Hot/cold distance; letter-position feedback (Wordle-like) | Your idea; alphabetical order is the one feedback that needs no extra UI vocabulary |
| Answer length | 5–7 letters **(owner: "a shorter word")** | Any length; always the 9-letter word | A full-length answer makes the anagram the whole game |
| Length shown | Hidden since 2026-10-12 **(owner: "don't tell me the length at all")**; was shown as blank slots **(owner)** | Shown | It misled players into hunting a nine-letter word; before-or-after alone reads cleaner |
| Guess limit | Unlimited **(owner)** | 10 guesses | Never a dead end; the score carries the pressure |
| Refused guesses | Free (not a word / not from the letters / outside the gap) | Count them | A typo shouldn't cost points |
| Words-left count | Shown while playing **(owner)** | Only at the end | Makes the closing gap visible as a number |
| Score | Guess 1 = 100, then 90, 80, 70, 60, 55, 50 … floor 10; give up = 0 **(owner: "guess 1 = 100 and so on")** | Par by perfect halving; leaderboard placings | You asked for a pure per-guess table; placings rejected **(owner)** |
| "Halving perfectly takes N guesses" line | Removed 2026-10-11 **(owner: "stupid and not needed")** | Kept on the entry | — |

## The day's puzzle

| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Dictionary size | 60–120 words a day (`DAY_WORDS`) | Any size; fixed 100 | Days alike in difficulty; under 60 is too easy to halve, over 120 drags |
| Letter hand | No letter more than twice, at least three vowels (`fairHand`) | Free | A hand like SRTARSSSE spells little and reads as a glitch |
| Guess list | 12dicts `3of6game` (44,883 words) | ENABLE/TWL (many obscure words); Wiktionary | Common words a person would type; public domain |
| Answer list | 12dicts `2+2+3frq` 5–7 letters (1,913 answers) | Same as guesses | Answers should be words everyone knows |
| Definitions | WordNet 3.1, first clause, ≤160 characters | Wiktionary (licence + parsing); none | Clean licence, consistent register |
| Offensive words | WordNet usage-domain pointers (`;u`) plus a short `BLOCKED` list of grim words | Big external blocklist | Precise for definitions we already load; the short list catches what tags miss |
| Credits | 12dicts (Alan Beale, AGID © Kevin Atkinson) and WordNet © Princeton on the entry | Footer only | The licences ask for a visible notice |

## How it looks

| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Metaphor | A dark study, one book seen from its fore-edge: a page per word, thumb index cut in | Word list; a ladder; a ruler | The dictionary *is* the board, the gap is literally the pages left |
| Guesses | Red silk ribbons laid in at their page, the two bounding the gap lettered | Pins; bookmarks; highlights | Ribbons are what a dictionary has; red is the one accent |
| Accent | Red `#c93a1b` (the Words bucket colour) | Gold; ink blue | Distinct from Movies' warm light; reads as silk |
| Shade | Pages outside the gap fall into shadow | Remove them | The light you have left is the gap you have left |
| Win | The book shuts on the page, then opens to the dictionary entry (headword, part of speech, definition) | Confetti; a score card first | The answer is a word, so the payoff is reading it as the dictionary prints it |
| Input | Letter tiles that lift into the guess line; keys anywhere; Space shuffles | A text field | Tiles show what's available; typing still works |

Overnight 2026-10-11 the screens get a visual pass (gameplay unchanged); changes will be logged
here too.
