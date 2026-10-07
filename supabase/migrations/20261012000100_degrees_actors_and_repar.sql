-- Degrees of Separation, after the catalog grew to ~170,000 people:
--
--  1. `movie_people.is_actor`: IMDb or Wikidata says the person acts. Puzzles start and end only at
--     actors (scripts/content/movies/degrees.mts); anyone credited can still be a link in a chain.
--  2. `replace_unplayed_puzzle`: rewrites one stored puzzle in place, only while nobody has played
--     it. A bigger credit graph can make a stored Degrees day's par stale (a shorter chain now
--     exists); `degrees --repar-unplayed` fixes those days through this function.

-- ---------------------------------------------------------------------------------------------
-- 1. Actors
-- ---------------------------------------------------------------------------------------------

alter table public.movie_people add column is_actor boolean not null default false;
comment on column public.movie_people.is_actor is
  'IMDb lists actor or actress among the person''s primary professions, or Wikidata gives them the occupation actor, film actor or voice actor. Set by the catalog import; Degrees picks start and end actors among these.';

-- ---------------------------------------------------------------------------------------------
-- 2. Replacing a puzzle nobody has played
-- ---------------------------------------------------------------------------------------------

-- Returns 'replaced', or why not: 'missing' (no such puzzle), 'played' (someone has started it;
-- never touched), 'changed' (its payload isn't p_expected_payload any more: someone else rewrote
-- it since the caller read it).
--
-- The row lock makes the play check exact: starting a play inserts into `plays`, whose foreign key
-- check takes a key-share lock on this puzzle row. FOR UPDATE waits for any such insert still in
-- flight (and then sees its play), and holds back new ones until this transaction ends.
create function public.replace_unplayed_puzzle(
  p_game_id text,
  p_date date,
  p_expected_payload jsonb,
  p_payload jsonb,
  p_solution jsonb
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_payload jsonb;
begin
  select p.payload into current_payload
  from public.puzzles p
  where p.game_id = p_game_id and p.puzzle_date = p_date
  for update;
  if not found then
    return 'missing';
  end if;
  if exists (select 1 from public.plays pl where pl.game_id = p_game_id and pl.puzzle_date = p_date) then
    return 'played';
  end if;
  if current_payload is distinct from p_expected_payload then
    return 'changed';
  end if;
  update public.puzzles
  set payload = p_payload, solution = p_solution
  where game_id = p_game_id and puzzle_date = p_date;
  return 'replaced';
end;
$$;

revoke all on function public.replace_unplayed_puzzle(text, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_unplayed_puzzle(text, date, jsonb, jsonb, jsonb) to service_role;
