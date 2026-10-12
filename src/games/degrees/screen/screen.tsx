"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPuzzleDate } from "@/core/day";
import type { ImmersiveGameUiProps } from "@/core/view";
import type { FilmRef, PersonRef } from "@/games/_movies/schemas";
import { DISPLAY_FONT_VARS } from "@/components/display-font";
import {
  bestStillPossible,
  chainPersonIds,
  currentActor,
  degrees,
  filmHint,
  linkHint,
  maxMoves,
  movesLeft,
  movesUsed,
  RANK_STEP,
  SPARE_MOVES,
  TOP_SCORE,
  type DegreesHintKind,
  type DegreesLink,
  type DegreesMove,
} from "../logic";
import { Board, type BoardMode } from "./board";
import { Credits, EveryonePanel, PhotoCredits } from "./credits";
import { Slate } from "./slate";
import { threadOf, type Thread } from "./thread";
import { usePortraits } from "./use-portraits";
import styles from "./screen.module.css";

type Props = ImmersiveGameUiProps<typeof degrees>;

/** How long each of the board's live moments plays before it rests (see the stylesheet). */
const MODE_MS: Record<Exclude<BoardMode, "still">, number> = { intro: 1900, win: 3000, reveal: 2200 };
/** After the end is reached live, the end titles wait for the light to run the thread. */
const CREDITS_AFTER_MS = 2300;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The thread before the play has started, with the game written on it faintly: the two ends, one
 * knot between (par isn't known yet), and a note in each place today's names and films will take.
 */
const UNLIT: Thread = {
  knots: [
    { key: "start", kind: "start", person: null, ghost: null, note: "today's first actor" },
    { key: "ahead1", kind: "ahead", person: null, ghost: null, note: "a co-star from it" },
    { key: "end", kind: "end", person: null, ghost: null, note: "today's second actor" },
  ],
  segments: [
    { key: "ahead0", kind: "ahead", film: null, draft: false, ghost: null, note: "a film they were in" },
    { key: "ahead1", kind: "ahead", film: null, draft: false, ghost: null, note: "and on, film to film" },
  ],
  slack: 0,
  reached: false,
};

/**
 * Degrees of Separation, full screen: a dark room and a thread. Today's two actors are its ends,
 * title cards above the line with their faces large and dim behind them; each link ties a film
 * (riding the stretch) and a co-star (their face hanging under the knot) onto it. At par the
 * thread is taut; links over par are slack and it sags with them, so the cost of a long way round
 * is there to see. The next link is written on the thread where it will live (in the console on
 * narrower screens): a film the current actor was in, then a co-star from that film.
 *
 * Every link, undo and hint uses one of the day's moves (`../logic.ts`). Two hints: the way in (the
 * film a shortest route reaches the end actor through) and a next link (from where you stand). They
 * ride the thread faintly where they go. Reaching the end runs one light along the thread, each
 * knot taking it and each face its colour as it passes; then the house lights come up, the thread
 * lifts and the end titles rise. Giving up draws a shortest route in its place.
 */
export function DegreesScreen(props: Props) {
  const { view, start, submitMove, pending, notice, date, friends, viewerId } = props;
  const status = view?.status ?? null;
  const playing = status === "in_progress";
  const finished = status === "won" || status === "lost";
  const puzzle = view?.puzzle ?? null;
  const state = view?.state ?? null;
  const reveal = view?.reveal ?? null;
  const links = state?.links ?? [];

  const [draft, setDraft] = useState<{ fromId: number; film: FilmRef } | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [starting, setStarting] = useState(false);
  const [everyone, setEveryone] = useState(false);
  // The portraits' credits, while open: everyone whose face was on screen (the board and the cast's hits).
  const [photoCredits, setPhotoCredits] = useState<{ id: number; name: string }[] | null>(null);
  // Faces the cast search has shown this visit, by person (they need a credit too).
  const searchFaces = useRef(new Map<number, string>());
  const [showOurs, setShowOurs] = useState(false);
  // The slot the board leaves on the thread for the link being made (wide screens only).
  const [lineHost, setLineHost] = useState<HTMLElement | null>(null);

  // The board's live moments play only when they happen in front of the player, never on a reload.
  const [seenStatus, setSeenStatus] = useState(status);
  const [mode, setMode] = useState<BoardMode>("still");
  const [creditsUp, setCreditsUp] = useState(finished);
  // The end titles came up in front of the player (they rise line by line), not on a reload.
  const [creditsLive, setCreditsLive] = useState(false);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (seenStatus === null && status === "in_progress") setMode("intro");
    if (seenStatus === "in_progress" && status === "won") setMode("win");
    if (seenStatus === "in_progress" && status === "lost") setMode("reveal");
    if (status === "won" || status === "lost") setCreditsUp(seenStatus !== "in_progress");
  }
  useEffect(() => {
    if (mode === "still") return;
    const timer = setTimeout(() => setMode("still"), MODE_MS[mode]);
    return () => clearTimeout(timer);
  }, [mode]);
  useEffect(() => {
    if (!finished || creditsUp) return;
    const timer = setTimeout(() => {
      setCreditsUp(true);
      setCreditsLive(true);
    }, CREDITS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [finished, creditsUp]);

  const from = puzzle && state ? currentActor(puzzle, state) : null;
  // A film chosen for an actor who is no longer current (undo, or another tab moved) is dropped.
  const film = draft && from && draft.fromId === from.id ? draft.film : null;
  const wayIn = state ? filmHint(state) : null;
  const next = puzzle && state && playing ? linkHint(puzzle, state) : null;
  const limit = puzzle ? maxMoves(puzzle) : 0;
  const used = state ? movesUsed(state) : 0;
  const left = puzzle && state ? movesLeft(puzzle, state) : 0;
  const lastMove = playing && left === 1;
  const worth = puzzle && state ? bestStillPossible(puzzle, state) : 100;

  const ownRoute = !!reveal && status === "won" && !sameRoute(links, reveal.path);
  const thread: Thread =
    !puzzle || !state
      ? UNLIT
      : status === "lost" || (showOurs && ownRoute && reveal)
        ? threadOf(puzzle, reveal!.path, { open: false })
        : threadOf(puzzle, links, { open: playing, draft: film, next: next && { film: next.film, person: next.person }, wayIn: wayIn?.film ?? null });
  const showingOurs = status === "lost" || (showOurs && ownRoute);
  // A hint's film on the stretch being made (the next link's, or the way in on the last stretch).
  const hintFilm = thread.segments.find((s) => s.kind === "open")?.ghost ?? null;
  const boardLabel = showingOurs ? "A shortest route" : "Your chain";
  // Faces for everyone the board can show: both ends, the chain, a hint's co-star, our route once it's out.
  const faceIds = puzzle
    ? [
        puzzle.start.id,
        puzzle.end.id,
        ...links.map((l) => l.person.id),
        ...(next ? [next.person.id] : []),
        ...(reveal?.path.map((l) => l.person.id) ?? []),
        ...(photoCredits?.map((p) => p.id) ?? []),
      ]
    : [];
  const portraitOf = usePortraits(faceIds);
  const boardPeople = thread.knots.flatMap((knot) => {
    const who = knot.person ?? knot.ghost;
    return who ? [who] : [];
  });

  function openPhotoCredits() {
    const people = new Map(boardPeople.map((p) => [p.id, p.name]));
    for (const [id, name] of searchFaces.current) if (!people.has(id)) people.set(id, name);
    setPhotoCredits([...people].map(([id, name]) => ({ id, name })));
  }

  async function send(move: DegreesMove): Promise<boolean> {
    setError(null);
    setInteracted(true);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  async function link(person: PersonRef, via: FilmRef): Promise<boolean> {
    if (!puzzle) return false;
    const ok = await send({ type: "link", filmId: via.id, personId: person.id });
    if (ok) {
      setDraft(null);
      setAnnouncement(
        person.id === puzzle.end.id
          ? `Linked ${person.name} via ${via.title}. You reached ${puzzle.end.name} in ${plural(used + 1, "move")}.`
          : `Linked ${person.name} via ${via.title}. ${plural(left - 1, "move")} left.`,
      );
    }
    return ok;
  }

  async function undo() {
    const removed = links.at(-1);
    setDraft(null);
    // An undo leaves the moves as they were: the link's move stays spent.
    if ((await send({ type: "undo" })) && removed) setAnnouncement(`Removed the link to ${removed.person.name}. ${plural(left, "move")} left.`);
  }

  async function hint(kind: DegreesHintKind) {
    if (!(await send({ type: "hint", kind }))) return false;
    setAnnouncement(`${kind === "film" ? "The way in is" : "A next link is"} showing. ${plural(left - 1, "move")} left.`);
    return true;
  }

  async function giveUp() {
    setDraft(null);
    if (await send({ type: "give-up" })) setAnnouncement("You gave up. A shortest route is on the board.");
  }

  const today = formatPuzzleDate(date, { weekday: "short", month: "short", day: "numeric" });
  // The foot row's reading of the play.
  const meter =
    left === 0 ? (
      // Only a play from before moves were counted can get here.
      <>
        No moves left <span className={styles.dot}>·</span> give up to see a shortest route
      </>
    ) : lastMove && puzzle ? (
      <>
        Last move <span className={styles.dot}>·</span> it has to reach <em>{puzzle.end.name}</em>
      </>
    ) : (
      <>
        Move <em>{used + 1}</em> of {limit} <span className={styles.dot}>·</span> par <em>{puzzle?.par}</em> <span className={styles.dot}>·</span> worth{" "}
        <em key={worth} className={styles.worth}>
          {worth}
        </em>
      </>
    );

  return (
    <div
      className={`${DISPLAY_FONT_VARS} ${styles.screen}`}
      data-finished={finished || undefined}
      data-playing={playing || undefined}
      data-credits={(finished && creditsUp) || undefined}
    >
      {/* While a panel is open over the room, the rest of the screen is out of reach (focus stays in the panel). */}
      <div className={styles.room} aria-hidden>
        <div className={styles.lamp} />
        <div className={styles.glow} style={{ opacity: puzzle ? Math.min(1, 0.35 + (0.65 * links.length) / Math.max(1, puzzle.par)) : 0.2 }} />
        <div className={styles.vignette} />
        <div className={styles.houseLights} />
        <div className={styles.grain} />
      </div>

      <header className={styles.top} inert={everyone || photoCredits !== null}>
        <Link href="/" prefetch={true} className={styles.back} aria-label="Back to today's games">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span>Today</span>
        </Link>
        <h1 className={styles.wordmark}>
          Degrees <i>of</i> Separation
        </h1>
        <span className={styles.dateline}>
          {puzzle?.fixture && <span className={styles.fixture}>Dev fixture · </span>}
          {today}
        </span>
      </header>

      <main className={styles.stage} inert={everyone || photoCredits !== null}>
        <Board
          thread={thread}
          mode={mode}
          variant={showingOurs ? "ours" : "yours"}
          label={boardLabel}
          portraitOf={portraitOf}
          lastMove={lastMove}
          starting={starting && !view}
          line={playing ? (film ? "cast" : "film") : null}
          hostLine={setLineHost}
          onChangeFilm={() => setDraft(null)}
        />

        <section className={styles.console}>
          {!view && (
            <div className={styles.opening} data-starting={starting || undefined}>
              {/* The rules in two lines; the thread above carries how a link is made. The full rules are read with the button. */}
              <p className={styles.openingLine}>
                Par + <em>{SPARE_MOVES}</em> moves. A link or a hint uses one; undoing a link doesn&rsquo;t give its move back.
              </p>
              <p className={styles.openingLine}>
                Reach them in par for <em>{TOP_SCORE}</em>; each longer route, <em>{RANK_STEP}</em> fewer. Stuck? The way in, or the next link.
              </p>
              <ol id="degrees-rules" className={styles.srOnly}>
                {degrees.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button
                type="button"
                className={styles.roll}
                aria-describedby="degrees-rules"
                disabled={pending || starting}
                onClick={async () => {
                  setStarting(true);
                  const result = await start();
                  if (!result.ok) setStarting(false);
                }}
              >
                {pending || starting ? "Finding today's pair…" : "Start linking"}
              </button>
            </div>
          )}

          {playing && puzzle && state && from && (
            <>
              {(wayIn || next) && (
                <div className={styles.hints}>
                  {wayIn && (
                    <p className={styles.hintLine}>
                      <span className={styles.hintMark} aria-hidden>
                        ◆
                      </span>
                      The way in to {puzzle.end.name} <span className={styles.dot}>·</span> <i>{wayIn.film.title}</i>
                    </p>
                  )}
                  {next && (
                    <p className={styles.hintLine}>
                      <span className={styles.hintMark} aria-hidden>
                        ◆
                      </span>
                      From {from.name} <span className={styles.dot}>·</span> <i>{next.film.title}</i> <span aria-label="to">→</span> {next.person.name}
                      <button type="button" className={styles.useIt} disabled={pending} onClick={() => void link(next.person, next.film)}>
                        Use it
                      </button>
                    </p>
                  )}
                </div>
              )}

              <Slate
                from={from}
                end={puzzle.end}
                draft={film}
                chainIds={chainPersonIds(puzzle, state)}
                disabled={pending}
                canUndo={links.length > 0}
                canHint={left > 1}
                wayInTaken={wayIn !== null}
                hintFilm={hintFilm}
                nextShowing={next !== null}
                undoing={links.at(-1)?.person ?? null}
                focus={interacted}
                lineHost={lineHost}
                meter={meter}
                lastMove={lastMove}
                onFilm={(f) => {
                  setError(null);
                  setInteracted(true);
                  setDraft({ fromId: from.id, film: f });
                }}
                onBack={() => setDraft(null)}
                onCoStar={(person) => (film ? link(person, film) : Promise.resolve(false))}
                onUndo={undo}
                onFaces={(seen) => {
                  for (const { id, name } of seen) searchFaces.current.set(id, name);
                }}
                onHint={hint}
                onGiveUp={() => void giveUp()}
              />
            </>
          )}

          {finished && puzzle && view?.result && (
            <div className={styles.creditsWrap} data-show={creditsUp || undefined} data-live={creditsLive || undefined} inert={!creditsUp}>
              <Credits
                puzzle={puzzle}
                won={status === "won"}
                moves={used}
                result={view.result}
                date={date}
                ours={{ available: ownRoute, showing: showOurs, toggle: () => setShowOurs((s) => !s) }}
                onEveryone={() => setEveryone(true)}
                onPhotoCredits={openPhotoCredits}
              />
            </div>
          )}

          {(error ?? notice) && (
            <p role="alert" className={styles.alert}>
              {error ?? notice}
            </p>
          )}

          {playing && (
            <button type="button" className={styles.photoCreditsLink} onClick={openPhotoCredits} aria-haspopup="dialog">
              Portraits · Wikimedia Commons
            </button>
          )}
        </section>
      </main>

      {everyone && puzzle && <EveryonePanel friends={friends} viewerId={viewerId} start={puzzle.start.name} onClose={() => setEveryone(false)} />}
      {photoCredits && (
        <PhotoCredits
          faces={photoCredits.flatMap(({ id, name }) => {
            const portrait = portraitOf(id);
            return portrait ? [{ name, portrait }] : [];
          })}
          onClose={() => setPhotoCredits(null)}
        />
      )}

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** The player's chain is exactly the revealed one: same films, same co-stars, same order. */
function sameRoute(a: readonly DegreesLink[], b: readonly DegreesLink[]) {
  return a.length === b.length && a.every((link, i) => link.film.id === b[i]!.film.id && link.person.id === b[i]!.person.id);
}
