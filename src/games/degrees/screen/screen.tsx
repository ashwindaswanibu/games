"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPuzzleDate } from "@/core/day";
import type { ImmersiveGameUiProps } from "@/core/view";
import type { FilmRef, PersonRef } from "@/games/_movies/schemas";
import { DISPLAY_FONT_VARS } from "@/games/_movies/ui/display-font";
import {
  chainPersonIds,
  currentActor,
  degrees,
  filmHint,
  HINT_COST,
  hintsOf,
  linkHint,
  maxLinks,
  worthAt,
  type DegreesHintKind,
  type DegreesLink,
  type DegreesMove,
} from "../logic";
import { Board, type BoardMode } from "./board";
import { Credits, EveryonePanel } from "./credits";
import { Slate } from "./slate";
import { threadOf, type Thread } from "./thread";
import styles from "./screen.module.css";

type Props = ImmersiveGameUiProps<typeof degrees>;

/** How long each of the board's live moments plays before it rests (see the stylesheet). */
const MODE_MS: Record<Exclude<BoardMode, "still">, number> = { intro: 1900, win: 2600, reveal: 2200 };
/** After the end is reached live, the end card waits for the light to run the thread. */
const CREDITS_AFTER_MS = 1700;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The thread before the play has started: two ends and par's knots, nobody named yet. */
const UNLIT: Thread = {
  knots: [
    { key: "start", kind: "start", person: null, ghost: null },
    { key: "ahead1", kind: "ahead", person: null, ghost: null },
    { key: "ahead2", kind: "ahead", person: null, ghost: null },
    { key: "end", kind: "end", person: null, ghost: null },
  ],
  segments: Array.from({ length: 3 }, (_, i) => ({ key: `ahead${i}`, kind: "ahead" as const, film: null, draft: false, ghost: null })),
  slack: 0,
  reached: false,
};

/**
 * Degrees of Separation, full screen: a dark room and a thread. Today's two actors are its ends;
 * each link ties a film and a co-star onto it. At par the thread is taut; links over par are slack
 * and it sags with them, so the cost of a long way round is there to see. The next link is made in
 * the console under it: a film the current actor was in, then a co-star from that film.
 *
 * Two hints, each asked for and paid for: the way in (the film a shortest route reaches the end
 * actor through) and a next link (from where you stand). They ride the thread faintly where they
 * go. Reaching the end runs a light along the thread before the end card comes up; giving up draws
 * a shortest route in its place.
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
  const [showOurs, setShowOurs] = useState(false);

  // The board's live moments play only when they happen in front of the player, never on a reload.
  const [seenStatus, setSeenStatus] = useState(status);
  const [mode, setMode] = useState<BoardMode>("still");
  const [creditsUp, setCreditsUp] = useState(finished);
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
    const timer = setTimeout(() => setCreditsUp(true), CREDITS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [finished, creditsUp]);

  const from = puzzle && state ? currentActor(puzzle, state) : null;
  // A film chosen for an actor who is no longer current (undo, or another tab moved) is dropped.
  const film = draft && from && draft.fromId === from.id ? draft.film : null;
  const wayIn = state ? filmHint(state) : null;
  const next = puzzle && state && playing ? linkHint(puzzle, state) : null;
  const limit = puzzle ? maxLinks(puzzle) : 0;
  const left = Math.max(0, limit - links.length);
  const lastLink = playing && links.length === limit - 1;
  const worth = puzzle && state ? worthAt(puzzle, state, links.length + 1) : 100;

  const ownRoute = !!reveal && status === "won" && !sameRoute(links, reveal.path);
  const thread: Thread =
    !puzzle || !state
      ? UNLIT
      : status === "lost" || (showOurs && ownRoute && reveal)
        ? threadOf(puzzle, reveal!.path, { open: false })
        : threadOf(puzzle, links, { open: playing, draft: film, next: next && { film: next.film, person: next.person }, wayIn: wayIn?.film ?? null });
  const showingOurs = status === "lost" || (showOurs && ownRoute);
  const boardLabel = showingOurs ? "A shortest route" : "Your chain";

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
      const used = links.length + 1;
      setAnnouncement(
        person.id === puzzle.end.id
          ? `Linked ${person.name} via ${via.title}. You reached ${puzzle.end.name} in ${plural(used, "link")}.`
          : `Linked ${person.name} via ${via.title}. ${plural(limit - used, "link")} left.`,
      );
    }
    return ok;
  }

  async function undo() {
    const removed = links.at(-1);
    setDraft(null);
    if ((await send({ type: "undo" })) && removed) setAnnouncement(`Removed the link to ${removed.person.name}. ${plural(left + 1, "link")} left.`);
  }

  async function hint(kind: DegreesHintKind) {
    if (!(await send({ type: "hint", kind }))) return false;
    setAnnouncement(kind === "film" ? `Hint taken: the way in, ${HINT_COST.film} points.` : `Hint taken: a next link, ${HINT_COST.link} points.`);
    return true;
  }

  async function giveUp() {
    setDraft(null);
    if (await send({ type: "give-up" })) setAnnouncement("You gave up. A shortest route is on the board.");
  }

  const today = formatPuzzleDate(date, { weekday: "short", month: "short", day: "numeric" });
  const hints = state ? hintsOf(state) : [];

  return (
    <div className={`${DISPLAY_FONT_VARS} ${styles.screen}`} data-finished={finished || undefined} data-playing={playing || undefined}>
      <div className={styles.room} aria-hidden>
        <div className={styles.lamp} />
        <div className={styles.glow} style={{ opacity: puzzle ? Math.min(1, 0.35 + (0.65 * links.length) / Math.max(1, puzzle.par)) : 0.2 }} />
        <div className={styles.vignette} />
        <div className={styles.grain} />
      </div>

      <header className={styles.top}>
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

      <main className={styles.stage}>
        <Board thread={thread} mode={mode} variant={showingOurs ? "ours" : "yours"} label={boardLabel} />

        <section className={styles.console}>
          {!view && (
            <div className={styles.opening}>
              <ol className={styles.rules}>
                {degrees.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button
                type="button"
                className={styles.roll}
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
              <p className={styles.status}>
                {lastLink ? (
                  <>
                    Last link <span className={styles.dot}>·</span> it has to reach <em>{puzzle.end.name}</em>
                  </>
                ) : (
                  <>
                    Link <em>{links.length + 1}</em> of {limit} <span className={styles.dot}>·</span> par <em>{puzzle.par}</em>
                    <span className={styles.dot}>·</span> worth{" "}
                    <em key={worth} className={styles.worth}>
                      {worth}
                    </em>
                  </>
                )}
              </p>

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
                wayInTaken={wayIn !== null}
                nextShowing={next !== null}
                lastLink={lastLink}
                focus={interacted}
                onFilm={(f) => {
                  setError(null);
                  setInteracted(true);
                  setDraft({ fromId: from.id, film: f });
                }}
                onBack={() => setDraft(null)}
                onCoStar={(person) => (film ? link(person, film) : Promise.resolve(false))}
                onUndo={() => void undo()}
                onHint={hint}
                onGiveUp={() => void giveUp()}
              />
            </>
          )}

          {finished && puzzle && view?.result && (
            <div className={styles.creditsWrap} data-show={creditsUp || undefined} inert={!creditsUp}>
              <Credits
                puzzle={puzzle}
                won={status === "won"}
                links={links.length}
                result={view.result}
                date={date}
                ours={{ available: ownRoute, showing: showOurs, toggle: () => setShowOurs((s) => !s) }}
                onEveryone={() => setEveryone(true)}
              />
            </div>
          )}

          {(error ?? notice) && (
            <p role="alert" className={styles.alert}>
              {error ?? notice}
            </p>
          )}
        </section>
      </main>

      {everyone && puzzle && <EveryonePanel friends={friends} viewerId={viewerId} start={puzzle.start.name} onClose={() => setEveryone(false)} />}

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
        {hints.length > 0 && playing ? ` ${plural(hints.length, "hint")} taken.` : ""}
      </p>
    </div>
  );
}

/** The player's chain is exactly the revealed one: same films, same co-stars, same order. */
function sameRoute(a: readonly DegreesLink[], b: readonly DegreesLink[]) {
  return a.length === b.length && a.every((link, i) => link.film.id === b[i]!.film.id && link.person.id === b[i]!.person.id);
}
