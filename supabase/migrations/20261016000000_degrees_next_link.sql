-- Degrees of Separation's "next link" hint: the first link of a shortest chain from where the
-- player is to the end actor, over the same credits par is computed on (no adult films: search
-- never shows them). People already in the player's chain can't be used again, so they're avoided.
--
-- Returns at most one row: the first link's film and co-star, and how many links the whole chain
-- takes from p_from. No row when the end can't be reached within p_max_links (1–3) links.
--
-- Meets in the middle instead of walking out from p_from: the people one film away from each end,
-- then (for three links) the films that join the two sets. The catalog's largest filmography is
-- under 200 films and casts are ~10 credited people, so each side stays in the low thousands.
-- When several chains are equally short, the best-known co-star and film come first.
create function public.degrees_next_link(
  p_from integer,
  p_to integer,
  p_avoid integer[],
  p_max_links integer
)
returns table (film_id integer, person_id integer, links integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  avoid integer[] := coalesce(p_avoid, '{}');
begin
  if p_from = p_to or p_max_links < 1 then
    return;
  end if;

  -- One link: a film both were in.
  return query
    select a.film_id, p_to, 1
    from public.movie_credits a
    join public.movie_credits b on b.film_id = a.film_id and b.person_id = p_to
    join public.movie_films f on f.id = a.film_id and not f.is_adult
    where a.person_id = p_from
    order by f.fame desc nulls last, a.film_id
    limit 1;
  if found or p_max_links < 2 then
    return;
  end if;

  -- Two links: a co-star of p_from who has also been in a film with p_to.
  return query
    with near_from as (
      select c.person_id, c.film_id
      from public.movie_credits a
      join public.movie_films f on f.id = a.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = a.film_id
      where a.person_id = p_from and c.person_id <> p_from and c.person_id <> p_to and c.person_id <> all (avoid)
    ),
    near_to as (
      select distinct c.person_id
      from public.movie_credits b
      join public.movie_films f on f.id = b.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = b.film_id
      where b.person_id = p_to and c.person_id <> p_to
    )
    select n.film_id, n.person_id, 2
    from near_from n
    join near_to t on t.person_id = n.person_id
    join public.movie_people p on p.id = n.person_id
    join public.movie_films f on f.id = n.film_id
    order by p.popularity desc, f.fame desc nulls last, n.person_id, n.film_id
    limit 1;
  if found or p_max_links < 3 then
    return;
  end if;

  -- Three links: a co-star of p_from who shares a film with a co-star of p_to.
  return query
    with near_from as (
      select c.person_id, c.film_id
      from public.movie_credits a
      join public.movie_films f on f.id = a.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = a.film_id
      where a.person_id = p_from and c.person_id <> p_from and c.person_id <> p_to and c.person_id <> all (avoid)
    ),
    near_to as (
      select distinct c.person_id
      from public.movie_credits b
      join public.movie_films f on f.id = b.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = b.film_id
      where b.person_id = p_to and c.person_id <> p_to and c.person_id <> p_from and c.person_id <> all (avoid)
    ),
    -- Films with someone one link from p_to in them.
    joining as (
      select distinct c.film_id
      from public.movie_credits c
      join near_to t on t.person_id = c.person_id
      join public.movie_films f on f.id = c.film_id and not f.is_adult
    ),
    -- Co-stars of p_from in one of those films. None of them is one link from p_to (two links
    -- would have found them), so the film's other person is someone else.
    bridges as (
      select distinct c.person_id
      from public.movie_credits c
      join joining j on j.film_id = c.film_id
      where c.person_id in (select n.person_id from near_from n)
    )
    select n.film_id, n.person_id, 3
    from near_from n
    join bridges b on b.person_id = n.person_id
    join public.movie_people p on p.id = n.person_id
    join public.movie_films f on f.id = n.film_id
    order by p.popularity desc, f.fame desc nulls last, n.person_id, n.film_id
    limit 1;
end;
$$;

comment on function public.degrees_next_link(integer, integer, integer[], integer) is
  'Degrees of Separation hint: the first link (film, co-star) of a shortest chain from p_from to p_to within p_max_links (≤ 3) links, avoiding p_avoid, over non-adult credits.';

revoke all on function public.degrees_next_link(integer, integer, integer[], integer) from public, anon, authenticated;
grant execute on function public.degrees_next_link(integer, integer, integer[], integer) to service_role;
