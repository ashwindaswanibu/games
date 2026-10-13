"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Countdown } from "@/components/countdown";
import { useShare } from "@/components/share-button";
import { APP_NAME } from "@/config";
import { addDays, startOfDay, type PuzzleDate } from "@/core/day";
import type { FriendDetail } from "@/core/game";
import { shareText } from "@/core/share";
import type { FriendResult } from "@/core/view";
import { IMDB_ATTRIBUTION } from "@/games/_movies/attribution";
import type { Portrait } from "@/games/_movies/schemas";
import { degrees, type DegreesPuzzle } from "../logic";
import styles from "./screen.module.css";

/** A result as a little thread: a knot per link, a mark per undo and per hint, then a star (reached) or a flag. */
export function parseChainGrid(grid: string): { links: number; undos: number; hints: number; won: boolean } {
  const count = (mark: string) => grid.split(mark).length - 1;
  return { links: count("🎞"), undos: count("✂️"), hints: count("💡"), won: grid.includes("⭐") };
}

const some = (n: number, one: string) => (n > 0 ? `, ${n} ${n === 1 ? one : `${one}s`}` : "");

export function ChainMarks({ grid, label }: { grid: string; label?: string }) {
  const { links, undos, hints, won } = parseChainGrid(grid);
  const said = label ?? `${links} ${links === 1 ? "link" : "links"}${some(undos, "undo")}${some(hints, "hint")}, ${won ? "reached" : "gave up"}`;
  return (
    <span className={styles.marks} role="img" aria-label={said}>
      <span className={styles.markKnot} />
      {Array.from({ length: links }, (_, i) => (
        <span key={i} className={styles.markLink} data-end={(won && i === links - 1) || undefined} />
      ))}
      {!won && <span className={styles.markFlag} />}
      {undos + hints > 0 && <span className={styles.markHints}>{"×".repeat(undos) + "◆".repeat(hints)}</span>}
    </span>
  );
}

/**
 * The end titles under the board (which shows the chain): how it went; the score in one lockup with
 * the moves and the little thread; sharing (spoiler-free), everyone's results; when the next pair
 * comes; and the credits as fine print (the catalog's data, IMDb; the portraits, Commons). When the
 * player's chain isn't the one the puzzle was made with, the board can show ours instead. Each line
 * is numbered (`--n`) so the titles can rise in turn.
 */
export function Credits(props: {
  puzzle: DegreesPuzzle;
  won: boolean;
  /** Moves the play used (links, undos and hints). */
  moves: number;
  result: { score: number; label: string; shareGrid: string };
  date: PuzzleDate;
  /** Whether the board can switch to our route (the player's chain differs), and which it shows. */
  ours: { available: boolean; showing: boolean; toggle(): void };
  onEveryone(): void;
  /** Opens the portraits' credits. */
  onPhotoCredits(): void;
}) {
  const { puzzle, won, moves, result, date, ours, onEveryone, onPhotoCredits } = props;
  const { share, copied } = useShare(
    shareText({ appName: APP_NAME, gameName: degrees.name, emoji: degrees.emoji, date, label: result.label, score: result.score, grid: result.shareGrid }),
  );
  const over = moves - puzzle.par;
  const kicker = !won ? "Gave up · a shortest route" : over > 0 ? `Connected · ${over} over par` : over < 0 ? "Connected · under par" : "Connected · at par";

  const line = (n: number) => ({ "--n": n }) as CSSProperties;

  return (
    <section className={styles.credits} aria-label="Today's result" data-lost={!won || undefined}>
      <p className={styles.kicker} style={line(0)}>
        {kicker}
      </p>
      <div className={styles.lockup} style={line(1)}>
        <h2 className={styles.points}>
          {result.score}
          <span className={styles.srOnly}> {result.score === 1 ? "point" : "points"}</span>
        </h2>
        <div className={styles.lockupSide}>
          <span className={styles.pointsWord} aria-hidden>
            {result.score === 1 ? "point" : "points"}
          </span>
          <span className={styles.score}>{result.label}</span>
          <ChainMarks grid={result.shareGrid} />
        </div>
      </div>
      <div className={styles.creditActions} style={line(2)}>
        <button type="button" className={styles.go} onClick={() => void share()}>
          {copied ? "Copied" : "Share"}
        </button>
        {ours.available && (
          <button type="button" className={styles.quiet} onClick={ours.toggle} aria-pressed={ours.showing}>
            {ours.showing ? "Your chain" : "Our route"}
          </button>
        )}
        <button type="button" className={styles.quiet} onClick={onEveryone} aria-haspopup="dialog">
          How everyone did
        </button>
      </div>
      <p className={styles.tomorrow} style={line(3)}>
        A new pair in <Countdown target={startOfDay(addDays(date, 1)).toISOString()} />
      </p>
      <p className={styles.finePrint} style={line(4)}>
        {IMDB_ATTRIBUTION} ·{" "}
        <button type="button" onClick={onPhotoCredits} aria-haspopup="dialog">
          Portraits: Wikimedia Commons
        </button>
      </p>
    </section>
  );
}

const isStrings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** A finished play's chain as Degrees shares it (its `friendDetail`), or null if `detail` holds none. */
function chainOf(detail: FriendDetail | undefined): { people: readonly string[]; films: readonly string[] } | null {
  const people = detail?.people;
  const films = detail?.films;
  return isStrings(people) && isStrings(films) ? { people, films } : null;
}

/** Everyone's results, in a panel over the room: each player's score and, once finished, their chain. */
export function EveryonePanel({ friends, viewerId, start, onClose }: { friends: readonly FriendResult[] | null; viewerId: string; start: string; onClose(): void }) {
  usePanel(onClose);

  return (
    <div className={styles.panelBackdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="How everyone did" onClick={(event) => event.stopPropagation()}>
        <div className={styles.panelHead}>
          <h3>How everyone did</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close" autoFocus>
            ×
          </button>
        </div>
        {friends === null ? (
          <p className={styles.panelNote}>Results are on their way. If they don&rsquo;t show, refresh the page.</p>
        ) : (
          <ol className={styles.people} aria-label="Players">
            {friends.map((f) => {
              const done = f.status === "won" || f.status === "lost";
              const chain = done ? chainOf(f.detail) : null;
              return (
                <li key={f.profile.id} data-you={f.profile.id === viewerId || undefined}>
                  <span className={styles.who}>
                    <b>{f.profile.display_name}</b>
                    <small>@{f.profile.username}</small>
                  </span>
                  {done && f.shareGrid ? (
                    <span className={styles.theirs}>
                      <span className={styles.theirResult}>
                        <ChainMarks grid={f.shareGrid} />
                        <span className={styles.personScore}>
                          {f.score ?? 0} · {f.label}
                        </span>
                      </span>
                      {chain && f.status === "won" && chain.people.length > 0 && (
                        <span className={styles.theirChain}>
                          {start}
                          {chain.people.map((name, i) => (
                            <span key={i}>
                              {" "}
                              <i>{chain.films[i]}</i> {name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className={styles.panelNote}>{f.status === "in_progress" ? "Linking…" : "Not yet"}</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * Whose faces are on the board and whose photos they are: each photo's author, license and Commons
 * page, as the license asks. Opened from the line under the console whenever faces show.
 */
export function PhotoCredits({ faces, onClose }: { faces: readonly { name: string; portrait: Portrait }[]; onClose(): void }) {
  usePanel(onClose);

  return (
    <div className={styles.panelBackdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Portraits" onClick={(event) => event.stopPropagation()}>
        <div className={styles.panelHead}>
          <h3>Portraits</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close" autoFocus>
            ×
          </button>
        </div>
        <p className={styles.panelNote}>{faces.length > 0 ? "Photos from Wikimedia Commons, cropped and toned." : "No portraits on screen yet."}</p>
        <ol className={styles.photoList}>
          {faces.map(({ name, portrait }) => (
            <li key={portrait.id}>
              <b>{name}</b>
              <span>
                {portrait.credit.author ? `${portrait.credit.author} · ` : ""}
                {portrait.credit.licenseUrl ? (
                  <a href={portrait.credit.licenseUrl} target="_blank" rel="noreferrer">
                    {portrait.credit.license}
                  </a>
                ) : (
                  portrait.credit.license
                )}
                {" · "}
                <a href={portrait.credit.source} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * A panel over the room: Escape closes it, and focus goes back to whatever opened it. (The screen
 * makes everything else inert while it's open, so focus stays inside.)
 */
function usePanel(onClose: () => void) {
  // What had focus as the panel opened, before its close button took it.
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);
}
