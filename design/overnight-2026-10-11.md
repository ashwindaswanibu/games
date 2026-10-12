# Overnight visual pass, 2026-10-11
You asked for a radical visual upgrade with the gameplay unchanged. Each screen had two independent designers (a "signature moment" lens and a "craft and radical recomposition" lens) and a judge who scored their ideas against your recorded taste and wrote the build spec. Below, per screen: the direction, each change with the main alternative (so you can flip it), and what the judge rejected. Status says what is live.

## Movie Barcode

**Status:** live 2026-10-11 night

**Direction.** Pressed, not glowing. "Movie Barcode" is the name of an object, and that object has one physical rule, which becomes the identity: wherever the film's colour touches type, it is hard-edged vertical bars of flat colour in film order. It is never a gradient, a halo or a glow. Bodoni Moda's thick stems and hairlines already read as a barcode, so no barcode is ever drawn. Light in the room stays soft but becomes much darker and neutral: projector white instead of amber, true black corners and no glossy floor, so the strip is the brightest thing in the room. One new verb, "press", plays once a day. When the film is rolled, the leader's sweep turns once (one second of leader). Then the whole film is pressed into the strip, left to right, in 48 jumps at 24 frames a second, and "Barcode" in the header is pressed in the same 48 jumps. Only after that does the room take the film's light. Every later reel still unreels exactly as he likes; only its neon glow goes. The end becomes a title card: the film's name at about 90px in its own pressed bars, with everything else quiet underneath. Repetition goes: the name appears once (in the header), the date once (on the film's edge) and the count once (on the strip). Gameplay, rules, scoring, secrecy (fills still come only from level 1) and the win's choreography are untouched.

### Changes
- **1 · The identity: one engine for hard bars, and a new wordmark ("Movie" in ink, "Barcode" pressed)** — alternative: • Keep "Barcode" in italic at 1.18em, the old flourish, with the same bars. Rejected: slanted stems cut by vertical bars read as stepped and busy, while roman stems line up with the bars.
• Designer B's "one bar per 3px". Rejected: finer and truer to the 480 bands, but it stripes the stems and shimmers at 24px.
• Designer A's ghost "Barcode" before roll. Rejected: it reads as a disabled word.
• If the colours read too loud, the dial is cMax 0.15 → 0.12.
- **2 · The arrival: the film is pressed into the strip at 24 frames a second, and the name is pressed with it** — alternative: • Designer A's slit: press into a 2px line, hold, then open vertically. Rejected: it reads as a CRT power-on effect and runs 3.3s.
• Designer B's main title squeezed into a barcode. Rejected: it retires the leader he picked and is a pun on the name.
• A smooth press on UNREEL_EASE. Rejected: the stepped 24fps press is the one motion in the game that is literally film running through a gate, and it sets the arrival apart from the per-guess unreel.
• Dial: PRESS_FRAMES 72 (3s) if 2s feels rushed.
- **3 · A dark room again: neutral projector white, low-frequency wash, no glossy floor, no neon bar** — alternative: • Wash at 0.10 (Designer B) if 0.07 kills too much of "the barcode lights the room". Show stills of 0.07 and 0.10 side by side.
• Cool xenon #e8ebee (Designer A). Rejected: too blue against the warm ink #efe9df.
• Keep or enlarge the reflection (Designer B wanted 20vh). Rejected: a glossy floor is a product-shot trope and smears the gap between strip and console.
- **4 · The end is a title card: the film's name at ~90px in its own pressed bars, everything else quiet** — alternative: • Designer A's back-of-case layout: title flush left on the reel's edge, score flush right. Rejected: the centred title card is the A24/Criterion move and keeps the eye under the reel.
• Designer B's gate stepping back to 62%, with the contact strip carrying per-reel marks. A bigger build; a candidate for the next pass.
• Keep ResultFrames in the row if he misses the missed/skipped shape.
- **5 · Every other lit title takes the same hard bars; halos and live filters go** — alternative: • Keep the smooth graded fill on the small surfaces (tiles, friends panel), where 3 bars per letter come out at about 4px. Rejected: one rule everywhere is the identity, and mixing breaks it.
- **6 · One name, one date, one count** — alternative: • Keep the header date and print "▸ FIRST FRAME" on the rail instead. Truthful to the strip's time axis, but it is more words.
• Keep the status line as the console's one piece of display type. Rejected: it repeats the edge print and the strip.

### Rejected
- **Unsqueeze: each strip de-squeezes from band width (Designer A, 3)**: The client doesn't know the strip counts: they aren't stored on level refs, so this needs a schema change plus a backfill, or edge detection. With 128 strips it risks reading as a PowerPoint "blinds" transition. It also replaces the unreel he loves. Prototype it later on reels 2 and 10, but not tonight.
- **The Ladder: ten exposure rows replacing the contact strip (Designer A, 4) and silver loss rows (A, 5)**: Large build with 9px click targets and a new scrub gesture. Without strip counts the rows all look like the same fine barcode, so the resolution-pyramid idea doesn't show. It also replaces the readable look-back and the print run he liked with a chart-like object.
- **Slit, then vertical open (Designer A, 2: the open half)**: A line opening into a picture is the CRT power-on cliché, and the whole thing runs 3.3s every morning. The left-to-right press at full height carries the same meaning in 2s.
- **Main title squeezed into a barcode (Designer B, 2)**: It retires the academy leader he picked, and the name turning into a barcode is a pun on the name: the literal kind of visual he rejects.
- **KeyKode Code 128 in the edge print (Designer B, 1)**: A real barcode that encodes a made-up serial is decoration acting as authenticity (it fails the cosplay test). It also adds clutter to the rail.
- **Edge print of strip counts, e.g. "480 BANDS / 60 STRIPS" (Designer A, 1)**: Data clutter, and strip counts for reels 2–10 aren't available on the client.
- **Full-bleed rails, celluloid beyond the gate, perforation pull-down, 20vh floor reflection (Designer B, 3)**: A big layout change that forces glide.ts to be reworked. Motion on every unreel thins out the one meaningful move, and the enlarged glossy floor is the trope we are removing. The re-ranked console idea is partly taken (count folded into the edge print and strip).
- **Share print PNG via navigator.share (Designer B, 4)**: A good idea but large (canvas composition, font loading, file-share fallbacks). It belongs in its own pass after the identity is settled.
- **Phone editing bench: overview strip plus a scrubbable viewer (Designer B, 5)**: The best phone idea, but large: a new gesture, a second unreel surface, and the title card has to be re-measured. It is the lead candidate for a dedicated phone pass. Tonight phone gets legible edge print, a 24px mark and a tuned end title.
- **Pinning opsz 96 on the display type (Designer B, 1)**: next/font loads the opsz axis and auto optical sizing already reaches 96 at the end-title size. Forcing it at 24–44px breaks the hairlines on 1x and 2x screens.
- **Centred 26px header wordmark (Designer B, 3)**: It shrinks the identity he asked to give more presence, at the moment it gets its new look.

## Degrees of Separation

**Status:** live 2026-10-11 night.

**Direction.** Keep the dark room and the thread. Tonight the thread becomes the whole page. The frame is a two-shot. The two people you must connect stand above the line as stacked Bodoni title cards, with their faces large, dim and silver behind them. The people you find hang below it, each portrait under its knot. The films ride the line as the loudest supporting type. You write each link onto the line itself, where it will live, instead of into a form beneath it.

Nothing moves unless it means something. Both infinite loops go (the marching dashes and the breathing ring), and a stretch or knot draws in once, when it becomes the open one. The win is a single run of light from the start pin to the end ring. Each knot takes the light as it passes, each face develops from silver to colour, and the end ring closes last. Then the house lights come up, the thread lifts, and the end titles rise line by line.

The arrival teaches the game on the unlit thread: faint italic notes sit in the exact slots that today's names and films will take, and they give way to the real pair in place. No knots claim a par that isn't known yet. Amber means only "light, being made". The room and the faces go neutral silver, so nothing drifts into golden hour.

Gameplay, moves, hints, confirmations, scoring and the a11y contracts are unchanged. Items 1–3 each stand alone if time runs short.

### Changes
- **1. Recompose the room as a two-shot: title-card ends above the line, the cast hanging below, films promoted, no loops, status into a foot row** — alternative: One-line end names at 80px (simpler, but long pairs collide and the top band stays thin). B1's 576px edge-bleeding portraits (needs a 768px crop in scripts/content/movies/lib/portraits.mts: next pass). A5's centred spine on phone (keeps symmetry but halves text room, so film titles truncate at about 150px). B3's notch ruler instead of the mono meter.
- **2. Write the link on the thread (desktop): the film field sits on the open stretch, the cast field under the open knot, hits hang from the line** — alternative: A2's typographic break, where the line parts around each title like a title between rules: lovelier, but it needs per-label measurement and split segments, so it's a later pass. B2's low-risk fallback, where the field stays docked but the typed text mirrors live into the open stretch: flip to this if writing on the line feels precious. Opening the hits upward over the ends (as today) was rejected because they would cover the title cards.
- **3. One light runs the thread: the win** — alternative: A3's pluck, where the string rings at par and thrums lower when slack: rejected as a wobble across names and faces. B3's 'rest in ink with amber knots': if the all-amber line reads too warm after the run, give .segmentLit an opacity transition to 0 at 2600ms, so only the knots stay amber.
- **4. The arrival: the rules written on the unlit thread, giving way to today's pair in place** — alternative: A1's 'Pulled Apart' title sequence (names stacked as a double bill, then dragged to the ends): striking, but a literal enactment of 'separation', 3.4s or more every day, and a fragile FLIP across the network wait. Keep the five-rule list but set it in two columns (A1): cheaper, but still a terms page.
- **5. End titles: one lockup, tomorrow, and the credits as fine print; the thread lifts to make room** — alternative: A4's billing block (your chain set as poster credits under the score): rejected tonight because the lit thread directly above already shows the same chain. Reuse its typography in the Everyone panel later. B4's skein (friends' finished threads hanging from the same two pins, ranked by sag) is the strongest next-pass idea for this card.

### Rejected
- **A1 Pulled Apart: names stacked as a double bill, then dragged to the ends**: It is a literal enactment of the word 'separation'. It adds 3.4s or more to every daily start, and the gather-then-FLIP hand-off across the network wait is fragile. Two parts survive: no fake par knots before Start, and names developing in place.
- **A2 line broken around each film title (title between rules)**: It needs a ResizeObserver per label and split sub-spans. The films riding above the line, promoted to 20px, already read as the thread's beads. Revisit it after the on-thread field lands.
- **A2 recoil dip on every tie and the travelling highlight on each new open stretch**: Fussy motion on every action. A single draw-in of the open stretch and a single ring on the open knot already say 'here next'.
- **A3 pluck/thrum: the whole board rides a damped sine graded by slack**: Names, faces and films wobbling reads as jelly, which is a gimmick. With straight-span segments the string would zigzag rather than ring. The grade is already honest through the sag and the kicker. The light run, ring close, silver faces, crossfade and house lights are kept.
- **A4 fallen thread on give-up (a second dimmed board layer)**: It doubles the DOM and the geometry paths for a state most players rarely see. Defer it; giving up keeps today's quiet reveal.
- **A4 billing block of your chain under the score**: It duplicates the lit chain sitting directly above it on the board and pushes the end card below the fold.
- **A5 centred-spine phone (films left, names right)**: It halves the text room, so film titles would clamp at about 150px. The left spine with title-card bands at the top and bottom keeps the two-shot drama and the readability.
- **A5 merging the two hints into one menu on phone**: It changes the control structure for little visual gain. The foot row fits all four controls on one row.
- **B1 576px edge-bleeding portraits and a fixed bottom band with visualViewport keyboard handling**: The portraits need a 768px crop in the content pipeline, and the fixed band with the iOS keyboard is fiddly. The two-shot grammar is kept within the existing 384px crop and normal flow.
- **B3 SVG droop curve per stretch with a twang on each tie**: It adds an SVG per segment and a WebKit non-scaling-stroke risk, for a barely visible gain at slack 1–2.
- **B3 dashed par line from pin to pin**: At one over par (the most common slack) the film titles sit exactly on the par line's height, so it would strike through them. The sag itself is the measure.
- **B3 expanding ring ping at the end pin**: A generic sonar effect. The ring closing from its centre is the arrival.
- **B3 move ruler of notches**: Another widget to learn. One mono meter line in the foot row carries the same information with less clutter.
- **B4 skein of friends' threads hanging from the same pins**: It's the best idea for the result screen and the first candidate for the next pass, but it is L effort (name-matched detail, hover reading, a cap on threads, phone variant) and doesn't fit tonight.
- **B4 ThreadMark miniature and the home-card swap**: Home-screen work outside this screen tonight. ChainMarks stays in the lockup until the home pass.
- **B5 rules as a mono uppercase line**: Long uppercase mono sentences are hard to read. Two Bodoni sentences carry the rules, and the thread's notes carry the mechanics.

## Lexicon

**Status:** live 2026-10-11 night. Reviewer change: the dictionary page is shorter (it hugged an empty middle).

**Direction.** Make the book the whole screen, and have the frame close in as the gap closes. Lexicon becomes one physical object: today's dictionary standing on a desk, seen from its fore-edge at real size (about 1328x300 on laptop, full width on phone). It has boards standing proud of the paper, bone paper with a rounded edge, a stepped half-moon thumb index, and silk ribbons that show as a thin red thread between the leaves and hang out of the foot with a swallowtail. The one striking idea is that the book falls open at the gap. Each accepted guess plays two beats. First, the shadow falls over the pages you ruled out while every leaf stays put (the cause). Then the ruled-out pages press together and the pages still in play spread apart under the light (the consequence). The endgame gets more of the frame, not less, yet the lit window still shrinks on every guess, so the picture stays honest. The count is stamped in ink on the lit leaves. The two bounds are the page's guide words, set large in the corners above the book (AFTER ‹word› / BEFORE ‹word›), the same composition as Degrees' FROM/TO. The win completes the metaphor: the book shuts on one lit leaf, and that leaf turns to face you as a printed dictionary page. The page is bone paper with the headword in Bodoni, your two closest guesses as its guide words, the source credit as its imprint, and your red ribbon lying in it (no ribbon if you gave up). A Degrees-style result row sits beneath it. On arrival the book is shut and uncut, and it riffles into today's dictionary when you open it. Everything else gets quieter, with one hierarchy: book, then bounds, then guess line, then letters, then keys. The kicker row, the count row, the 'Guess 5 · worth 60' line, the gold, the glow and the blinking caret all go. Laptop must fit without scrolling at 1440x900 and 1440x790. Phone (390x844) must fit without a sticky console. Gameplay, rules, logic.ts, the share text and the stored data are untouched. The items below are in order of impact. If the evening runs short, defer item 6 first, then item 5. (Access note for the owner: this review only read the taste memory file, the three Lexicon screenshots plus deg-won.png for the family pattern, and the Lexicon, Degrees and Fade to Color source. Nothing was edited.)

### Changes
- **1. The book as an object: boards, bone paper, desk, stepped thumb index, thread-and-tail ribbons, stamped count** — alternative: Keep a one-line count under the book instead of the stamp. That is the safe flip if the stamp reads as an overlay. Proposal 3 of Designer 1 used full-length horizontal thumb grooves from the front board to each tab. They are more literal, but they stack dark bands across the lit gap, so this item uses half-moon cuts at the tabs only.
- **2. Close in: the book falls open at the gap (lens + two-beat guess)** — alternative: Designer 1's growing-share lens gives the gap up to 72% of the width as it shrinks. That is a bigger zoom, but the light grows after a good guess, which contradicts 'the gap closes in'. To flip, change G to max(f, 0.72-0.5f) capped by n*maxLeaf. A single-beat version, with the sweep and the dolly together, is simpler but loses cause then consequence. To get it, set the timer to 0.
- **3. Running head and a three-row console: one hierarchy** — alternative: Designer 2 put the count in the centre of the running head (folio position) instead of the stamp. That is the flip if the stamp is killed. A visible whisper for accepted guesses could also be kept; it is currently suppressed. Worth could stay as a separate 'Guess 5 · worth 60' line instead of living on the button.
- **4. The win: the lit leaf turns to face you as a printed dictionary page** — alternative: Designer 1's version is a 2D FLIP from a 4px slit, scaleX from about 0.008. It is simpler, but it stretches the paper and reads as a door of light. Designer 2's version adds a 10px lift and rotates from 89.6° whatever the leaf's width; this item instead computes θ0 so the lit leaf is literally the page seen obliquely. The score could instead be set large in Bodoni above the row, like Degrees' 100 points. That flip is cheap if he wants more celebration.
- **5. Arrival: a shut, uncut book that riffles into today's dictionary** — alternative: Designer 2 framed the rules as a 'lexicon, noun' dictionary entry: more themed, but it tips into cute. Alternatively, keep the existing numbered list and add only the riffle.
- **6. Letters travel: FLIP from the row into the line, back, and on shuffle** — alternative: Keep today's ghost, where the cell drops to .12 opacity and nudges up 10px, and add only the shuffle glide. That is about 15 minutes and the fallback if the evening runs out.

### Rejected
- **Radial fan: the dictionary on its spine, closing guess by guess (Designer 2, #1)**: At the start a 180° fan of bone lines around a dark hub reads as a sunburst, gauge or peacock, which is the generic image he rejects. It also loses the readable thumb index and true proportions, needs a full rewrite (L), and can't be judged without stills. Worth one numbered mood-board still later; not tonight's build.
- **A lens whose gap grows to 72% of the width as it shrinks (Designer 1, #1 formula)**: After a good guess the lit area would get bigger, which contradicts the rule 'the gap closes in'. The monotone lens (f^γ, capped per leaf) keeps the closing honest and still gives the endgame six times today's width.
- **Centre the gap and slide the whole book under a fixed lamp (Designer 2, #5)**: Moving the object every guess reads as a camera pan. Pressed pitch would also force the book's width to change. Keep the book still and let the light and the lens do the work.
- **Word flies from the guess line to its guide-word slot on every guess**: A gesture of about 400px across the book on every guess competes with the book's sweep and dolly, which should be the one striking motion. The word now rises out of the line as its ribbon lays in, and the guide word develops in place.
- **Full-length thumb-index grooves from the front board to each tab**: Physically right, but on a day centred in the A section, five or more dark bands would cross the lit gap exactly where the stamped count sits. Half-moon cuts at each tab carry the detail without the noise.
- **Bound words lettered on the ribbons or riding with the gap**: Redundant once the running head holds the bounds, and they are tiny rotated text. When the gap sits at the far left they collide with the book's edge.
- **Neighbour column on the result page (the guesses around the word, with counts)**: It puts data on the paper. Guide words in the page's running head tell the same story in the dictionary's own typography.
- **'lex·i·con' syllabified wordmark and the 'lexicon, noun' rules entry**: Both are punny conceits that tip into cute. The run-in numbered senses keep the dictionary register without the joke.
- **Gold found ribbon, glow on the answer page, gold word above the book, scaleX(0.04) entry**: Golden-hour warmth and a neon-style glow are explicit rejects, and the horizontal stretch distorts type. Everything is now rubric red, bone paper and ink.
- **2D slit-to-page FLIP ('a door of light')**: It scales a sheet from about 4px wide, stretching it, and reads as a stage effect. The oblique rotateY makes the lit leaf literally the same page seen edge-on.
- **'Today's word was' kicker printed on the paper for a give-up**: A dictionary page doesn't carry that. The missing ribbon and the 'GAVE UP · 0 POINTS' row say it.
- **Sticky bottom console on phone**: Everything fits in 390x844 without it, and sticky adds risk with the safe area and the on-screen keyboard.
- **Friends' positional trails by changing friendDetail to {word, page}**: Changes the stored data shape and needs the owner's approval. Tonight friends get ribbon bars parsed from the existing shareGrid, and positional trails are deferred.
- **Per-leaf alternating paper tones**: Adds a layer per leaf for little gain. The two-tone hairline (a dark line plus a light edge) already separates the leaves.

## Home

**Status:** live 2026-10-11 night. Reviewer change: the Movies spine is pressed in hard bars like the game's wordmark (the builder's soft film light read as a pastel rainbow); the colour maths moved to src/lib/film-palette.ts so the home never loads the game.

**Direction.** 

### Changes
- **1. Recompose: plates take half a slot and their names stand up the cut** — alternative: Designer 2's marquee bands: a 112px band with the category name set horizontally over its own games, which become 480px posters. It gives more width, but it retires the plate rule shipped tonight, turns the field into a header plus a grid, and is a larger model rewrite. To flip, add a 'columns' mode to choosePlan whose plate box spans its games' x range over [0,112].
- **2. Every tile is its game's object: the reel, the thread, the fore-edge** — alternative: Designer 1's sprocket rails down both slanted seams. Rails run along a film's travel, and here the film's time runs across the tile (the bars are vertical), so the rails belong top and bottom, as the game's reel has them.

Skewing the fore-edge to the field's angle: no. Objects stay upright like the bars; only the seams lean.

Thumb-index tabs: cut, because they collide at 288px. To restore them, add p.tabs and place each at at/total*B, keeping at least 16px between tabs.
- **3. The film is the room's one colour: lit name, spill, accent** — alternative: Fill the italic 'Barcode' in the title card instead. That is the game's own wordmark trick, but it puts a small lit word beside a big ink spine; to switch, move .spineLit onto the italic title part.

No spill at all: the plates go back to being flat ground.

A lamp spill from Lexicon onto Words: cut, because a second light source dilutes 'the film is the only colour'.
- **4. One billing line: shared title size, the games' own verbs and colours, house lights, a header that says each thing once** — alternative: Per-tile fitted title sizes: today's five ragged baselines.

Filled accent pills at rest: three coloured blobs competing with the objects. To flip, apply the hover rule at rest.

Designer 2's :has()-driven veil: a WebKit performance risk over many clip-path layers, so it is state-driven here.
- **5. Arrival once a day, then stillness; opening dips to black** — alternative: Designer 1's 'Sunday' title sliced by the seams: a logo effect, and a 3s gate in front of the one visit most friends make each day.

Keeping today's opacity ramp on the React clock: it means nothing and it costs performance.

A View Transitions shared-element match cut: deferred. Next 16's router.push inside startViewTransition is unverified, and it would touch three game screens. The dip to black needs no game-side change.
- **6. Phone: one game per row, cut at the same angle** — alternative: Keep today's two half-width columns: 195px tiles crush every object, and the Words plate is a void.

Designer 1's 44px left spines spanning rows: a third geometry (vertical spines beside horizontal rows) that costs more than it gives at 390px. Running bands keep a single cut language.

### Rejected
- **'Sunday' title cut by the seams, with a colour beat (Designer 1, #1)**: It reads as a generic title sequence or logo effect, and it puts about 3 seconds in front of the one visit most friends make each day. It also needs font-gating to avoid a fallback-serif flash. The cut survives as the seams drawing during the arrival, with no word in the way.
- **Marquee bands over poster columns (Designer 2, #1)**: It retires the plate rule shipped tonight, turns the field into a header plus a grid, and is a larger model rewrite. Half-slot plates with spines get the games 25% more width with a five-line change.
- **Sprocket rails down the slanted seams, and per-object hover motions (Designer 1, #2)**: The rails would run on the wrong axis: time runs across the tile, so rails go top and bottom, as on the game's reel. Advancing a sprocket, pulling the thread taut or drawing the shades back on every hover are gimmicks; the house lights are the one hover response.
- **View Transitions match cut and a game-screen handoff flag (Designer 1 #2, Designer 2 #3)**: Deferred. Next 16's router.push inside startViewTransition is unproven, and both edit three game screens. The dip to the shared #050506 black gets continuity from the home side alone.
- **Result strips as objects, the day's end card with friend credits, and 'Share the day' (Designer 1 #4, Designer 2 #4)**: Right idea, next session. It needs new result fields with spoiler-wall tests, and the share text is a product decision. Show Ashwin two or three numbered options first, as he likes to decide. Removing the '✓ Played' pill waits for that pass so the strips aren't changed twice.
- **Resting hairlines on every seam (both designers)**: Drawn lines on every cut read as cut paper, the Day for Night look he called 'ain't me'. The pieces' own light separates them; lines appear only for the arrival's cut, then fade.
- **Taglines back on the title cards (Designer 2)**: The object already says what the game is. Taglines of different lengths would break the shared baseline, and 'clean' means no explanatory clutter.
- **Progress caption and tagline on standing plates**: The header and the tiles already say it, and at 180px wide the caption would wrap. It stays in the plate's aria-label; flat bands keep their one line.
- **Amber #e9a31e for Degrees (Designer 1)**: Wrong value. The game's accent is rgb(236 178 92), #ecb25c (degrees/screen/screen.module.css line 20).
- **Skewed fore-edge and thumb-index tabs on the home tile**: Objects stay upright like the barcode's bars, and only the seams lean. Tabs collide at 288px and add clutter; the page hairlines already carry the dictionary.

## Round two (later the same night)

### Home: a finished game shows its own object — live
Built from the designers' "result strips as objects" proposals the judge deferred. A finished game's strip is its object resolved (the barcode at full colour with the reels it took and its title up the seam; the thread plumb and lit amber; a red ribbon from the dictionary's edge with the word on it); the day's print sets every result title on one baseline. Adapted to tonight's identities: red ribbons, not the proposals' gold; the film title in pressed bars; colour is earned (a film that got away is titled in ink).
- Alternative: keep the generic score strip with "✓ Played" (what it was).
- Not built: **"Share the day"** (one message with every game's share line). What it says is your call: say the word and it's an hour's work.

### Movie Barcode on a phone: the editing bench — building
An overview strip plus a viewer showing a third of the film at three times the size, scrubbed by dragging (the judge's "best phone idea", deferred from round one only for size). Laptop unchanged.

### Review fixes — live
An independent review of the four redesigns found four real defects, all fixed: Lexicon's letters dropped and rose twice after opening; the phone's all-played print ran friends' marks under the row's cut; a deep Degrees sag could hide a face under the end titles at 1280x720; Degrees' short rules said an undo costs a move.
