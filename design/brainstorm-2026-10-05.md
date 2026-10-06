# Style & UX brainstorm — 2026-10-05

Seven independent visual directions, two style-independent UX tracks, three judges (product, visual, engineering) and a synthesis. Full data: `brainstorm-2026-10-05.json`.

> Status: input only. The owner then chose to explore **elevated Wordle tiles** and **highly stylized retro** (see `explorations/`). The UX decisions below apply regardless of style.

## Ranking (avg judge score /10)

- **Broadsheet** — 8.56 — Primary. All three judges ranked it first: the most coherent ritual, a calm black-and-white platform where each game is one spot ink, a luminance-gated palette that works in both themes, and a kit that covers every planned genre. Watch that it doesn't feel stuffy; warmth comes from people, not decoration.
- **Instrument** — 8 — Blend in as the engine, not the brand. Take its readouts-as-data HUD, luminance-separated HIT/NEAR/MISS, one-lit-control rule and feedback() API. Reject its monochrome avatars, Inter/JetBrains stack, dot grid and a game accent that duplicates the house accent. On its own it reads as a Linear clone.
- **Toy Box** — 6.67 — Graft only 'Done stays pressed in' (as settled surface-2 rows). Its 2px ink outlines, lips and candy fills are a 2021-era trend that gets noisy on dense boards and has a weaker dark mode.
- **Closing Bell** — 6.67 — Graft its data honesty: server-side spoiler-safe totals, proportional depth-to-leader bars, and arrow-plus-sign deltas. Reject the terminal skin; it is Ashwin's identity, not the group's, it uses pale fills that vanish in light mode, and it puts a ticker in motion on a calm hub.
- **Card Table** — 6.61 — Graft the 'what the group sees' share preview and an optional hashed per-game pattern for telling games apart past 6. Reject the skeuomorphism: linen, felt, lamp and lattice wear thin, cost about 200–250 KB of fonts, and the light accent fails 3:1 on bg.
- **Read Receipts** — 6 — The best social instincts; graft them in print grammar (who finished and when, an 'In today's edition' row, yesterday's winner). Reject the chat skin and the Phase-2 realtime dependency. It imitates the group chat it sits beside and gets busy fast.
- **Coin-Op** — 5.89 — Reject. A pixel-font costume with poor longevity and legibility (VT323 needs 20px or more, bitmap fonts blur at fractional DPR), and the dark border at 2.16:1 fails the pressable cue. Keep only the idea that a loss leads into a countdown to tomorrow.

## Synthesized recommendation

**Broadsheet**, blended with: Instrument's play-frame contract (data-declared readouts, luminance-separated HIT/NEAR/MISS, one lit control per screen, a single feedback() API). Read Receipts' social pull redrawn in print style (an 'In today's edition' finisher row, 'finished 8:02' sealed rows, a 'Yesterday's final' strip), without bubbles, typing dots or a realtime dependency. Toy Box's settled Done rows. Closing Bell's spoiler-safe server totals and proportional depth bars, drawn as spot-ink hairlines.

Broadsheet ranked first with all three judges and scored highest on average (8.56; Instrument was second at 8.00). It is the only direction that is strong on ritual (edition No., headline, bylines, redaction bars), on calm (a black-and-white platform where the only color is each game's single spot ink) and on generality (a luminance-gated ink palette plus a kit that already covers word, grid, number, map, chart and quote games). It is also cheap: two variable fonts at about 87 KB, flat elevation, and motion limited to transform, opacity and clip-path. Instrument is the right engine to put under it. Both already agree on flat surfaces, one small radius, hairline rules and a 0.20–0.25 luminance band, so the two merge with no conflicting tokens. The one real weakness, coldness, is fixed with people (faces, finish times, rivals, yesterday's winner), not with decoration. That warmth lasts 300 days; confetti and candy do not. Changes from the Broadsheet proposal: the orange game ink #CF6B26 is swapped for rose #D45D87 because it sat about 13° from the house vermilion. The house vermilion is kept off every error state. All pairs below were recomputed with a WCAG script.

## Ideas worth grafting into any style

- Instrument: games declare HUD readouts as data (readouts(view) => [{label:'GUESS', value:'3/7'}]); the platform renders them as kicker-over-Newsreader cells divided by hairlines above the frame. Games never style their own status text.
- Instrument and Broadsheet: HIT/NEAR/MISS/EMPTY state vocabulary separated by luminance and shape, not hue. HIT = fg ink fill with a bg glyph (13.9:1 or better against MISS); NEAR = the game's spot ink with the 45° hatch and a 14120E glyph; MISS = surface-2 with a muted glyph; EMPTY = surface with fg cell lines. Correct and wrong verdicts also carry ✓ or ✕. Colour-blind safe by construction and consistent with the ink-plus-one-spot rule.
- Instrument: one lit control per screen. The spot-ink fill moves from the next-up Play to Start to Share; everything else is fg-outlined or ink-filled.
- Instrument and Toy Box: games never call navigator.vibrate or audio directly. They call fx.invalid/accepted/hit/solved/failed/select/announce and the platform maps each call to motion, haptics, aria-live and (later) sound, respecting the user's toggles.
- Broadsheet: fixed-width solid redaction bars for sealed results, never blur, with hidden data never sent. Revealed with a clip-path wipe after your own Final.
- Broadsheet: edition number (days since EDITION_EPOCH) in the folio, sticky bar and share text, plus fixed-template factual headlines built only from data already on screen.
- Broadsheet: 'Set by Ashwin' bylines, 'PROOF' labels for testing games, and 'The Desk' for admin, so the owner-as-setter is part of the product.
- Broadsheet: a registry.test.ts gate requiring accent relative luminance in [0.22, 0.25], no raw Tailwind palette classes under src/games, and no tabular-nums without font-num.
- Read Receipts: sealed rows show who finished and when ('finished 8:02') and who is playing, never the outcome; served by a spoiler-safe finishedBy()/dayProgress() query.
- Read Receipts, in print grammar: an 'In today's edition' row of finisher avatars with per-game spot-ink progress squares (static, no realtime, no conic rings).
- Closing Bell: every board that includes today counts only the games the viewer has finished (server-side); other friends' pending games show as a spot-ink dot with a footnote.
- Closing Bell: a depth-to-leader bar as a 2px spot-ink hairline under each agate row, with width = points ÷ leader's points.
- Closing Bell and the UX brainstorm: a dismissible 'Yesterday's final' strip on the first open of each day, and the day stamped 'Final' early once all active players have finished.
- Toy Box: finished rows settle onto surface-2 at full contrast and unplayed rows sort first, so what's left today reads at a glance.
- Card Table: a 'what the group sees' literal share preview (the clipping) and an optional backPattern per game, hashed from the id, for telling games apart once ink colours repeat past 6.
- Coin-Op: a loss ends with a countdown to the next edition rather than a red failure state.

## UX decisions — now

- **Spoiler wall: close the side doors.** One server function, getVisibleStandings(viewerId, scope, period, date), is the only way any board that includes today is built (hub, leaderboard, headline, rival line, Share my day). For each friend it hides today's points for games the viewer hasn't finished and returns them as 'pending'. The current hub and the Today leaderboard leak results today, so fix this before any visual work ships.
- **Finish sequence ownership.** The platform stages the finish: the game's final reveal (revealDone, forced at 2s), a 300ms hold, the Final box, Share focused, and only then the spoiler unseal. The current same-paint refresh() that swaps LockedResults for friends' results is replaced by a client-side SpoilerGate.
- **Focus-mode play shell.** On /play/*, hide the bottom nav and the app header. Use a 48px sticky bar (← Today, emoji and name, No. 214), the readouts strip, a message slot overlaying the top edge of the board (no layout shift), the frame sized with container queries so it never scrolls, and a controls dock padded by env(safe-area-inset-bottom). Set touch-action:manipulation and overscroll-behavior:contain.
- **Input.** A platform GameKeyboard (qwerty, numeric or custom keys; 56px keys; gutters inside the hit area; pointerdown for symbols, click for Enter; Backspace repeats while held; per-key state) plus useGameKeys for desktop keyboards. Discrete-symbol games never use native inputs. Migrate Number Hunt off <input type=number autoFocus>.
- **Latency choreography.** On submit, lock the row with a 90ms press immediately. Public-rule validation (range, duplicates, word list) runs on the client so an invalid move shakes at once; the server still re-validates. Show a spinner only after 600ms. Buffer keystrokes during a reveal. Never dim the board while a move is pending.
- **Today hub day states.** dayState drives the hub layout: fresh, in_progress, done, final. Unplayed games sort first and done rows settle. The 'done' state shows the day total, the provisional rank and Share my day, and makes the next-edition countdown prominent.
- **Leaderboard periods.** Default period is This week (Mon–Sun New York time), and the hub's mini standings are weekly too. All-time becomes a stats table (average, weeks won, best run) rather than cumulative points, which only reward seniority. Players who haven't played are collapsed into one muted line on the boards and are never ranked as zero rows.
- **Rival line.** One line under the hub standings comparing you only with the adjacent person on the weekly board, computed from spoiler-safe data.
- **Share loop.** Share text includes the edition No. and deep-links to /play/<gameId>. A combined 'Share my day' message is offered when all games are done. Registry tests enforce share grids of at most 8 columns × 6 rows using allowlisted single-codepoint emoji. The clipping preview is byte-for-byte what gets pasted.
- **Streak definition and at-risk cue.** Any one finished game keeps the run. After 8pm local with nothing finished, a quiet muted folio line appears. No red, no modal, no all-games requirement.
- **Onboarding.** A /join/<code> link prefills the invite code and shows an avatar stack of members ('Join Ashwin, Priya + 4'). After signup the user goes straight to Today, with a '👋 Rohan joined' notice for existing members. An Add-to-Home-Screen sheet appears after the first finished game.
- **Empty states.** Every empty state names a person or an action ('You could be first today', 'You're first. Results fill in as friends finish', 'Your history starts today').
- **Accessibility baseline.** State is always shown by shape or glyph as well as colour. Accent text only through accent-ink. Focus is a 2px fg outline. One polite aria-live region fed by fx.announce. Board semantics (role=grid, cell labels, arrow keys) are part of the game contract before the third game ships.
- **Reduced motion.** Honour prefers-reduced-motion and an in-app 'Reduce motion' toggle (html[data-motion=reduce], per device). Every transform and clip-path animation becomes a 120ms opacity crossfade, FLIP is skipped, and the information order stays the same.
- **Cross-device continuity.** Committed moves sync through the existing version/stale mechanism. Unscored scratch state (half-typed input, pencil marks) lives per device in localStorage under user:game:date. On focus or visibilitychange, re-fetch and show 'Picked up from your other device'. No leave-page confirms.

## UX decisions — soon

- **Haptics.** Android-only, feature-detected, fired only through fx: select 8ms, hit 12ms, reject [20,60,20], solved [15,70,15,70,40], failed 90ms. The toggle is hidden on iOS. No per-keypress buzz and no iOS switch hack.
- **Streak freeze.** Earned automatically: one ❄ per 7 straight days, bank up to 2, applied to a single missed day without any action. Computed in streaks() SQL with no stock table and nothing to buy.
- **Weekly recap and awards.** A Monday recap Notice that can be shared as text. A 👑 next to the champion's avatar for the week. 3–4 data-derived awards, at most one per person. A 'full house' day count that only ever goes up.
- **Head-to-head.** A 'You vs Sam' record on profiles: overall and per game, only on days you both played, with a last-10 strip. No challenge mechanics.
- **New-game launch and preseason.** A launch Notice with the designer note, 7 days of preseason excluded from Overall, and a one-tap difficulty vote after the result that feeds The Desk for tuning the 0–100 scoring.
- **Authoring sandbox.** /admin/sandbox/[gameId] renders fixtures at 360×640 and 390×844, with toggles for theme, high contrast and reduced motion, an 800ms latency switch and a replay-finish button. Passing its checklist is how a game moves from PROOF to live.
- **Push notifications.** Offer only after the app is installed and the person has played on 3 days. At most one notification per person per day: a streak reminder at a chosen time if nothing is played, and an optional 'Day's final'. Never at rollover and never per friend finish.

## UX decisions — later

- **Reactions.** A fixed set of 5 emoji on unsealed friend rows, visible and usable only by people who finished that game (enforced on the server). No text comments.
- **Sound.** Off by default. If built, synthesised in WebAudio from fx events, with audioSession 'ambient'. No audio files.
- **Archive play.** Past puzzles playable only from Profile, marked 🕰, never on any board and never shareable.

## UX decisions — explicitly avoid

- **Timers and speed scoring.** No solve time in the 0–100 score by default and no ticking clock in untimed games. Never build pausable timers or 'active time' heartbeats. A game that truly needs speed declares timing:'scored' and gets an honest, disclosed wall clock.
- **Guilt and shame mechanics.** No repeated daily reminders, red badges, 'your streak will die' copy, hub lists of who hasn't played, or group streaks one person can break. Losses never get harsher styling than wins.
- **Celebration excess.** No confetti, particles, count-ups, springs, full-screen win takeovers or shimmer skeletons. The reward is the friends' unseal.
- **In-app social network.** No in-app chat, comment threads, activity feed, XP, levels or badge piles. The group chat is the social space; invest in the share message and the morning recap instead.
- **Decorative chrome during play.** No grain, texture, gradients, shadows, motion or platform colour inside .puzzle-frame, and no marquee or ambient animation anywhere. The frame's only colour budget is one spot ink plus good and bad.

## Platform primitives for game authors

- Tokens in src/app/globals.css: bg/surface/surface-2/border/fg/muted/accent/good/bad (values above) plus --on-accent #14120E. In @theme inline: --color-accent-ink (color-mix oklab 66% accent → fg), --color-highlight (14% accent over surface), --color-on-accent, --font-sans: var(--font-ui), --font-serif and --font-num: var(--font-serif), --radius-card: 0.25rem. Declaring them in @theme inline is required so per-game --accent overrides re-resolve per element.
- State tokens for every game: --state-hit (fg fill, bg glyph), --state-near (accent fill + hatch, on-accent glyph), --state-miss (surface-2, muted glyph), --state-empty (surface with fg cell lines); verdicts always carry ✓/✕ glyphs in good/bad.
- Utilities: kicker, rule-heavy, rule-masthead, redact, hatch, num (font-num tabular-nums lining-nums).
- Motion tokens: --dur-press 80ms, --dur-fast 160ms, --dur-base 220ms, --dur-reveal 320ms, --dur-flip 280ms, --stagger 40ms, --dur-shake 320ms; --ease-out cubic-bezier(.2,0,0,1), --ease-in cubic-bezier(.4,0,1,1). Only transform, opacity and clip-path animate; any single move's sequence is 1.2s or less; everything collapses under prefers-reduced-motion or html[data-motion=reduce].
- <GameScreen> focus shell for /play/*: 48px sticky bar, a Readouts strip rendered from game-declared data, a MessageSlot overlay, .puzzle-frame (rounded-card border-fg bg-surface p-4, container-type inline-size, games size themselves in cqi), a controls dock with safe-area padding, and the Final box, clipping and SpoilerGate below.
- GameDefinition fields: accent (luminance in [0.22,0.25], test-enforced), emoji, section kicker (WORD/LOGIC/NUMBER/MAP/CHART/QUOTE), setBy, designerNote, readouts(view), timing:'untimed'|'scored', controlsHeight, publicValidate(move,puzzle), resultTags(state), preseasonUntil, optional backPattern.
- GameUiProps additions: fx.{invalid,accepted,select,hit,solved,failed,announce}, revealDone(), scratch.{get,set,clear} (per device, unscored), prefs.{reducedMotion,highContrast,haptics} (read-only).
- src/games/kit.tsx: Cell (crossword square, 1.5px fg lines, state prop), Tile, Key and GameKeyboard (qwerty, numeric or custom; 56px keys), LedgerRow (ruled guess history, font-num 22px), Hatch, Readout, usePointerDrag (8px slop, setPointerCapture, mandatory tap-tap fallback, touch-action:none only on draggables), useGameKeys.
- Genre rules in the kit: charts use hairline gridlines, 1.5px fg axes, one accent series and others fg/45 dashed, with font-num axis numerals; maps use surface-2 land, 0.75px fg borders, accent for the selection and hatch for eliminated regions; quotes use Newsreader 22/1.4 with a hanging accent-ink quotation mark.
- Server: getVisibleStandings(viewerId, scope, period, date), the only path for any board that includes today; dayProgress(date) giving per-user per-game status with no scores; finishedBy(gameId,date) returning profile and finished_at only; activePlayers(date, 7) for the Final stamp, the full-house count and empty states; editionNumber(date) from EDITION_EPOCH.
- Share: shareGameText() with edition No. and a /play/<gameId> deep link; shareDayText() for Share my day; grid of at most 8×6 from the emoji allowlist.
- Components: Masthead/Folio, IndexRow, AgateTable (deltas, T-ties, depth hairline, highlight row, redaction cells), FinalBox, Clipping, SpoilerGate/SealedRows, EditionRow (finisher avatars with progress squares), YesterdayFinal, RivalLine, Notice, TickStrip, Avatar (oklch low-chroma monogram).
- registry.test.ts conformance: accent luminance band; on-accent at least 4.5:1; no raw Tailwind palette classes or text-accent under src/games; no tabular-nums without font-num; share-grid size and allowlist; rules of 4 bullets or fewer.
- /admin/sandbox/[gameId] (The Desk): fixtures, two phone frames, theme, contrast and motion toggles, latency switch, replay finish; the PROOF → live checklist.

## Open taste questions for the owner

- What is the paper called? The nameplate becomes the app's identity. It should be the group's own name, not 'The Daily' (an NYT podcast name).
- HIT colour: commit to solid ink for 'correct' (calm, colour-blind safe, on-brand), or keep Wordle-style green for correct at the cost of the one-spot-ink rule?
- Is the serif-and-rules newspaper voice right for your friends? Test the hub with 2–3 of them in week one before polishing the rest.
- Weekly race scoring: plain sum of 7 days, or best 6 of 7 so one missed day doesn't knock someone out?
- Nudges: allow a '👋 Nudge' that opens the share sheet with a poke for one friend, or forbid naming non-players anywhere (the recommendation is to forbid it for v1)?
- The [0.22, 0.25] luminance band rules out bright yellows, limes and pastels for future games (yellow becomes ochre). Accept that constraint for one-hex-both-themes, or allow per-theme accent pairs with more test burden?
- Should any of your future games ever score speed (timing:'scored'), or is the paper strictly untimed?
- EDITION_EPOCH: does No. 1 start on the group's first real day, or a symbolic date?
- Light-mode newsprint grain: keep the subtle texture, or go perfectly flat paper?
- Reactions on unsealed results: worth building later, or does all banter belong in the real group chat?
