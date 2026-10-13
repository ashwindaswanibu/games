-- Faster Degrees lookups by person.
--
-- movie_credits is read by person everywhere a filmography is: search_films' filmography branch,
-- the whole-filmography list (src/server/catalog-scoped.ts), degrees_next_link's walk out from
-- each end, Degrees' link check. (person_id, film_id) answers those from the index alone (no visit
-- to the table for the film id), and still serves everything the person_id-only index did (every
-- query that filters, joins or orders on person_id, and the cascade from movie_people), so that
-- one goes. Plain CREATE INDEX: migrations run in a transaction, where CONCURRENTLY can't; the
-- catalog is written only by the content pipeline.
create index if not exists movie_credits_person_film_idx on public.movie_credits (person_id, film_id);
drop index if exists public.movie_credits_person_idx;

-- degrees_next_link (20261017000200, unchanged) also returns the link's film title and year and the
-- co-star's name, which the hint shows, so the server needn't look them up after. A function's
-- result columns can't be changed in place, so it is dropped and made again (with its grants).
drop function if exists public.degrees_next_link(integer, integer, integer[], integer);

create function public.degrees_next_link(
  p_from integer,
  p_to integer,
  p_avoid integer[],
  p_max_links integer
)
returns table (film_id integer, person_id integer, links integer, film_title text, film_year smallint, person_name text)
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
    select a.film_id, p_to, 1, f.title, f.year, (select p.name from public.movie_people p where p.id = p_to)
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
    select n.film_id, n.person_id, 2, f.title, f.year, p.name
    from near_from n
    join near_to t on t.person_id = n.person_id
    join public.movie_people p on p.id = n.person_id
    left join public.movie_person_fame k on k.person_id = n.person_id
    join public.movie_films f on f.id = n.film_id
    order by coalesce(k.daily_views, 0) desc, p.popularity desc, f.fame desc nulls last, n.person_id, n.film_id
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
    select n.film_id, n.person_id, 3, f.title, f.year, p.name
    from near_from n
    join bridges b on b.person_id = n.person_id
    join public.movie_people p on p.id = n.person_id
    left join public.movie_person_fame k on k.person_id = n.person_id
    join public.movie_films f on f.id = n.film_id
    order by coalesce(k.daily_views, 0) desc, p.popularity desc, f.fame desc nulls last, n.person_id, n.film_id
    limit 1;
  if found or p_max_links < 4 then
    return;
  end if;

  -- Four links: a co-star of p_from who shares a film with someone two links from p_to. Nobody
  -- one link from p_to is a co-star of p_from (three links would have found them), so the chain
  -- p_from → co-star → their co-star → one link from p_to → p_to has four different people.
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
    -- People two links from p_to: co-stars of someone one link from it.
    two_from_to as (
      select distinct c.person_id
      from public.movie_credits t
      join near_to n on n.person_id = t.person_id
      join public.movie_films f on f.id = t.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = t.film_id
      where c.person_id <> p_to and c.person_id <> p_from and c.person_id <> all (avoid)
    ),
    -- Co-stars of p_from with a co-star of their own two links from p_to.
    bridges as (
      select distinct a.person_id
      from (select distinct n.person_id from near_from n) s
      join public.movie_credits a on a.person_id = s.person_id
      join public.movie_films f on f.id = a.film_id and not f.is_adult
      join public.movie_credits c on c.film_id = a.film_id and c.person_id <> a.person_id
      join two_from_to t on t.person_id = c.person_id
    )
    select n.film_id, n.person_id, 4, f.title, f.year, p.name
    from near_from n
    join bridges b on b.person_id = n.person_id
    join public.movie_people p on p.id = n.person_id
    left join public.movie_person_fame k on k.person_id = n.person_id
    join public.movie_films f on f.id = n.film_id
    order by coalesce(k.daily_views, 0) desc, p.popularity desc, f.fame desc nulls last, n.person_id, n.film_id
    limit 1;
end;
$$;

comment on function public.degrees_next_link(integer, integer, integer[], integer) is
  'Degrees of Separation hint: the first link (film, co-star, with the film''s title and year and the co-star''s name) of a shortest chain from p_from to p_to within p_max_links (≤ 4) links, avoiding p_avoid, over non-adult credits.';

revoke all on function public.degrees_next_link(integer, integer, integer[], integer) from public, anon, authenticated;
grant execute on function public.degrees_next_link(integer, integer, integer[], integer) to service_role;
