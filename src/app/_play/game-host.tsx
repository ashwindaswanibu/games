"use client";

import type { ReactNode } from "react";
import { ShareButton } from "@/components/share-button";
import { buttonClass, Card } from "@/components/ui";
import { APP_NAME } from "@/config";
import type { PuzzleDate } from "@/core/day";
import { shareText } from "@/core/share";
import type { PlayView } from "@/core/view";
import { GameUiProvider } from "@/games/game-ui-context";
import { useGameSession } from "./use-game-session";

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
  const { view, pending, notice, start, move } = useGameSession({ gameId, date, initialView: props.initialView });

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
        <button type="button" onClick={() => void start()} disabled={pending} className={buttonClass("accent", "w-full")}>
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
