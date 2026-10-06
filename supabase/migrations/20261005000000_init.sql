-- Daily games platform: players, daily puzzles, plays, and leaderboard queries.
--
-- Access model: the browser never talks to these tables directly. All reads and writes go
-- through the Next.js server, which authenticates the caller and then uses the service-role key.
-- RLS is still enabled everywhere as defense in depth, so the public (anon/publishable) key can
-- at most read profiles and the caller's own plays — never puzzle solutions.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Profiles: one per player. Created by the app after sign-up / Google onboarding, which is
-- where the invite code is checked. A Google user without a profile cannot play.
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Players can see every profile"
  on public.profiles for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- Puzzles: one per game per day. Generated lazily on first play (deterministically, from a
-- secret seed) or loaded ahead of time for curated games. `solution` must never reach a client
-- before that client's play is finished.
-- ---------------------------------------------------------------------------------------------

create table public.puzzles (
  game_id     text not null check (game_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  puzzle_date date not null,
  payload     jsonb not null,
  solution    jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, puzzle_date)
);

alter table public.puzzles enable row level security;
-- No policies: only the service role may read or write puzzles.

-- ---------------------------------------------------------------------------------------------
-- Plays: one player's attempt at one puzzle. `version` is an optimistic-concurrency token so a
-- double-tap or a second device can never apply a move twice.
-- ---------------------------------------------------------------------------------------------

create table public.plays (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,
  puzzle_date  date not null,
  state        jsonb not null,
  status       text not null default 'in_progress' check (status in ('in_progress', 'won', 'lost')),
  score        smallint check (score between 0 and 100),
  result_label text,
  share_grid   text,
  version      integer not null default 0 check (version >= 0),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, game_id, puzzle_date),
  foreign key (game_id, puzzle_date) references public.puzzles (game_id, puzzle_date) on delete restrict,
  constraint plays_finished_consistency check (
    (status = 'in_progress' and finished_at is null and score is null and result_label is null and share_grid is null)
    or
    (status <> 'in_progress' and finished_at is not null and score is not null and result_label is not null and share_grid is not null)
  )
);

create index plays_date_game_idx on public.plays (puzzle_date, game_id);

create trigger plays_set_updated_at
  before update on public.plays
  for each row execute function public.set_updated_at();

alter table public.plays enable row level security;

create policy "Players can see their own plays"
  on public.plays for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Leaderboard: total normalized points over a date range for a set of games. Every player is
-- listed (with 0 points if they didn't play) so the board doubles as an attendance sheet.
-- Pass all live game ids for the overall board, or a single id for a per-game board.
-- ---------------------------------------------------------------------------------------------

create function public.leaderboard(p_from date, p_to date, p_game_ids text[])
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
  group by p.id
  order by points desc, games_played desc, p.username;
$$;

-- ---------------------------------------------------------------------------------------------
-- Streaks: consecutive days with at least one finished play among the given games. The current
-- streak survives until the end of today, so not having played *yet* today doesn't break it.
-- ---------------------------------------------------------------------------------------------

create function public.streaks(p_today date, p_game_ids text[])
returns table (user_id uuid, current_streak integer, best_streak integer)
language sql
stable
set search_path = ''
as $$
  with days as (
    select distinct pl.user_id, pl.puzzle_date as d
    from public.plays pl
    where pl.status <> 'in_progress'
      and pl.game_id = any (p_game_ids)
      and pl.puzzle_date <= p_today
  ),
  runs as (
    select user_id, max(d) as run_end, count(*)::integer as run_length
    from (
      select user_id, d, d - (row_number() over (partition by user_id order by d))::integer as grp
      from days
    ) islands
    group by user_id, grp
  )
  select
    user_id,
    coalesce(max(run_length) filter (where run_end >= p_today - 1), 0) as current_streak,
    max(run_length) as best_streak
  from runs
  group by user_id;
$$;

-- These run with the caller's privileges; only the server (service role) needs them.
revoke execute on function public.leaderboard(date, date, text[]) from public, anon, authenticated;
revoke execute on function public.streaks(date, text[]) from public, anon, authenticated;
grant execute on function public.leaderboard(date, date, text[]) to service_role;
grant execute on function public.streaks(date, text[]) to service_role;
