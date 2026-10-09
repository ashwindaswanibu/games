"use client";

import { useEffect } from "react";
import { z } from "zod";
import { useShare } from "@/components/share-button";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
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
 * The end card under the board (which shows the chain): how it went, the score, sharing
 * (spoiler-free), everyone's results, and the catalog's data credit (IMDb). When the player's chain
 * isn't the one the puzzle was made with, the board can show ours instead.
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
}) {
  const { puzzle, won, moves, result, date, ours, onEveryone } = props;
  const { share, copied } = useShare(
    shareText({ appName: APP_NAME, gameName: degrees.name, emoji: degrees.emoji, date, label: result.label, score: result.score, grid: result.shareGrid }),
  );
  const over = moves - puzzle.par;
  const kicker = !won ? "Gave up · a shortest route" : over > 0 ? `Connected · ${over} over par` : over < 0 ? "Connected · under par" : "Connected · at par";

  return (
    <section className={styles.credits} aria-label="Today's result">
      <p className={styles.kicker}>{kicker}</p>
      <h2 className={styles.points}>
        {result.score}
        <small>{result.score === 1 ? "point" : "points"}</small>
      </h2>
      <div className={styles.creditActions}>
        <span className={styles.result}>
          <ChainMarks grid={result.shareGrid} />
          <span className={styles.score}>{result.label}</span>
        </span>
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
      <p className={styles.dataCredit}>{IMDB_ATTRIBUTION}</p>
    </section>
  );
}

const chainDetail = z.object({ people: z.array(z.string()), films: z.array(z.string()) });

/** Everyone's results, in a panel over the room: each player's score and, once finished, their chain. */
export function EveryonePanel({ friends, viewerId, start, onClose }: { friends: readonly FriendResult[] | null; viewerId: string; start: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
              const chain = done ? chainDetail.safeParse(f.detail) : null;
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
                      {chain?.success && f.status === "won" && chain.data.people.length > 0 && (
                        <span className={styles.theirChain}>
                          {start}
                          {chain.data.people.map((name, i) => (
                            <span key={i}>
                              {" "}
                              <i>{chain.data.films[i]}</i> {name}
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.panelBackdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Portraits" onClick={(event) => event.stopPropagation()}>
        <div className={styles.panelHead}>
          <h3>Portraits</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close" autoFocus>
            ×
          </button>
        </div>
        <p className={styles.panelNote}>Photos from Wikimedia Commons, cropped and toned.</p>
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
