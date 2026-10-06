"use client";

import { useState, type ReactNode } from "react";
import type { GameUiProps } from "@/core/view";
import type { FilmRef, FilmSearchHit, PersonRef } from "@/games/_movies/schemas";
import { FilmSearch, LiveStatus, MoviesButton, MoviesStage, PersonSearch } from "@/games/_movies/ui";
import { chainPersonIds, currentActor, degrees, maxLinks, type DegreesLink } from "./logic";
import styles from "./degrees.module.css";

type Props = GameUiProps<typeof degrees>;

/** A film picked for the next link, remembered with the actor it was picked for. */
interface PendingFilm {
  fromId: number;
  film: FilmRef;
}

/**
 * The board: the chain as a sequence of title cards (start actor, then film → co-star splices),
 * ending at the destination card. While playing, the next link is built in two steps between the
 * chain and the destination: a film from the current actor's filmography, then a co-star from it.
 */
export function DegreesUi({ view, submitMove, pending }: Props) {
  const { puzzle, state, status, reveal } = view;
  const [pendingFilm, setPendingFilm] = useState<PendingFilm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingGiveUp, setConfirmingGiveUp] = useState(false);
  // What a screen reader hears after each move (the visible chain says the same thing).
  const [announcement, setAnnouncement] = useState("");
  // Cards added after the board first rendered get an entrance; the restored chain doesn't.
  const [initialLinkCount] = useState(state.links.length);
  // Focus the next search only after the player has acted, never on page load (it pops the keyboard).
  const [interacted, setInteracted] = useState(false);

  const playing = status === "in_progress";
  const limit = maxLinks(puzzle);
  const linksLeft = Math.max(0, limit - state.links.length);
  const from = currentActor(puzzle, state);
  const inChain = chainPersonIds(puzzle, state);
  // A film picked for an actor who is no longer current (undo, or another tab moved) is dropped.
  const film = pendingFilm && pendingFilm.fromId === from.id ? pendingFilm.film : null;
  const lastLink = playing && state.links.length === limit - 1;

  async function send(move: Parameters<Props["submitMove"]>[0]): Promise<boolean> {
    setError(null);
    setInteracted(true);
    const result = await submitMove(move);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  function pickFilm(hit: FilmSearchHit) {
    setError(null);
    setInteracted(true);
    setPendingFilm({ fromId: from.id, film: { id: hit.id, title: hit.title, year: hit.year } });
  }

  async function pickCoStar(person: PersonRef) {
    if (!film) return;
    if (await send({ type: "link", filmId: film.id, personId: person.id })) {
      setPendingFilm(null);
      const used = state.links.length + 1;
      const left = limit - used;
      setAnnouncement(
        person.id === puzzle.end.id
          ? `Linked ${person.name} via ${film.title}. You reached ${puzzle.end.name} in ${plural(used, "link")}.`
          : `Linked ${person.name} via ${film.title}. ${plural(left, "link")} left.`,
      );
    }
  }

  async function undo() {
    setPendingFilm(null);
    const removed = state.links.at(-1);
    if ((await send({ type: "undo" })) && removed) {
      setAnnouncement(`Removed the link to ${removed.person.name}. ${plural(linksLeft + 1, "link")} left.`);
    }
  }

  async function giveUp() {
    setConfirmingGiveUp(false);
    setPendingFilm(null);
    if (await send({ type: "give-up" })) setAnnouncement("You gave up. A shortest route is shown below.");
  }

  return (
    <MoviesStage
      title="Degrees of Separation"
      kicker={`Par ${puzzle.par}`}
      compact={playing}
      countdown={playing ? { value: linksLeft, label: linksLeft === 1 ? "link left" : "links left" } : undefined}
      devFixture={puzzle.fixture}
    >
      <p className={styles.brief}>
        {playing ? (
          <>
            Link <strong>{puzzle.start.name}</strong> to <strong>{puzzle.end.name}</strong> through films they shared. Par is{" "}
            {puzzle.par} links; you can use up to {limit}.
          </>
        ) : status === "won" ? (
          <>
            <span aria-hidden>★ </span>Connected in <strong>{plural(state.links.length, "link")}</strong>
            {state.links.length <= puzzle.par ? ", right on par." : `. Par was ${puzzle.par}.`}
          </>
        ) : (
          <>
            You gave up {state.links.length === 0 ? "before your first link" : `after ${plural(state.links.length, "link")}`}. Here&apos;s a
            route of {puzzle.par} links.
          </>
        )}
      </p>

      <ol className={styles.sequence} aria-label="Your chain">
        <li className={styles.item}>
          <PersonCard person={puzzle.start} role="start" label="Start" index="A" />
        </li>
        {state.links.map((link, i) => {
          const reachedEnd = link.person.id === puzzle.end.id;
          return (
            <li key={`${i}-${link.film.id}-${link.person.id}`} className={styles.item} data-fresh={i >= initialLinkCount || undefined}>
              <FilmSplice film={link.film} index={i + 1} />
              <PersonCard
                person={link.person}
                role={reachedEnd ? "reached" : "step"}
                label={reachedEnd ? "Destination reached" : `Co-star ${i + 1}`}
                index={String(i + 1)}
              />
            </li>
          );
        })}

        {playing && (
          <li className={`${styles.item} ${styles.building}`} aria-label={`Link ${state.links.length + 1}, in progress`}>
            <div className={styles.builder}>
              {film ? (
                <>
                  <FilmSplice
                    film={film}
                    index={state.links.length + 1}
                    draft
                    action={
                      <MoviesButton kind="quiet" onClick={() => setPendingFilm(null)} disabled={pending}>
                        Change
                      </MoviesButton>
                    }
                  />
                  <PersonSearch
                    key={`cast-${film.id}`}
                    inFilm={film.id}
                    label={`Who else is in ${film.title}?`}
                    placeholder="Search the cast"
                    excludeIds={inChain}
                    excludedNote="Already in your chain"
                    emptyNote={(q) => `Nobody in the cast of ${film.title} matches “${q}”.`}
                    onSelect={pickCoStar}
                    disabled={pending}
                    autoFocus
                  />
                </>
              ) : (
                <FilmSearch
                  key={`films-${from.id}`}
                  withPerson={from.id}
                  label={`A film with ${from.name}`}
                  placeholder="Search their films"
                  emptyNote={(q) => `No film with ${from.name} matches “${q}”.`}
                  onSelect={pickFilm}
                  disabled={pending}
                  autoFocus={interacted}
                />
              )}
              <p className={styles.step}>
                <span className={styles.stepMark} aria-hidden>
                  {film ? "◆" : "◇"}
                </span>
                {film ? `Step 2 of 2: pick a co-star of ${from.name}'s from ${film.title}.` : `Step 1 of 2: pick a film ${from.name} was in.`}
              </p>
              {lastLink && (
                <p className={styles.warning}>
                  <span aria-hidden>! </span>Last link: it has to reach {puzzle.end.name}.
                </p>
              )}
            </div>
          </li>
        )}

        {status !== "won" && (
          <li className={styles.item}>
            {playing && (
              <p className={styles.gap} aria-hidden>
                {linksLeft} more {linksLeft === 1 ? "link" : "links"} at most
              </p>
            )}
            <PersonCard person={puzzle.end} role="target" label={playing ? "Destination" : "Destination, not reached"} index="B" />
          </li>
        )}
      </ol>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {playing &&
        (confirmingGiveUp ? (
          <div className={styles.confirm} role="group" aria-label="Give up?">
            <p>Give up today&apos;s chain? You&apos;ll score 0 and see a shortest route.</p>
            <div className={styles.controls}>
              <MoviesButton kind="primary" onClick={giveUp} disabled={pending}>
                Give up
              </MoviesButton>
              <MoviesButton kind="secondary" onClick={() => setConfirmingGiveUp(false)} disabled={pending}>
                Keep playing
              </MoviesButton>
            </div>
          </div>
        ) : (
          <div className={styles.controls}>
            <MoviesButton kind="secondary" onClick={undo} disabled={pending || state.links.length === 0}>
              <span aria-hidden>↶</span> Undo last link
            </MoviesButton>
            <MoviesButton kind="quiet" onClick={() => setConfirmingGiveUp(true)} disabled={pending}>
              Give up
            </MoviesButton>
          </div>
        ))}

      {reveal && (
        <section className={styles.reveal} aria-labelledby="degrees-reveal">
          <h3 id="degrees-reveal" className={styles.revealTitle}>
            {sameRoute(state.links, reveal.path)
              ? `Our route matches yours · par ${puzzle.par}`
              : status === "won" && state.links.length <= puzzle.par
                ? `Our route, also at par ${puzzle.par}`
                : `A shortest route · ${plural(puzzle.par, "link")}`}
          </h3>
          <ol className={styles.revealList}>
            <li>
              <span className={styles.revealPerson}>{puzzle.start.name}</span>
            </li>
            {reveal.path.map((link: DegreesLink, i) => (
              <li key={`${link.film.id}-${link.person.id}`}>
                <span className={styles.revealFilm}>
                  {link.film.title}
                  {link.film.year ? ` (${link.film.year})` : ""}
                </span>
                <span className={styles.revealPerson} data-end={i === reveal.path.length - 1 || undefined}>
                  {link.person.name}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <LiveStatus message={announcement} />
    </MoviesStage>
  );
}

/** The player's chain is exactly the revealed one: same films, same co-stars, same order. */
function sameRoute(a: readonly DegreesLink[], b: readonly DegreesLink[]) {
  return a.length === b.length && a.every((link, i) => link.film.id === b[i]!.film.id && link.person.id === b[i]!.person.id);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

type PersonRole = "start" | "step" | "target" | "reached";

/** An actor's title card. The role is spelled out in `label`, never shown by color alone. */
function PersonCard({ person, role, label, index }: { person: PersonRef; role: PersonRole; label: string; index: string }) {
  return (
    <div className={styles.person} data-role={role}>
      <span className={styles.personIndex} aria-hidden>
        {role === "reached" ? "★" : index}
      </span>
      <span className={styles.personText}>
        <span className={styles.personLabel}>{label}</span>
        <span className={styles.personName}>{person.name}</span>
      </span>
    </div>
  );
}

/** The film a link passes through: a strip of film between two title cards. */
function FilmSplice({ film, index, draft = false, action }: { film: FilmRef; index: number; draft?: boolean; action?: ReactNode }) {
  return (
    <div className={styles.splice} data-draft={draft || undefined}>
      <span className={styles.spliceText}>
        <span className={styles.spliceLabel}>{draft ? `Link ${index} · film chosen` : `Link ${index} · via`}</span>
        <span className={styles.spliceTitle}>
          {film.title}
          {film.year ? <span className={styles.spliceYear}> {film.year}</span> : null}
        </span>
      </span>
      {action}
    </div>
  );
}
