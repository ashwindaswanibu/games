"use client";

import type { ReactNode } from "react";
import type { PuzzleDate } from "@/core/day";
import type { FriendResult, PlayView } from "@/core/view";
import { ImmersiveGameUiProvider } from "@/games/game-ui-context";
import { useGameSession } from "./use-game-session";

/**
 * The game host for full-screen games: the same session as `GameHost`, with no panels of its own.
 * The game's UI (`children`, see `connectImmersiveGameUi`) draws every state, including the start.
 */
export function ImmersiveHost(props: {
  gameId: string;
  date: PuzzleDate;
  initialView: PlayView | null;
  viewerId: string;
  friends: readonly FriendResult[] | null;
  children: ReactNode;
}) {
  const { gameId, date, viewerId, friends } = props;
  const { view, pending, notice, start, move } = useGameSession({ gameId, date, initialView: props.initialView });
  return (
    <ImmersiveGameUiProvider value={{ view, start, submitMove: move, pending, notice, date, viewerId, friends }}>
      {props.children}
    </ImmersiveGameUiProvider>
  );
}
