"use client";

import { useState, type ReactNode } from "react";
import { ShareButton } from "@/components/share-button";
import { buttonClass, Card } from "@/components/ui";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
import { shareText } from "@/core/share";
import type { PlayView } from "@/core/view";
import { GameUiProvider } from "@/games/game-ui-context";
import { startGame, submitMove } from "./actions";

/**
 * Platform side of the play screen: owns the authoritative `view`, talks to the server, and
 * renders the game's own UI (`children`, chosen by the server page) plus the start and result
 * panels around it. The UI gets its props from `GameUiProvider`.
 */
export function GameHost(props: {
  gameId: string;
  gameName: string;
  emoji: string;
  rules: readonly string[];
  date: PuzzleDate;
  initialView: PlayView | null;
  /** The game's connected UI (see `connectGameUi`). */
  children: ReactNode;
}) {
  const { gameId, gameName, emoji, rules, date } = props;
  const [view, setView] = useState(props.initialView);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setNotice(null);
    try {
      const res = await startGame(gameId, date);
      if (res.ok) setView(res.view);
      else setNotice(res.message);
    } catch {
      setNotice("Couldn't start the game. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function move(m: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!view) return { ok: false, message: "Start the game first." };
    setPending(true);
    setNotice(null);
    try {
      const res = await submitMove(gameId, date, view.version, m);
      if (res.ok) {
        setView(res.view);
        return { ok: true };
      }
      if (res.view) setView(res.view);
      // Game-level rejections are shown by the game's UI; platform-level ones by the host.
      if (res.reason !== "invalid_move") setNotice(res.message);
      return { ok: false, message: res.message };
    } catch {
      const message = "Couldn't reach the server. Try again.";
      setNotice(message);
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  }

  if (!view) {
    return (
      <Card className="grid gap-5 p-6">
        <ul className="grid gap-2 text-sm">
          {rules.map((rule) => (
            <li key={rule} className="flex gap-2">
              <span className="text-accent">•</span>
              {rule}
            </li>
          ))}
        </ul>
        {notice && <p className="text-sm text-bad">{notice}</p>}
        <button type="button" onClick={start} disabled={pending} className={buttonClass("accent", "w-full")}>
          {pending ? "Loading…" : "Start"}
        </button>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {notice && (
        <p role="status" className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
          {notice}
        </p>
      )}
      <GameUiProvider value={{ view, submitMove: move, pending }}>{props.children}</GameUiProvider>
      {view.result && (
        <Card className="grid gap-4 p-5 text-center">
          <div>
            <p className="text-sm text-muted">{view.status === "won" ? "Solved" : "Not this time"}</p>
            <p className="text-4xl font-bold tabular-nums">{view.result.score}</p>
            <p className="text-sm text-muted">points · {view.result.label}</p>
          </div>
          <p className="text-2xl tracking-wider">{view.result.shareGrid}</p>
          <ShareButton
            text={shareText({ appName: APP_NAME, gameName, emoji, date, label: view.result.label, score: view.result.score, grid: view.result.shareGrid })}
          />
        </Card>
      )}
    </div>
  );
}
