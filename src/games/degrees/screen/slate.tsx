"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IMDB_ATTRIBUTION } from "@/games/_movies/attribution";
import { filmSearchResponseSchema, personSearchResponseSchema, type FilmRef, type FilmSearchHit, type PersonRef, type PersonSearchHit } from "@/games/_movies/schemas";
import { useCatalogSearch } from "@/games/_movies/ui/use-catalog-search";
import type { DegreesHintKind } from "../logic";
import styles from "./screen.module.css";

type Confirming = DegreesHintKind | "undo" | "give-up";

/**
 * The link line: the next link is made in two steps, a film the current actor was in, then a
 * co-star from it. On a wide screen the line is written on the thread itself (`lineHost`, the slot
 * the board leaves): the film's field on the open stretch, then the co-star's under the knot it
 * ties, with the chosen film riding the stretch (it puts the film back when clicked). Narrower, the
 * line sits in the console and the film chosen rides in front of the field. Either way, Escape or
 * Backspace in the empty field puts the film back.
 *
 * Under it, the foot row: Undo, the meter (moves, par, worth), the two hints, Give up. Each move
 * asks first (an undo or a hint uses a move; giving up ends the day): the question takes the
 * line's place in the console, and the safe answer has focus.
 */
export function Slate(props: {
  from: PersonRef;
  end: PersonRef;
  draft: FilmRef | null;
  /** Everyone in the chain: shown in the cast, but not choosable. */
  chainIds: readonly number[];
  disabled: boolean;
  /** An undo or a hint may be made: there's a link to undo, and a move would still be left after. */
  canUndo: boolean;
  canHint: boolean;
  wayInTaken: boolean;
  nextShowing: boolean;
  /** A hint's film for the link being made: on the thread, the film's field reads it until something is typed. */
  hintFilm: FilmRef | null;
  /** Who an undo would take off the chain. */
  undoing: PersonRef | null;
  /** Put the cursor in the field when it mounts (only once the player has acted: it raises a phone's keyboard). */
  focus: boolean;
  /** Where the board has left room to write the line on the thread; null keeps it in the console. */
  lineHost: HTMLElement | null;
  /** The foot row's reading of the play: moves, par and worth (or the last-move warning). */
  meter: ReactNode;
  /** The play is on its last move: the meter takes the warm light. */
  lastMove: boolean;
  onFilm(film: FilmRef): void;
  onBack(): void;
  onCoStar(person: PersonRef): Promise<boolean>;
  onUndo(): Promise<unknown>;
  /** The cast's hits showed these people's faces (each needs a credit). */
  onFaces(people: readonly { id: number; name: string }[]): void;
  onHint(kind: DegreesHintKind): Promise<unknown>;
  onGiveUp(): void;
}) {
  const { from, end, draft, disabled, canUndo, canHint, wayInTaken, nextShowing, undoing, lineHost, meter, lastMove, onUndo, onHint, onGiveUp } = props;
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const backTo = useRef<Confirming | null>(null);
  const buttons = useRef<Partial<Record<Confirming, HTMLButtonElement | null>>>({});

  // Escape backs out of a question, as its quiet answer does.
  useEffect(() => {
    if (!confirming || disabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape in a panel over the room closes the panel, not this question.
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      event.preventDefault();
      backOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Back on the line, focus returns to the control the question came from.
  useEffect(() => {
    if (confirming || !backTo.current) return;
    buttons.current[backTo.current]?.focus();
    backTo.current = null;
  }, [confirming]);

  function backOut() {
    backTo.current = confirming;
    setConfirming(null);
  }

  async function answer() {
    const asked = confirming;
    if (!asked) return;
    if (asked === "give-up") {
      setConfirming(null);
      onGiveUp();
      return;
    }
    // Made or refused (the error says why), the question goes.
    await (asked === "undo" ? onUndo() : onHint(asked));
    setConfirming(null);
  }

  if (confirming) {
    const questions: Record<Confirming, { ask: string; label: string; safe: string; go: string }> = {
      film: { ask: `Show the way in to ${end.name}, a film a shortest route reaches them through? It uses a move.`, label: "Take a hint?", safe: "Keep trying", go: "Show it" },
      link: { ask: `Show a next link from ${from.name}, on a shortest route from there? It uses a move.`, label: "Take a hint?", safe: "Keep trying", go: "Show it" },
      undo: { ask: `Take ${undoing?.name ?? "the last link"} off your chain? The move that link used stays spent.`, label: "Undo?", safe: "Keep it", go: "Undo" },
      "give-up": { ask: "Give up today's chain? You'll score 0 and see a shortest route.", label: "Give up?", safe: "Keep playing", go: "Give up" },
    };
    const q = questions[confirming];
    return (
      <div key="confirm" className={styles.slateBlock}>
        <div className={styles.slate} role="group" aria-label={q.label}>
          <p className={styles.confirmText}>{q.ask}</p>
          <div className={styles.slateActions}>
            <button type="button" className={styles.quiet} disabled={disabled} onClick={backOut} autoFocus>
              {q.safe}
            </button>
            <button type="button" className={styles.go} disabled={disabled} onClick={() => void answer()}>
              {q.go}
            </button>
          </div>
        </div>
        {/* The meter stays while the question is asked (it's what the move would cost); the moves wait. */}
        <div className={styles.moves}>
          <span className={styles.meter} data-last={lastMove || undefined}>
            {meter}
          </span>
        </div>
      </div>
    );
  }

  const ask = (what: Confirming) => () => setConfirming(what);
  const keep = (what: Confirming) => (el: HTMLButtonElement | null) => {
    buttons.current[what] = el;
  };

  const placement = lineHost ? "thread" : "dock";
  const line = draft ? (
    <CastLine key={`cast-${from.id}-${draft.id}`} {...props} draft={draft} placement={placement} />
  ) : (
    <FilmLine key={`films-${from.id}`} {...props} placement={placement} />
  );

  return (
    <div key="line" className={styles.slateBlock}>
      {lineHost ? createPortal(line, lineHost) : line}
      <div className={styles.moves}>
        <button ref={keep("undo")} type="button" className={styles.quiet} disabled={disabled || !canUndo} onClick={ask("undo")}>
          <span aria-hidden>↶ </span>Undo
        </button>
        <span className={styles.meter} data-last={lastMove || undefined}>
          {meter}
        </span>
        <button
          ref={keep("film")}
          type="button"
          className={styles.hintControl}
          disabled={disabled || wayInTaken || !canHint}
          onClick={ask("film")}
          aria-label={wayInTaken ? `The way in to ${end.name}: showing` : `The way in to ${end.name}: a hint, uses a move`}
        >
          The way in{wayInTaken && <span className={styles.hintCost}>✓</span>}
        </button>
        <button
          ref={keep("link")}
          type="button"
          className={styles.hintControl}
          disabled={disabled || nextShowing || !canHint}
          onClick={ask("link")}
          aria-label={nextShowing ? "Next link: showing" : `Next link from ${from.name}: a hint, uses a move`}
        >
          Next link{nextShowing && <span className={styles.hintCost}>✓</span>}
        </button>
        <button ref={keep("give-up")} type="button" className={styles.quiet} disabled={disabled} onClick={ask("give-up")}>
          Give up
        </button>
      </div>
    </div>
  );
}

type LineProps = Parameters<typeof Slate>[0] & { placement: Placement };
/** Where the line is drawn: written on the thread, or docked in the console. */
type Placement = "thread" | "dock";

/** Step one: a film the current actor was in. */
function FilmLine({ from, disabled, focus, placement, hintFilm, onFilm }: LineProps) {
  const search = useCatalogSearch<FilmSearchHit>({
    endpoint: "/api/catalog/filmography",
    scope: { person: String(from.id) },
    responseSchema: filmSearchResponseSchema,
    disabled,
    noun: { one: "film", many: "films" },
    emptyNote: (q) => `No film with ${from.name} matches “${q}”.`,
    onSelect: (hit) => onFilm({ id: hit.id, title: hit.title, year: hit.year }),
  });
  return (
    <SearchLine
      search={search}
      // On the thread the caret waits there; docked, a phone's keyboard never comes up unasked.
      focus={focus || placement === "thread"}
      placement={placement}
      italic
      label={`A film with ${from.name}`}
      placeholder={placement === "dock" ? `A film with ${from.name}…` : hintFilm ? `◆ ${hintFilm.title}` : `a film with ${from.name}`}
      describe={(hit) => ({ primary: hit.title, secondary: [hit.year, hit.directors.slice(0, 2).join(" & ")].filter(Boolean).join(" · ") })}
      excludedNote=""
      emptyNote={(q) => `No film with ${from.name} matches “${q}”.`}
    />
  );
}

/** Step two: a co-star from the chosen film. */
function CastLine({ draft, chainIds, disabled, placement, onBack, onCoStar, onFaces }: LineProps & { draft: FilmRef }) {
  const search = useCatalogSearch<PersonSearchHit>({
    endpoint: "/api/catalog/cast",
    scope: { film: String(draft.id) },
    responseSchema: personSearchResponseSchema,
    excludeIds: chainIds,
    disabled,
    noun: { one: "person", many: "people" },
    onSelect: (hit) => void onCoStar({ id: hit.id, name: hit.name }),
  });
  // Faces the hits show, for the portraits' credits.
  const faced = search.status === "ready" && search.open ? search.results.filter((hit) => hit.portrait) : [];
  const facedKey = faced.map((hit) => hit.id).join(",");
  useEffect(() => {
    if (faced.length > 0) onFaces(faced.map((hit) => ({ id: hit.id, name: hit.name })));
    // Keyed by who is shown, not by the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facedKey]);
  return (
    <SearchLine
      search={search}
      focus
      placement={placement}
      label={`Who else is in ${draft.title}?`}
      placeholder={placement === "thread" ? "who else is in it?" : `Who else is in ${draft.title}?`}
      describe={(hit) => ({ primary: hit.name, secondary: hit.knownFor ? `Known for ${hit.knownFor}` : "", face: hit.portrait })}
      excludedNote="Already in your chain"
      emptyNote={(q) => `Nobody in the cast of ${draft.title} matches “${q}”.`}
      onBack={onBack}
      // On the thread the chosen film already rides the stretch (and puts it back when clicked).
      prefix={
        placement === "dock" && (
          <span className={styles.via}>
            <span className={styles.viaLabel}>via</span>
            <span className={styles.viaTitle}>{draft.title}</span>
            <button type="button" className={styles.viaClear} onClick={onBack} disabled={disabled} aria-label={`Change the film (${draft.title})`}>
              ×
            </button>
          </span>
        )
      }
    />
  );
}

/**
 * A catalog search drawn the room's way. Docked: a display-type field on a hairline, hits opening
 * upward over the board. On the thread: the field written where the link will live, hits hanging
 * from the line.
 */
function SearchLine<Hit extends { id: number }>(props: {
  search: ReturnType<typeof useCatalogSearch<Hit>>;
  focus: boolean;
  placement: Placement;
  italic?: boolean;
  label: string;
  placeholder: string;
  describe(hit: Hit): { primary: string; secondary: string; face?: string | null };
  excludedNote: string;
  emptyNote(query: string): string;
  prefix?: ReactNode;
  onBack?(): void;
}) {
  const { search, focus, placement, italic = false, label, placeholder, describe, excludedNote, emptyNote, prefix, onBack } = props;
  const { results, status, open, active, excluded, popupRef, listId, optionId, inputRef } = search;

  useEffect(() => {
    if (focus) inputRef.current?.focus({ preventScroll: true });
    // Only as the line mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (onBack && search.query === "" && !open && (event.key === "Escape" || event.key === "Backspace")) {
      event.preventDefault();
      onBack();
      return;
    }
    search.inputProps.onKeyDown(event);
  }

  return (
    <div className={placement === "thread" ? styles.slotLine : styles.slate} data-placement={placement}>
      {prefix}
      <div className={styles.field}>
        <label htmlFor={search.inputId} className={styles.srOnly}>
          {label}
        </label>
        <input {...search.inputProps} className={styles.input} data-italic={italic || undefined} placeholder={placeholder} onKeyDown={onKeyDown} />
        <div ref={popupRef} hidden={!open} className={styles.hits}>
          <ul id={listId} role="listbox" aria-label={label} className={styles.list}>
            {status === "ready" &&
              results.map((hit, index) => {
                const isExcluded = excluded.has(hit.id);
                const { primary, secondary, face } = describe(hit);
                return (
                  <li
                    key={hit.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={isExcluded || undefined}
                    className={styles.option}
                    data-face={face !== undefined || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (!isExcluded && index !== active) search.setActive(index);
                    }}
                    onClick={() => search.choose(index)}
                  >
                    <span className={styles.optionTitle} data-italic={italic || undefined}>
                      {primary}
                    </span>
                    {(secondary || isExcluded) && <span className={styles.optionMeta}>{isExcluded ? [excludedNote, secondary].filter(Boolean).join(" · ") : secondary}</span>}
                    {face !== undefined && (
                      <span className={styles.optionFace} aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {face && <img src={face} alt="" decoding="async" />}
                      </span>
                    )}
                  </li>
                );
              })}
            {status === "ready" && results.length === 0 && (
              <li role="presentation" className={styles.listNote}>
                {emptyNote(search.query.trim())}
              </li>
            )}
            {status === "loading" && (
              <li role="presentation" className={styles.listNote}>
                Searching…
              </li>
            )}
            {status === "error" && (
              <li role="presentation" className={styles.listNote}>
                {search.error}
              </li>
            )}
          </ul>
          {status === "ready" && results.length > 0 && (
            <p aria-hidden className={styles.listCredit} onMouseDown={(event) => event.preventDefault()}>
              {IMDB_ATTRIBUTION}
            </p>
          )}
        </div>
        <p className={styles.srOnly} role="status" aria-live="polite">
          {open ? search.announcement : ""}
        </p>
      </div>
    </div>
  );
}
