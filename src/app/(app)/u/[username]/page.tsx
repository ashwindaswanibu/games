import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Avatar, buttonClass, Card, SectionTitle } from "@/components/ui";
import { formatPuzzleDate, parsePuzzleDate, today } from "@/core/day";
import { getGame, liveGameIds, liveGames } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { getPlayerHistory, getStreaks } from "@/server/leaderboards";
import { db } from "@/server/supabase/admin";
import { signOut } from "../../../(auth)/actions";

export async function generateMetadata({ params }: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

const HISTORY_LIMIT = 30;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid gap-0.5 text-center">
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export default async function ProfilePage({ params }: PageProps<"/u/[username]">) {
  const viewer = await requireProfile();
  const { username } = await params;

  const { data: player, error } = await db().from("profiles").select("*").eq("username", username.toLowerCase()).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!player) notFound();

  const date = today();
  const ids = liveGameIds();
  const [history, streaks] = await Promise.all([getPlayerHistory(player.id, ids), getStreaks(ids, date)]);
  const streak = streaks.get(player.id) ?? { current: 0, best: 0 };
  const total = history.reduce((sum, p) => sum + (p.score ?? 0), 0);
  const isMe = viewer.id === player.id;

  const perGame = liveGames().map((game) => {
    const plays = history.filter((p) => p.game_id === game.id);
    const wins = plays.filter((p) => p.status === "won").length;
    const avg = plays.length ? Math.round(plays.reduce((s, p) => s + (p.score ?? 0), 0) / plays.length) : null;
    return { game, played: plays.length, winRate: plays.length ? Math.round((wins / plays.length) * 100) : null, avg };
  });

  return (
    <div className="grid gap-8">
      <section className="flex items-center gap-4 pt-2">
        <Avatar name={player.display_name} size={64} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{player.display_name}</h1>
          <p className="text-sm text-muted">
            @{player.username} · joined {formatPuzzleDate(parsePuzzleDate(player.created_at.slice(0, 10)), { month: "short", year: "numeric" })}
          </p>
        </div>
      </section>

      <Card className="grid grid-cols-4 gap-2 px-2 py-5">
        <Stat label="Points" value={total} />
        <Stat label="Played" value={history.length} />
        <Stat label="Streak" value={streak.current} />
        <Stat label="Best" value={streak.best} />
      </Card>

      <section>
        <SectionTitle>By game</SectionTitle>
        <Card className="divide-y divide-border overflow-hidden">
          {perGame.map(({ game, played, winRate, avg }) => (
            <div key={game.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl" aria-hidden>
                {game.emoji}
              </span>
              <span className="flex-1 font-medium">{game.name}</span>
              <span className="text-sm text-muted tabular-nums">
                {played} played{winRate !== null && ` · ${winRate}% won · avg ${avg}`}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle>Recent</SectionTitle>
        {history.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">No finished games yet.</Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {history.slice(0, HISTORY_LIMIT).map((p) => {
              const game = getGame(p.game_id);
              return (
                <div key={`${p.game_id}:${p.puzzle_date}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-20 text-muted">{formatPuzzleDate(parsePuzzleDate(p.puzzle_date), { month: "short", day: "numeric" })}</span>
                  <span className="flex-1">
                    {game?.emoji} {game?.name ?? p.game_id}
                  </span>
                  <span className="text-muted tabular-nums">{p.result_label}</span>
                  <span className="w-10 text-right font-semibold tabular-nums">{p.score}</span>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {isMe && (
        <form action={signOut}>
          <button type="submit" className={buttonClass("secondary", "w-full")}>
            Sign out
          </button>
        </form>
      )}
    </div>
  );
}
