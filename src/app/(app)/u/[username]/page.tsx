import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { today } from "@/core/day";
import { liveGameIds, liveGames } from "@/games/registry";
import { getSessionUser, isPasswordAccountEmail, requireProfile } from "@/server/auth";
import { getPlayerHistory, getStreaks } from "@/server/leaderboards";
import { db } from "@/server/supabase/admin";
import type { SavedNotice } from "./actions";
import { ProfileView } from "./profile-view";

export async function generateMetadata({ params }: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

const HISTORY_LIMIT = 30;

const SAVED_NOTICES: Record<SavedNotice, string> = {
  profile: "Profile saved.",
  username: "Username changed. Sign in with your new username next time.",
};

export default async function ProfilePage({ params, searchParams }: PageProps<"/u/[username]">) {
  const viewer = await requireProfile();
  const [{ username }, { saved }] = await Promise.all([params, searchParams]);

  const { data: player, error } = await db().from("profiles").select("*").eq("username", username.toLowerCase()).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!player) notFound();

  const date = today();
  const ids = liveGameIds();
  const [history, streaks] = await Promise.all([getPlayerHistory(player.id, ids, viewer.id, date), getStreaks(ids, date)]);
  const streak = streaks.get(player.id) ?? { current: 0, best: 0 };
  const total = history.reduce((sum, p) => sum + (p.score ?? 0), 0);
  const isMe = viewer.id === player.id;
  // The account type never changes, so the session's (possibly stale) email is enough to tell.
  const passwordAccount = isMe && isPasswordAccountEmail((await getSessionUser())?.email ?? undefined);
  const savedNotice = isMe && typeof saved === "string" && Object.hasOwn(SAVED_NOTICES, saved) ? SAVED_NOTICES[saved as SavedNotice] : null;

  const perGame = liveGames().map((game) => {
    const plays = history.filter((p) => p.game_id === game.id);
    const wins = plays.filter((p) => p.status === "won").length;
    const avg = plays.length ? Math.round(plays.reduce((s, p) => s + (p.score ?? 0), 0) / plays.length) : null;
    return { game, played: plays.length, winRate: plays.length ? Math.round((wins / plays.length) * 100) : null, avg };
  });

  return (
    <ProfileView
      player={{ username: player.username, displayName: player.display_name, createdAt: player.created_at }}
      isMe={isMe}
      passwordAccount={passwordAccount}
      savedNotice={savedNotice}
      stats={{ points: total, played: history.length, streak: streak.current, best: streak.best }}
      perGame={perGame}
      history={history.slice(0, HISTORY_LIMIT)}
    />
  );
}
