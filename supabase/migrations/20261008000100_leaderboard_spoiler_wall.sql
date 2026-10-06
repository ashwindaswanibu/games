-- Spoiler wall on the leaderboard: you can't see friends' results for a game until you've finished
-- it yourself. Until now the board summed today's finished plays for everyone, so a player who
-- hadn't played yet could read friends' points (and wins) for today's puzzle off the Today
-- standings or the per-game board.
--
-- The board now takes the viewer and the current game day. Another player's play on `p_today` (or
-- later) only counts when the viewer has finished that same game that day; earlier days always
-- count. The viewer's own plays always count. Every derived column (points, games played, wins,
-- average, rank) follows from the same filtered rows.

drop function public.leaderboard(date, date, text[]);

create function public.leaderboard(p_from date, p_to date, p_game_ids text[], p_viewer uuid, p_today date)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  points       integer,
  games_played integer,
  wins         integer,
  avg_score    numeric,
  rank         integer
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    coalesce(sum(pl.score), 0)::integer                     as points,
    count(pl.score)::integer                                as games_played,
    count(*) filter (where pl.status = 'won')::integer      as wins,
    round(avg(pl.score), 1)                                 as avg_score,
    rank() over (order by coalesce(sum(pl.score), 0) desc)::integer as rank
  from public.profiles p
  left join public.plays pl
    on pl.user_id = p.id
   and pl.puzzle_date between p_from and p_to
   and pl.status <> 'in_progress'
   and pl.game_id = any (p_game_ids)
   and (
     pl.puzzle_date < p_today
     or pl.user_id = p_viewer
     or exists (
       select 1
       from public.plays mine
       where mine.user_id = p_viewer
         and mine.game_id = pl.game_id
         and mine.puzzle_date = pl.puzzle_date
         and mine.status <> 'in_progress'
     )
   )
  group by p.id
  order by points desc, games_played desc, p.username;
$$;

revoke all on function public.leaderboard(date, date, text[], uuid, date) from public, anon, authenticated;
grant execute on function public.leaderboard(date, date, text[], uuid, date) to service_role;
