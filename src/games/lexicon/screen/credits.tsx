"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { FriendResult } from "@/core/view";
import styles from "./screen.module.css";

/** The sources' credit, wherever today's dictionary is shown. */
export const WORDS_CREDIT = "Words: 12dicts by Alan Beale (AGID © Kevin Atkinson). Definitions: WordNet 3.1 © Princeton University.";

const guessesDetail = z.object({ guesses: z.array(z.string()) });

/**
 * One result's guesses as ribbons, from its share marks: red for each guess today's word was after
 * (▸) or before (◂), bone for the one that found it (◆). Giving up's flag draws nothing: the label
 * beside it says so.
 */
function Marks({ grid }: { grid: string }) {
  const marks = [...grid].filter((ch) => ch === "▸" || ch === "◂" || ch === "◆");
  return (
    <span className={styles.marks} aria-hidden>
      {marks.map((ch, i) => (
        <i key={i} data-found={ch === "◆" || undefined} />
      ))}
    </span>
  );
}

/** Everyone's results in a panel over the room: score and, once finished, the words they tried. */
export function EveryonePanel({ friends, viewerId, onClose }: { friends: readonly FriendResult[] | null; viewerId: string; onClose(): void }) {
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
              const detail = done ? guessesDetail.safeParse(f.detail) : null;
              return (
                <li key={f.profile.id} data-you={f.profile.id === viewerId || undefined}>
                  <span className={styles.who}>
                    <b>{f.profile.display_name}</b>
                    <small>@{f.profile.username}</small>
                  </span>
                  {done && f.shareGrid ? (
                    <span className={styles.theirs}>
                      <span className={styles.theirResult}>
                        <Marks grid={f.shareGrid} />
                        <span className={styles.personScore}>
                          {f.score ?? 0} · {f.label}
                        </span>
                      </span>
                      {detail?.success && detail.data.guesses.length > 0 && <span className={styles.theirWords}>{detail.data.guesses.join(" · ")}</span>}
                    </span>
                  ) : (
                    <span className={styles.panelNote}>{f.status === "in_progress" ? "Guessing…" : "Not yet"}</span>
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
