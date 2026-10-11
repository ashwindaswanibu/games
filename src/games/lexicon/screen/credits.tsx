"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useShare } from "@/components/share-button";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
import { shareText } from "@/core/share";
import type { FriendResult } from "@/core/view";
import { lexicon, type LexiconReveal } from "../logic";
import styles from "./screen.module.css";

/** The sources' credit, wherever today's dictionary is shown. */
export const WORDS_CREDIT = "Words: 12dicts by Alan Beale (AGID © Kevin Atkinson). Definitions: WordNet 3.1 © Princeton University.";

/**
 * The page the book opened at: today's word as a dictionary prints it (headword, part of speech,
 * definition), then how it went, the score, sharing (spoiler-free), everyone's results and the
 * sources' credit.
 */
export function Entry(props: {
  reveal: LexiconReveal;
  won: boolean;
  guesses: number;
  result: { score: number; label: string; shareGrid: string };
  date: PuzzleDate;
  onEveryone(): void;
}) {
  const { reveal, won, guesses, result, date, onEveryone } = props;
  const { share, copied } = useShare(
    shareText({ appName: APP_NAME, gameName: lexicon.name, emoji: lexicon.emoji, date, label: result.label, score: result.score, grid: result.shareGrid }),
  );
  return (
    <section className={styles.entry} aria-label="Today's word">
      <p className={styles.kicker}>{won ? `Found on guess ${guesses}` : "Today's word was"}</p>
      <h2 className={styles.headword}>{reveal.answer}</h2>
      <p className={styles.definition}>
        <i>{reveal.entry.pos}</i> {reveal.entry.definition}
      </p>
      <div className={styles.entryActions}>
        <span className={styles.points}>
          {result.score}
          <small>{result.score === 1 ? "point" : "points"}</small>
        </span>
        <button type="button" className={styles.go} onClick={() => void share()}>
          {copied ? "Copied" : "Share"}
        </button>
        <button type="button" className={styles.quiet} onClick={onEveryone} aria-haspopup="dialog">
          How everyone did
        </button>
      </div>
      <p className={styles.perfect}>Halving perfectly, today&rsquo;s dictionary takes at most {reveal.perfect} guesses.</p>
      <p className={styles.credit}>{WORDS_CREDIT}</p>
    </section>
  );
}

const guessesDetail = z.object({ guesses: z.array(z.string()) });

/** One result's marks: ▸ after, ◂ before, ◆ found, and a flag for giving up. */
function Marks({ grid }: { grid: string }) {
  return (
    <span className={styles.marks} aria-hidden>
      {grid}
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
