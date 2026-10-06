import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { formatPuzzleDate, today } from "@/core/day";
import { canPlay, getGame } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getFriendsResults, getPlayView } from "@/server/plays";
import { FriendsResults, LockedResults } from "./friends-results";
import { GameHost } from "./game-host";

export async function generateMetadata({ params }: PageProps<"/play/[gameId]">): Promise<Metadata> {
  const { gameId } = await params;
  return { title: getGame(gameId)?.name ?? "Game" };
}

export default async function PlayPage({ params }: PageProps<"/play/[gameId]">) {
  const { gameId } = await params;
  const profile = await requireProfile();
  const game = getGame(gameId);
  if (!game || !canPlay(game, profile.is_admin)) notFound();

  const date = today();
  const view = await getPlayView(profile.id, game, date);
  const finished = view !== null && view.status !== "in_progress";
  const friends = finished ? await getFriendsResults(profile.id, game.id, date) : null;

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
      <GameHost key={`${game.id}:${date}`} gameId={game.id} gameName={game.name} emoji={game.emoji} rules={game.rules} date={date} initialView={view} />

      {friends ? <FriendsResults results={friends} viewerId={profile.id} /> : <LockedResults />}
    </div>
  );
}
