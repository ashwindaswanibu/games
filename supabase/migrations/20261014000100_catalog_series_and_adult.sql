-- Two facts about films from the catalog import, and search that honours one of them.
--
--  1. `movie_films.series_qids`: the Wikidata ids of the film series the film is part of
--     (Wikidata "part of the series", P179, direct values only), so sequels that share no words
--     with each other (Fast Five, Furious 7) count as one series: Fade to Color never shows two of
--     them among the four, and the film picker never chooses two within 30 days. Which P179
--     values count is decided by the import (`seriesOfFilm` in
--     scripts/content/movies/lib/catalog-model.mts): series of creative works, not universes
--     (the Marvel Cinematic Universe), their phases and sagas, lists or studio catalogues.
--  2. `movie_films.is_adult`: IMDb lists the title as adult (title.basics isAdult). The catalog
--     no longer selects adult titles, but three came in with the old Wikidata import (Deep Throat,
--     Debbie Does Dallas, Hungry Bitches) and films are never deleted (stored puzzles and plays
--     reference their ids). An adult film is hidden: film search, filmography search and a
--     person's "known for" leave it out, and so do the content pipelines that choose films.
--
-- Both are written by the catalog import's apply step; until it runs they are empty / false.

alter table public.movie_films
  add column series_qids text[] not null default '{}'
    constraint movie_films_series_qids_check check (
      cardinality(series_qids) <= 20
      and array_position(series_qids, null) is null
      and array_to_string(series_qids, ',') ~ '^(Q[1-9][0-9]*(,Q[1-9][0-9]*)*)?$'
    ),
  add column is_adult boolean not null default false;

comment on column public.movie_films.series_qids is
  'Wikidata ids of the film series this film is part of (P179, direct values that are series: not universes, their phases, lists or studio catalogues), sorted. Set by the catalog import.';
comment on column public.movie_films.is_adult is
  'IMDb lists the title as adult (title.basics isAdult). Hidden from search and never chosen by a content pipeline. Set by the catalog import.';

-- The search functions read the (few) adult films' ids once per call.
create index movie_films_adult_idx on public.movie_films (id) where is_adult;

-- ---------------------------------------------------------------------------------------------
-- search_films (same signature, columns and ranking as 20261013000000; adult films left out)
-- ---------------------------------------------------------------------------------------------

create or replace function public.search_films(p_query text, p_limit integer default 8, p_person integer default null)
returns table (id integer, title text, year smallint, directors text[], fame real, aka text)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  k text := public.catalog_search_key(coalesce(p_query, ''));
  -- Adult films (movie_films.is_adult) are never listed: a handful, read once through a partial index.
  hidden integer[] := array(select f.id from public.movie_films f where f.is_adult);
  -- The query without spaces, matched against compact_key.
  kc text := replace(public.catalog_search_key(coalesce(p_query, '')), ' ', '');
  -- The query with sequel numbering as digits, matched against number_key when it has a number.
  kn text := public.catalog_number_key(public.catalog_search_key(coalesce(p_query, '')));
  numbered boolean := kn ~ '[0-9]';
  n integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  -- Candidates kept per kind of match before films are deduplicated (a film can match by several names).
  per_tier integer := n * 4;
  max_edits integer := case when char_length(k) >= 7 then 2 else 1 end;
  -- Prefix matches ignore spaces from 3 characters on; a shorter query matches the spaced key.
  spaced boolean := char_length(kc) < 3;
  exact_bonus constant real := ln(30);
  word_bonus constant real := ln(3);
begin
  if k = '' then
    return;
  end if;

  if p_person is not null then
    -- One person's filmography: a few hundred names at most, so classify them all.
    return query
    with names as (
      select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
      from public.movie_credits c
      join public.movie_film_titles t on t.film_id = c.film_id
      where c.person_id = p_person and c.film_id <> all (hidden)
    ),
    matched as (
      select
        x.film_id, x.title, x.kind, x.fame,
        coalesce(
          least(
            public.catalog_match_class(x.search_key, k),
            case when numbered and x.number_key is not null then public.catalog_match_class(x.number_key, kn) end
          ),
          case when char_length(k) >= 4 and (
            k operator(extensions.<%) x.search_key
            or (left(x.search_key, 1) = left(k, 1)
                and extensions.levenshtein_less_equal(k, left(x.search_key, char_length(k)), max_edits) <= max_edits)
          ) then 6 end
        ) as cls,
        greatest(
          extensions.word_similarity(k, x.search_key),
          1 - extensions.levenshtein_less_equal(k, left(x.search_key, char_length(k)), 2)::real / char_length(k)
        ) as close
      from names x
    ),
    best as (
      select distinct on (m.film_id) m.*
      from matched m
      where m.cls is not null
      order by m.film_id, m.cls, (m.kind <> 'display'), m.close desc, m.title
    ),
    titled as (
      select b.*, (b.cls = 0 and (b.kind = 'display' or not exists (select 1 from best d where d.cls = 0 and d.kind = 'display'))) as exact_title
      from best b
    ),
    ranked as (
      select x.film_id, x.title, x.kind, x.fame, x.cls,
        case
          when x.exact_title then x.fame + exact_bonus
          when x.cls <= 1 then x.fame + word_bonus
          when x.cls = 3 then least(x.fame, (select min(e.fame) from titled e where e.exact_title) + exact_bonus - 0.001)
          when x.cls = 6 then x.fame + 10 * x.close
          else x.fame
        end as score
      from titled x
    )
    -- Partial later words, substrings and typos sort last, so they only fill a list the real matches left short.
    select f.id, f.title, f.year, f.directors, f.fame, case when r.kind <> 'display' then r.title end
    from ranked r
    join public.movie_films f on f.id = r.film_id
    order by case when r.cls <= 3 then 0 else r.cls end, r.score desc, r.fame desc, f.id
    limit n;
    return;
  end if;

  return query
  with cand as (
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and t.compact_key = kc)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and spaced and t.search_key like k || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and not spaced and t.compact_key like kc || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    -- After a leading article: "dark" → The Dark Knight.
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and spaced and (t.search_key like 'the ' || k || '%' or t.search_key like 'a ' || k || '%' or t.search_key like 'an ' || k || '%')
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and not spaced
       and ((t.compact_key like 'the' || kc || '%' and t.search_key like 'the %')
         or (t.compact_key like 'a' || kc || '%' and t.search_key like 'a %')
         or (t.compact_key like 'an' || kc || '%' and t.search_key like 'an %'))
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and char_length(k) >= 3
       and t.search_key like '% ' || k || '%'
       and t.compact_key not like kc || '%'
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and char_length(k) >= 3
       and t.search_key like '%' || k || '%'
       and t.compact_key not like kc || '%'
       and t.search_key not like '% ' || k || '%'
     order by t.fame desc
     limit per_tier)
    union all
    -- Sequel numbers: "godfather 2" → The Godfather Part II.
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where t.film_id <> all (hidden) and numbered
       and (t.number_key like kn || '%' or t.number_key like 'the ' || kn || '%' or t.number_key like 'a ' || kn || '%' or t.number_key like 'an ' || kn || '%')
     order by t.fame desc
     limit per_tier)
  ),
  classed as (
    select c.film_id, c.title, c.kind, c.fame,
      least(
        public.catalog_match_class(c.search_key, k),
        case when numbered and c.number_key is not null then public.catalog_match_class(c.number_key, kn) end
      ) as cls
    from cand c
  ),
  best as (
    select distinct on (c.film_id) c.*
    from classed c
    where c.cls is not null
    order by c.film_id, c.cls, (c.kind <> 'display'), c.title
  ),
  titled as (
    select b.*, (b.cls = 0 and (b.kind = 'display' or not exists (select 1 from best d where d.cls = 0 and d.kind = 'display'))) as exact_title
    from best b
  ),
  top as (
    select x.film_id, x.title, x.kind, x.fame, x.cls,
      (case
        when x.exact_title then x.fame + exact_bonus
        when x.cls <= 1 then x.fame + word_bonus
        when x.cls = 3 then least(x.fame, (select min(e.fame) from titled e where e.exact_title) + exact_bonus - 0.001)
        else x.fame
      end)::real as score
    from titled x
    order by case when x.cls <= 3 then 0 else x.cls end, 6 desc, x.fame desc, x.film_id
    limit n
  ),
  -- Runs only when the real matches left the list short (a one-time filter, so no scan otherwise).
  typo_cand as (
    select t.film_id, t.title, t.kind, t.fame, extensions.word_similarity(k, t.search_key) as close
    from public.movie_film_titles t
    where t.film_id <> all (hidden) and (select count(*) from top) < n
      and char_length(k) >= 4
      and k operator(extensions.<%) t.search_key
    union all
    select t.film_id, t.title, t.kind, t.fame, 1 - extensions.levenshtein_less_equal(k, left(t.search_key, char_length(k)), max_edits)::real / char_length(k)
    from public.movie_film_titles t
    where t.film_id <> all (hidden) and (select count(*) from top) < n
      and char_length(k) >= 4
      and t.search_key like left(k, 1) || '%'
      and extensions.levenshtein_less_equal(k, left(t.search_key, char_length(k)), max_edits) <= max_edits
  ),
  typo as (
    select y.film_id, y.title, y.kind, y.fame, 6::smallint as cls, (y.fame + 10 * y.close)::real as score
    from (
      -- The display title when it is among a film's close names; else its closest name.
      select distinct on (c.film_id) c.*
      from typo_cand c
      where c.film_id not in (select tp.film_id from top tp)
      order by c.film_id, (c.kind <> 'display'), c.close desc
    ) y
    order by 6 desc, y.film_id
    limit n
  ),
  hits as (
    select * from top
    union all
    select * from typo
  )
  select f.id, f.title, f.year, f.directors, f.fame, case when h.kind <> 'display' then h.title end
  from hits h
  join public.movie_films f on f.id = h.film_id
  order by case when h.cls <= 3 then 0 else h.cls end, h.score desc, h.fame desc, h.film_id
  limit n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- search_people (same signature, columns and ranking as 20261013000000; adult films don't count
-- toward a person's fame and are never their "known for")
-- ---------------------------------------------------------------------------------------------

create or replace function public.search_people(p_query text, p_limit integer default 8)
returns table (id integer, name text, popularity real, known_for text)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  k text := public.catalog_search_key(coalesce(p_query, ''));
  kc text := replace(public.catalog_search_key(coalesce(p_query, '')), ' ', '');
  n integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  -- Candidates are preselected by Wikipedia editions (indexed), then ranked by their films.
  per_tier integer := n * 4;
  spaced boolean := char_length(kc) < 3;
  exact_bonus constant real := ln(30);
  word_bonus constant real := ln(3);
begin
  if k = '' then
    return;
  end if;

  return query
  with cand as (
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where p.compact_key = kc)
    union all
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where spaced and p.search_key like k || '%' and p.compact_key <> kc
     order by p.popularity desc
     limit per_tier)
    union all
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where not spaced and p.compact_key like kc || '%' and p.compact_key <> kc
     order by p.popularity desc
     limit per_tier)
    union all
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where (spaced and (p.search_key like 'the ' || k || '%' or p.search_key like 'a ' || k || '%' or p.search_key like 'an ' || k || '%'))
        or (not spaced
            and ((p.compact_key like 'the' || kc || '%' and p.search_key like 'the %')
              or (p.compact_key like 'a' || kc || '%' and p.search_key like 'a %')
              or (p.compact_key like 'an' || kc || '%' and p.search_key like 'an %')))
     order by p.popularity desc
     limit per_tier)
    union all
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where char_length(k) >= 3
       and p.search_key like '% ' || k || '%'
       and p.compact_key not like kc || '%'
     order by p.popularity desc
     limit per_tier)
    union all
    (select p.id, p.name, p.popularity, p.search_key
     from public.movie_people p
     where char_length(k) >= 3
       and p.search_key like '%' || k || '%'
       and p.compact_key not like kc || '%'
       and p.search_key not like '% ' || k || '%'
     order by p.popularity desc
     limit per_tier)
  ),
  best as (
    select distinct on (c.id) c.id, c.name, c.popularity, public.catalog_match_class(c.search_key, k) as cls
    from cand c
    order by c.id
  ),
  famed as (
    select b.*, coalesce(fm.fame, 0)::real as fame
    from best b
    left join lateral (
      select ln(1 + sum((exp(f.fame) - 1) * case when cr.billing < 4 then 1 when cr.billing < 10 then 0.25 else 0.1 end)) as fame
      from public.movie_credits cr
      join public.movie_films f on f.id = cr.film_id
      where cr.person_id = b.id and not f.is_adult
    ) fm on true
    where b.cls is not null
  ),
  top as (
    select x.id, x.name, x.popularity, x.cls,
      (case
        when x.cls = 0 then x.fame + exact_bonus
        when x.cls = 1 then x.fame + word_bonus
        when x.cls = 3 then least(x.fame, (select min(e.fame) from famed e where e.cls = 0) + exact_bonus - 0.001)
        else x.fame
      end)::real as score,
      null::real as sim
    from famed x
    order by case when x.cls <= 3 then 0 else x.cls end, 5 desc, x.popularity desc, x.id
    limit n
  ),
  typo as (
    select p.id, p.name, p.popularity, 6::smallint as cls, 0::real as score, extensions.word_similarity(k, p.search_key) as sim
    from public.movie_people p
    where (select count(*) from top) < n
      and char_length(k) >= 4
      and k operator(extensions.<%) p.search_key
      and p.id not in (select tp.id from top tp)
    order by sim desc, p.popularity desc, p.id
    limit n
  ),
  hits as (
    select * from top
    union all
    select * from typo
  )
  -- Their best-known film, to tell namesakes apart in the dropdown.
  select h.id, h.name, h.popularity, k2.title
  from hits h
  left join lateral (
    select f.title
    from public.movie_credits c
    join public.movie_films f on f.id = c.film_id
    where c.person_id = h.id and not f.is_adult
    order by f.fame desc, f.id
    limit 1
  ) k2 on true
  order by case when h.cls <= 3 then 0 else h.cls end, h.score desc, h.sim desc nulls last, h.popularity desc, h.id
  limit n;
end;
$$;

-- create or replace keeps the existing grants (service_role only); restated for clarity.
revoke execute on function public.search_films(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.search_people(text, integer) from public, anon, authenticated;
grant execute on function public.search_films(text, integer, integer) to service_role;
grant execute on function public.search_people(text, integer) to service_role;
