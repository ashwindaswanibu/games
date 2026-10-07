"use client";

import { useEffect, useState } from "react";
import { useShare } from "@/components/share-button";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
import type { Outcome } from "@/core/game";
import { shareText } from "@/core/share";
import type { FriendResult } from "@/core/view";
import type { FilmDetails } from "@/games/_movies/schemas";
import { fadeToColor, LEVEL_COUNT, type State } from "../logic";
import { describeGrid, endKicker, parseGrid } from "./grid";
import styles from "./theater.module.css";
import { BarcodeTitle } from "./wordmark";

/**
 * One result as ten little frames: how each reel went, then unexposed film. A pick is a round mark:
 * inside the frame of the reel the film was stopped on (the rest stayed in the can), or set a
 * little apart after the tenth when the reels ran out. Filled with the light if right; a dark ring
 * if wrong.
 */
export function ResultFrames({ grid, label }: { grid: string; label?: string }) {
  const marks = parseGrid(grid);
  const stoppedAt = marks.pick && marks.reels.length < LEVEL_COUNT ? marks.reels.length : null;
  return (
    <span className={styles.frames} role="img" aria-label={label ?? describeGrid(marks)}>
      {Array.from({ length: LEVEL_COUNT }, (_, i) => (
        <span key={i} data-mark={marks.reels[i] ?? "none"} data-pick={i === stoppedAt ? marks.pick : undefined} />
      ))}
      {marks.pick && stoppedAt === null && <span className={styles.pickMark} data-pick={marks.pick} />}
    </span>
  );
}

/**
 * The end card under the reel: the film's title cut out of its own barcode, who made it, the
 * result, sharing (spoiler-free) and everyone else's results. (The frames' source is credited on
 * the reel's edge.)
 */
export function Credits(props: {
  film: FilmDetails;
  state: State;
  status: Outcome;
  result: { score: number; label: string; shareGrid: string };
  fill: string | null;
  date: PuzzleDate;
  friends: readonly FriendResult[] | null;
  viewerId: string;
}) {
  const { film, state, status, result, fill, date, friends, viewerId } = props;
  const { share, copied } = useShare(
    shareText({
      appName: APP_NAME,
      gameName: fadeToColor.name,
      emoji: fadeToColor.emoji,
      date,
      label: result.label,
      score: result.score,
      grid: result.shareGrid,
    }),
  );
  const [showFriends, setShowFriends] = useState(false);
  const byline = [film.directors.slice(0, 2).join(" & "), film.year].filter(Boolean).join(" · ");

  return (
    <section className={styles.credits} aria-label="Today's film">
      <p className={styles.kicker}>{endKicker(state, status)}</p>
      {/* Colour is what you earn: a film that got away is titled in plain ink. */}
      <BarcodeTitle text={film.title} fill={status === "won" ? fill : null} />
      {byline && <p className={styles.byline}>{byline}</p>}
      <div className={styles.creditActions}>
        <span className={styles.result}>
          <ResultFrames grid={result.shareGrid} />
          <span className={styles.score}>
            {result.label} · {result.score} pts
          </span>
        </span>
        <button type="button" className={styles.go} onClick={() => void share()}>
          {copied ? "Copied" : "Share"}
        </button>
        <button type="button" className={styles.quiet} onClick={() => setShowFriends(true)} aria-haspopup="dialog">
          How everyone did
        </button>
      </div>
      {showFriends && <FriendsPanel friends={friends} viewerId={viewerId} onClose={() => setShowFriends(false)} />}
    </section>
  );
}

/** Everyone's results for today's film, in a panel over the room. */
function FriendsPanel({ friends, viewerId, onClose }: { friends: readonly FriendResult[] | null; viewerId: string; onClose(): void }) {
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
          <ol className={styles.people}>
            {friends.map((f) => {
              const done = f.status === "won" || f.status === "lost";
              return (
                <li key={f.profile.id} data-you={f.profile.id === viewerId || undefined}>
                  <span className={styles.who}>
                    <b>{f.profile.display_name}</b>
                    <small>@{f.profile.username}</small>
                  </span>
                  {done && f.shareGrid ? (
                    <>
                      <ResultFrames grid={f.shareGrid} />
                      <span className={styles.personScore}>{f.label}</span>
                    </>
                  ) : (
                    <span className={styles.panelNote}>{f.status === "in_progress" ? "Watching…" : "Not yet"}</span>
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
