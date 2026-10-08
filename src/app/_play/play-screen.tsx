import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { formatPuzzleDate, today } from "@/core/day";
import { canPlay, getGame } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getFriendsResults, getPlayView, preloadAssets } from "@/server/plays";
import { FriendsResults, LockedResults } from "./friends-results";
import { GameHost } from "./game-host";
import { ImmersiveHost } from "./immersive-host";

/*
 * Every game has its own route, `play/<id>/page.tsx`, which renders `PlayScreen` with that game's
 * UI. One page per game (rather than one `play/[gameId]` page) is what keeps games apart in the
 * browser: client components are bundled per route, so a shared page would ship every game's UI,
 * names and rules (including games still in testing) to every player.
 */

/** The play page's title; a game the viewer can't open stays unnamed. */
export async function playMetadata(gameId: string): Promise<Metadata> {
  const profile = await requireProfile();
  const game = getGame(gameId);
  return { title: game && canPlay(game, profile.is_admin) ? game.name : "Game" };
}

/** Everything a play screen needs about the viewer's play of today's puzzle of `gameId`. */
async function loadPlayScreen(gameId: string) {
  const profile = await requireProfile();
  const game = getGame(gameId);
  if (!game || !canPlay(game, profile.is_admin)) notFound();

  const date = today();
  const view = await getPlayView(profile.id, game, date);
  const finished = view !== null && view.status !== "in_progress";
  // Before the play starts there's no view to list the puzzle's images, so list them here.
  const [friends, preload] = await Promise.all([finished ? getFriendsResults(profile.id, game, date) : null, view ? [] : preloadAssets(game, date)]);
  return { profile, game, date, view, friends, preload };
}

/** The play screen for `gameId`; `children` is that game's connected UI (see `connectGameUi`). */
export async function PlayScreen({ gameId, children }: { gameId: string; children: ReactNode }) {
  const { profile, game, date, view, friends, preload } = await loadPlayScreen(gameId);

  return (
    <div className="grid gap-6" style={{ "--accent": game.accent } as CSSProperties}>
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Back to today" className="-ml-2 rounded-full p-2 text-muted hover:text-fg">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-xl" aria-hidden>
          {game.emoji}
        </span>
        <div>
          <h1 className="text-lg leading-tight font-bold">{game.name}</h1>
          <p className="text-xs text-muted">{formatPuzzleDate(date)}</p>
        </div>
      </header>

      {/* Keyed so client state resets when switching games or when the day rolls over. */}
      <GameHost key={`${game.id}:${date}`} gameId={game.id} gameName={game.name} emoji={game.emoji} rules={game.rules} date={date} initialView={view} preload={preload}>
        {children}
      </GameHost>

      {friends ? <FriendsResults results={friends} viewerId={profile.id} /> : <LockedResults />}
    </div>
  );
}

/**
 * The play screen for a game that owns the whole screen: no header or panels, just the game's UI
 * (`children`, see `connectImmersiveGameUi`). Render it from a route outside the app's chrome.
 */
export async function ImmersivePlayScreen({ gameId, children }: { gameId: string; children: ReactNode }) {
  const { profile, game, date, view, friends, preload } = await loadPlayScreen(gameId);
  return (
    // Keyed so client state resets when the day rolls over.
    <ImmersiveHost key={`${game.id}:${date}`} gameId={game.id} date={date} initialView={view} preload={preload} viewerId={profile.id} friends={friends}>
      {children}
    </ImmersiveHost>
  );
}
