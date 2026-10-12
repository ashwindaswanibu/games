import type { AnyGame } from "@/core/game";
import { formatPuzzleDate, parsePuzzleDate } from "@/core/day";
import { getGame } from "@/games/registry";
import type { FinishedPlay } from "@/server/leaderboards";
import { signOut } from "../../../(auth)/actions";
import frame from "../../app-frame.module.css";
import { EditProfileForm } from "./edit-profile-form";
import styles from "./profile.module.css";

/** One live game's line on a profile. `winRate` and `avg` are null until it's been played. */
export interface GameRecord {
  game: Pick<AnyGame, "id" | "name">;
  played: number;
  winRate: number | null;
  avg: number | null;
}

/** A figure over its label (the label comes first for a screen reader). */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * A player's page: their name as a title card, their totals, each game, and their recent plays as
 * credits. The owner also gets the edit form and signing out. Everything it shows comes in as
 * props (see page.tsx).
 */
export function ProfileView({
  player,
  isMe,
  passwordAccount,
  savedNotice,
  stats,
  perGame,
  history,
}: {
  player: { username: string; displayName: string; createdAt: string };
  isMe: boolean;
  /** The owner signs in with their username (see `EditProfileForm`). */
  passwordAccount: boolean;
  /** What a save just did, for the owner (`?saved=`). */
  savedNotice: string | null;
  stats: { points: number; played: number; streak: number; best: number };
  perGame: GameRecord[];
  /** Finished plays, newest first. */
  history: FinishedPlay[];
}) {
  const joined = formatPuzzleDate(parsePuzzleDate(player.createdAt.slice(0, 10)), { month: "short", year: "numeric" });
  return (
    <div className={styles.page}>
      <section className={styles.head}>
        <h1 className={styles.name}>{player.displayName}</h1>
        <p className={styles.meta}>
          <span className={styles.handle}>@{player.username}</span>
          <span className={frame.label}>Joined {joined}</span>
        </p>
      </section>

      {isMe && (
        <div className={styles.own}>
          {savedNotice && (
            <p role="status" className={styles.notice}>
              {savedNotice}
            </p>
          )}
          <EditProfileForm username={player.username} displayName={player.displayName} passwordAccount={passwordAccount} />
        </div>
      )}

      <dl className={styles.stats}>
        <Stat label="Points" value={stats.points} />
        <Stat label="Played" value={stats.played} />
        <Stat label="Streak" value={stats.streak} />
        <Stat label="Best" value={stats.best} />
      </dl>

      <section className={styles.section}>
        <h2 className={frame.label}>By game</h2>
        <ul className={styles.games}>
          {perGame.map(({ game, played, winRate, avg }) => (
            <li key={game.id}>
              <span className={styles.gameName}>{game.name}</span>
              <span className={styles.gameRecord}>
                {played} played{winRate !== null && ` · ${winRate}% won · avg ${avg}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={frame.label}>Recent</h2>
        {history.length === 0 ? (
          <p className={styles.empty}>No finished games yet.</p>
        ) : (
          <ol className={styles.history}>
            {history.map((p) => (
              <li key={`${p.game_id}:${p.puzzle_date}`}>
                <span className={styles.date}>{formatPuzzleDate(parsePuzzleDate(p.puzzle_date), { month: "short", day: "numeric" })}</span>
                <span className={styles.gameName}>{getGame(p.game_id)?.name ?? p.game_id}</span>
                <span className={styles.result}>{p.result_label}</span>
                <span className={styles.score}>{p.score}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {isMe && (
        <form action={signOut} className={styles.signOut}>
          <button type="submit">Sign out</button>
        </form>
      )}
    </div>
  );
}
