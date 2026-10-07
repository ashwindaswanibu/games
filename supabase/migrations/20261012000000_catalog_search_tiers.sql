-- Catalog search, second pass, after a review of the ~60k-film catalog's results:
--
--  1. Two kinds of prefix match. A name that *starts with* the query may still outrank an exact
--     title when it has ten times the votes ("the dark" → The Dark Knight, not a little-known film
--     called The Dark). A name in which only a *later word* starts with the query never outranks
--     an exact title: "stree" → Stree, not The Wolf of Wall Street; "guide" → Guide.
--  2. An exact match on a film's own (display) title beats an exact match on another film's other
--     name (alias, IMDb title, former title) unless that film has ten times the votes: "court" →
--     Court (2014), not Court – State Vs A Nobody (alias "Court"); "godfather" still → The
--     Godfather (alias "Godfather"), far better known than the Indian films called Godfather.
--  3. Spaces don't matter: a no-spaces key matches "xmen" to X-Men, "walle" to WALL-E, "raone" to
--     Ra.One, "shahrukh" to Shah Rukh Khan. Exact matches ignore spaces at any length, prefix
--     matches from 3 characters (shorter, "it" would also find "I, Tonya").
--  4. People rank like films: by popularity (Wikipedia editions) on a log scale, an exact name
--     ahead unless the other has ten times the editions, a later-word match never ahead of an
--     exact name. "deepika" → Deepika Padukone, not an IMDb-only "Deepika".
--
-- Tiers (both functions): 0 exact, 1 the name starts with the query, 2 a later word starts with
-- it (3+ characters), 3 substring (3+ characters), 4 typos (4+ characters, only when the others
-- found fewer than asked for). Tiers 0–2 are ranked together by score, where fame is
-- movie_films.fame (ln of IMDb votes) for films and ln(1 + popularity) for people:
--
--   exact title  fame + ln 10
--   starts       fame
--   later word   fame, capped just below the lowest-scoring exact title
--
-- An "exact title" is an exact match on a film's display title or, when no film's display title
-- matches exactly, on any of its names (people: any exact name). An exact match on another name
-- next to an exact display title ranks like a name that starts with the query (fame alone).

-- ---------------------------------------------------------------------------------------------
-- No-spaces keys
-- ---------------------------------------------------------------------------------------------

alter table public.movie_film_titles
  add column compact_key text generated always as (replace(public.catalog_search_key(title), ' ', '')) stored;
create index movie_film_titles_compact_idx on public.movie_film_titles (compact_key text_pattern_ops);
comment on column public.movie_film_titles.compact_key is
  'search_key without spaces, so "xmen" finds X-Men and "walle" WALL-E. Exact and prefix search use it.';

alter table public.movie_people
  add column compact_key text generated always as (replace(public.catalog_search_key(name), ' ', '')) stored;
create index movie_people_compact_idx on public.movie_people (compact_key text_pattern_ops);
comment on column public.movie_people.compact_key is
  'search_key without spaces, so "shahrukh" finds Shah Rukh Khan. Exact and prefix search use it.';

-- ---------------------------------------------------------------------------------------------
-- search_films (same signature and columns as before)
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
  -- The query without spaces, matched against compact_key.
  kc text := replace(public.catalog_search_key(coalesce(p_query, '')), ' ', '');
  n integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  -- Candidates kept per tier before films are deduplicated (a film can match by several names).
  per_tier integer := n * 4;
  max_edits integer := case when char_length(k) >= 7 then 2 else 1 end;
  -- Prefix matches ignore spaces from 3 characters on; a shorter query matches the spaced key.
  spaced boolean := char_length(kc) < 3;
  exact_bonus constant real := ln(10);
begin
  if k = '' then
    return;
  end if;

  if p_person is not null then
    -- One person's filmography: a few hundred names at most, so rank them all.
    return query
    with names as (
      select t.film_id, t.title, t.kind, t.fame, t.search_key, t.compact_key
      from public.movie_credits c
      join public.movie_film_titles t on t.film_id = c.film_id
      where c.person_id = p_person
    ),
    matched as (
      select
        x.film_id, x.title, x.kind, x.fame,
        case
          when x.compact_key = kc then 0
          when (spaced and x.search_key like k || '%') or (not spaced and x.compact_key like kc || '%') then 1
          when char_length(k) >= 3 and x.search_key like '% ' || k || '%' then 2
          when char_length(k) >= 3 and x.search_key like '%' || k || '%' then 3
          when char_length(k) >= 4 and (
            k operator(extensions.<%) x.search_key
            or (left(x.search_key, 1) = left(k, 1)
                and extensions.levenshtein_less_equal(k, left(x.search_key, char_length(k)), max_edits) <= max_edits)
          ) then 4
        end as tier,
        greatest(
          extensions.word_similarity(k, x.search_key),
          1 - extensions.levenshtein_less_equal(k, left(x.search_key, char_length(k)), 2)::real / char_length(k)
        ) as close
      from names x
    ),
    best as (
      select distinct on (m.film_id) m.*
      from matched m
      where m.tier is not null
      order by m.film_id, m.tier, (m.kind <> 'display'), m.close desc
    ),
    titled as (
      select b.*, (b.tier = 0 and (b.kind = 'display' or not exists (select 1 from best d where d.tier = 0 and d.kind = 'display'))) as exact_title
      from best b
    ),
    ranked as (
      select x.film_id, x.title, x.kind, x.fame, x.tier,
        case
          when x.exact_title then x.fame + exact_bonus
          when x.tier = 2 then least(x.fame, (select min(e.fame) from titled e where e.exact_title) + exact_bonus - 0.001)
          when x.tier = 4 then x.fame + 10 * x.close
          else x.fame
        end as score
      from titled x
    )
    -- Substring and typo matches sort last, so they only fill a list the real matches left short.
    select f.id, f.title, f.year, f.directors, f.fame, case when r.kind <> 'display' then r.title end
    from ranked r
    join public.movie_films f on f.id = r.film_id
    order by case when r.tier <= 2 then 0 else r.tier end, r.score desc, r.fame desc, f.id
    limit n;
    return;
  end if;

  return query
  with cand as (
    (select t.film_id, t.title, t.kind, t.fame, 0 as tier
     from public.movie_film_titles t
     where t.compact_key = kc)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 1
     from public.movie_film_titles t
     where spaced and t.search_key like k || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 1
     from public.movie_film_titles t
     where not spaced and t.compact_key like kc || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 2
     from public.movie_film_titles t
     where char_length(k) >= 3
       and t.search_key like '% ' || k || '%'
       and t.compact_key not like kc || '%'
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 3
     from public.movie_film_titles t
     where char_length(k) >= 3
       and t.search_key like '%' || k || '%'
       and t.compact_key not like kc || '%'
       and t.search_key not like '% ' || k || '%'
     order by t.fame desc
     limit per_tier)
  ),
  best as (
    select distinct on (c.film_id) c.*
    from cand c
    order by c.film_id, c.tier, (c.kind <> 'display'), c.fame desc
  ),
  titled as (
    select b.*, (b.tier = 0 and (b.kind = 'display' or not exists (select 1 from best d where d.tier = 0 and d.kind = 'display'))) as exact_title
    from best b
  ),
  top as (
    select x.film_id, x.title, x.kind, x.fame, x.tier,
      (case
        when x.exact_title then x.fame + exact_bonus
        when x.tier = 2 then least(x.fame, (select min(e.fame) from titled e where e.exact_title) + exact_bonus - 0.001)
        else x.fame
      end)::real as score
    from titled x
    order by case when x.tier <= 2 then 0 else x.tier end, 6 desc, x.fame desc, x.film_id
    limit n
  ),
  -- Runs only when the real matches left the list short (a one-time filter, so no scan otherwise).
  typo_cand as (
    select t.film_id, t.title, t.kind, t.fame, extensions.word_similarity(k, t.search_key) as close
    from public.movie_film_titles t
    where (select count(*) from top) < n
      and char_length(k) >= 4
      and k operator(extensions.<%) t.search_key
    union all
    select t.film_id, t.title, t.kind, t.fame, 1 - extensions.levenshtein_less_equal(k, left(t.search_key, char_length(k)), max_edits)::real / char_length(k)
    from public.movie_film_titles t
    where (select count(*) from top) < n
      and char_length(k) >= 4
      and t.search_key like left(k, 1) || '%'
      and extensions.levenshtein_less_equal(k, left(t.search_key, char_length(k)), max_edits) <= max_edits
  ),
  typo as (
    select y.film_id, y.title, y.kind, y.fame, 4 as tier, (y.fame + 10 * y.close)::real as score
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
  order by case when h.tier <= 2 then 0 else h.tier end, h.score desc, h.fame desc, h.film_id
  limit n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- search_people (same signature and columns as before)
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
  spaced boolean := char_length(kc) < 3;
  exact_bonus constant real := ln(10);
begin
  if k = '' then
    return;
  end if;

  return query
  with cand as (
    (select p.id, p.name, p.popularity, 0 as tier
     from public.movie_people p
     where p.compact_key = kc)
    union all
    (select p.id, p.name, p.popularity, 1
     from public.movie_people p
     where spaced and p.search_key like k || '%' and p.compact_key <> kc
     order by p.popularity desc
     limit n)
    union all
    (select p.id, p.name, p.popularity, 1
     from public.movie_people p
     where not spaced and p.compact_key like kc || '%' and p.compact_key <> kc
     order by p.popularity desc
     limit n)
    union all
    (select p.id, p.name, p.popularity, 2
     from public.movie_people p
     where char_length(k) >= 3
       and p.search_key like '% ' || k || '%'
       and p.compact_key not like kc || '%'
     order by p.popularity desc
     limit n)
    union all
    (select p.id, p.name, p.popularity, 3
     from public.movie_people p
     where char_length(k) >= 3
       and p.search_key like '%' || k || '%'
       and p.compact_key not like kc || '%'
       and p.search_key not like '% ' || k || '%'
     order by p.popularity desc
     limit n)
  ),
  best as (
    select distinct on (c.id) c.*
    from cand c
    order by c.id, c.tier
  ),
  top as (
    select b.id, b.name, b.popularity, b.tier,
      (case
        when b.tier = 0 then ln(1 + b.popularity) + exact_bonus
        when b.tier = 2 then least(ln(1 + b.popularity), (select min(ln(1 + e.popularity)) from best e where e.tier = 0) + exact_bonus - 0.001)
        else ln(1 + b.popularity)
      end)::real as score,
      null::real as sim
    from best b
    order by case when b.tier <= 2 then 0 else b.tier end, 5 desc, b.popularity desc, b.id
    limit n
  ),
  typo as (
    select p.id, p.name, p.popularity, 4 as tier, 0::real as score, extensions.word_similarity(k, p.search_key) as sim
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
    where c.person_id = h.id
    order by f.fame desc, f.id
    limit 1
  ) k2 on true
  order by case when h.tier <= 2 then 0 else h.tier end, h.score desc, h.sim desc nulls last, h.popularity desc, h.id
  limit n;
end;
$$;

-- create or replace keeps the existing grants (service_role only); restated for clarity.
revoke execute on function public.search_films(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.search_people(text, integer) from public, anon, authenticated;
grant execute on function public.search_films(text, integer, integer) to service_role;
grant execute on function public.search_people(text, integer) to service_role;
