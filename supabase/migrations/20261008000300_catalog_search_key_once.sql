-- Catalog search computed the normalized query key once per catalog row instead of once per call.
-- `catalog_search_key` has `SET search_path`, so the planner can't inline or constant-fold it; with
-- the `q` CTE inlined, `catalog_search_key($1)` landed in the row filter, the tier CASE and the sort
-- key. A 1-2 character query matches most of the catalog, which made a single people search cost
-- ~1 s of database time. Materializing the CTE evaluates the key exactly once per call.
-- Same signatures, so existing grants (service role only) are kept.

create or replace function public.search_films(p_query text, p_limit integer default 8)
returns table (id integer, title text, year smallint, directors text[], popularity real)
language sql
stable
set search_path = ''
as $$
  with q as materialized (select public.catalog_search_key(p_query) as k),
  hits as (
    select
      f.*,
      case
        when f.search_key = q.k then 0
        when f.search_key like q.k || '%' or f.search_key like '% ' || q.k || '%' then 1
        when f.search_key like '%' || q.k || '%' then 2
        else 3
      end as tier,
      extensions.word_similarity(q.k, f.search_key) as sim
    from public.movie_films f, q
    where q.k <> ''
      and (
        f.search_key like '%' || q.k || '%'
        or (char_length(q.k) >= 4 and q.k operator(extensions.<%) f.search_key)
      )
  )
  select h.id, h.title, h.year, h.directors, h.popularity
  from hits h
  order by h.tier, case when h.tier = 3 then h.sim end desc nulls last, h.popularity desc, h.id
  limit least(greatest(coalesce(p_limit, 8), 1), 25);
$$;

create or replace function public.search_people(p_query text, p_limit integer default 8)
returns table (id integer, name text, popularity real, known_for text)
language sql
stable
set search_path = ''
as $$
  with q as materialized (select public.catalog_search_key(p_query) as k),
  hits as (
    select
      p.id,
      p.name,
      p.popularity,
      case
        when p.search_key = q.k then 0
        when p.search_key like q.k || '%' or p.search_key like '% ' || q.k || '%' then 1
        when p.search_key like '%' || q.k || '%' then 2
        else 3
      end as tier,
      extensions.word_similarity(q.k, p.search_key) as sim
    from public.movie_people p, q
    where q.k <> ''
      and (
        p.search_key like '%' || q.k || '%'
        or (char_length(q.k) >= 4 and q.k operator(extensions.<%) p.search_key)
      )
  ),
  top as (
    select *
    from hits
    order by tier, case when tier = 3 then sim end desc nulls last, popularity desc, id
    limit least(greatest(coalesce(p_limit, 8), 1), 25)
  )
  -- Their best-known film, to tell namesakes apart in the dropdown.
  select t.id, t.name, t.popularity, k.title as known_for
  from top t
  left join lateral (
    select f.title
    from public.movie_credits c
    join public.movie_films f on f.id = c.film_id
    where c.person_id = t.id
    order by f.popularity desc, f.id
    limit 1
  ) k on true
  order by t.tier, case when t.tier = 3 then t.sim end desc nulls last, t.popularity desc, t.id;
$$;
