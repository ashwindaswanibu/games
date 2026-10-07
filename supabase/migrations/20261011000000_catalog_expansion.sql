-- A much bigger movie catalog (scripts/content/movies/catalog.mts: IMDb's non-commercial datasets
-- choose the films, Wikidata adds detail). This migration adds what that catalog needs:
--
--   1. `movie_films.imdb_votes` and a generated `fame` that ranks search. `popularity` keeps its
--      meaning everywhere it is used today: Wikipedia language editions (Wikidata sitelinks).
--   2. `movie_people.imdb_id`, so IMDb's top-billed cast lands on the same person as Wikidata's.
--   3. `movie_film_titles`: every name a film is known by (display title, IMDb's titles, Wikidata's
--      English label and aliases, the English Wikipedia title, former display titles), so
--      "Kabhi Khushi Kabhie Gham", "K3G" and "Sometimes Happiness Sometimes Sadness" all find it.
--   4. Catalog ids that can never change: stored puzzles, solutions and plays reference them as
--      JSON, where no foreign key can protect them.
--   5. Staged `search_films` / `search_people` that stay fast on ~60k films and ~150k people.

-- ---------------------------------------------------------------------------------------------
-- 1. Fame
-- ---------------------------------------------------------------------------------------------

alter table public.movie_films
  add column imdb_votes integer check (imdb_votes >= 0),
  -- IMDb votes when IMDb rates the film, otherwise an estimate from Wikipedia editions (catalog
  -- films average about 437 votes per edition). Generated, so every writer (fixtures only set
  -- popularity) gets a consistent rank. Log scale: only the order matters.
  add column fame real generated always as (ln(1 + coalesce(imdb_votes::real, popularity * 437))) stored;

comment on column public.movie_films.popularity is
  'Wikipedia language editions with an article on the film (Wikidata sitelinks); 0 for a film with no Wikidata item. Puzzle generators and decoys rank by this.';
comment on column public.movie_films.imdb_votes is
  'IMDb rating votes (title.ratings numVotes) when IMDb rates the film, else null.';
comment on column public.movie_films.fame is
  'ln(1 + IMDb votes), or ln(1 + 437 × popularity) when IMDb has no rating. Ranks catalog search.';

create index movie_films_fame_idx on public.movie_films (fame desc);
-- Film search moves to movie_film_titles (below); the title index on movie_films is unused.
drop index public.movie_films_search_trgm_idx;

-- ---------------------------------------------------------------------------------------------
-- 2. People's IMDb ids
-- ---------------------------------------------------------------------------------------------

alter table public.movie_people add column imdb_id text unique check (imdb_id ~ '^nm[0-9]{7,10}$');
comment on column public.movie_people.popularity is
  'Wikipedia language editions with an article on the person (Wikidata sitelinks); 0 for a person known only to IMDb.';

-- Exact and prefix matches for the staged people search.
create index movie_people_search_prefix_idx on public.movie_people (search_key text_pattern_ops);

-- ---------------------------------------------------------------------------------------------
-- 3. Every searchable name of a film
-- ---------------------------------------------------------------------------------------------

create table public.movie_film_titles (
  film_id    integer not null references public.movie_films (id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 300),
  -- display: movie_films.title (kept in sync by trigger); original: IMDb's titles; alias: Wikidata
  -- label, aliases and the English Wikipedia title; former: a display title the film used to have.
  kind       text not null check (kind in ('display', 'original', 'alias', 'former')),
  -- Copy of movie_films.fame (kept in sync by trigger), so search sorts without a join.
  fame       real not null default 0,
  search_key text generated always as (public.catalog_search_key(title)) stored,
  -- One row per distinct searchable name; names that normalize alike are one name.
  primary key (film_id, search_key)
);

create index movie_film_titles_trgm_idx on public.movie_film_titles using gin (search_key extensions.gin_trgm_ops);
create index movie_film_titles_prefix_idx on public.movie_film_titles (search_key text_pattern_ops);

alter table public.movie_film_titles enable row level security;
-- No policies: only the service role reads or writes the catalog.
revoke all on public.movie_film_titles from anon, authenticated;
grant select, insert, update, delete on public.movie_film_titles to service_role;

-- A title row always carries its film's current fame, whoever inserts it.
create function public.movie_film_titles_copy_fame()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select f.fame into new.fame from public.movie_films f where f.id = new.film_id;
  new.fame := coalesce(new.fame, 0);
  return new;
end;
$$;

create trigger movie_film_titles_copy_fame
  before insert on public.movie_film_titles
  for each row execute function public.movie_film_titles_copy_fame();

-- movie_films.title is always searchable, and a title it had before stays searchable ('former'),
-- so fixtures, the smoke test and any other writer never need to know about this table.
create function public.movie_films_sync_titles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.movie_film_titles (film_id, title, kind)
    values (new.id, new.title, 'display')
    on conflict (film_id, search_key) do update set title = excluded.title, kind = 'display';
    return null;
  end if;

  if new.title is distinct from old.title then
    update public.movie_film_titles set kind = 'former' where film_id = new.id and kind = 'display';
    insert into public.movie_film_titles (film_id, title, kind)
    values (new.id, new.title, 'display')
    on conflict (film_id, search_key) do update set title = excluded.title, kind = 'display';
  end if;
  if new.fame is distinct from old.fame then
    update public.movie_film_titles set fame = new.fame where film_id = new.id;
  end if;
  return null;
end;
$$;

create trigger movie_films_sync_titles
  after insert or update of title, imdb_votes, popularity on public.movie_films
  for each row execute function public.movie_films_sync_titles();

-- Every existing film's display title (the trigger above covers films written from now on).
insert into public.movie_film_titles (film_id, title, kind)
select id, title, 'display' from public.movie_films
on conflict (film_id, search_key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 4. Catalog ids never change
-- ---------------------------------------------------------------------------------------------

create function public.catalog_keep_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'catalog ids never change (% id % to %): stored puzzles and plays reference them', tg_table_name, old.id, new.id
      using errcode = '23000';
  end if;
  return new;
end;
$$;

create trigger movie_films_keep_id before update of id on public.movie_films
  for each row execute function public.catalog_keep_id();
create trigger movie_people_keep_id before update of id on public.movie_people
  for each row execute function public.catalog_keep_id();

revoke all on function public.movie_film_titles_copy_fame() from public, anon, authenticated;
revoke all on function public.movie_films_sync_titles() from public, anon, authenticated;
revoke all on function public.catalog_keep_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Search
--
-- Matches are tiered as before: 0 exact; 1 prefix of the name or of any word in it; 2 substring
-- (queries of 3+ characters); 3 typos (4+ characters), only when the earlier tiers found fewer
-- than `p_limit`. Films rank by fame and people by popularity. Two refinements for a catalog of
-- ~60k films:
--
--  * An exact title beats a prefix match unless the prefix match has ten times the votes (fame is
--    a log scale, so that is a bonus of ln 10): "the dark" means The Dark Knight before a little
--    known film called The Dark, while "it" and "her" still find It and Her first.
--  * Typos: trigram word similarity (as before) or, for short titles trigrams can't match, at most
--    one edit (two from 7 characters) against the start of a name beginning with the same
--    character: "sholey" finds Sholay, "3 idoits" 3 Idiots. Ranked by fame and closeness.
--
-- Each tier is its own sorted, limited query over an index, so a two-letter query doesn't rank
-- tens of thousands of rows. A film is listed once, under its best-matching name (the display
-- title on ties); `aka` is that name when it isn't the display title.
--
-- plan_cache_mode = force_custom_plan: the prefix tiers use the btree (text_pattern_ops) index,
-- which needs the LIKE pattern as a constant at plan time. A cached generic plan would scan.
-- ---------------------------------------------------------------------------------------------

create extension if not exists fuzzystrmatch with schema extensions;

drop function public.search_films(text, integer);

create function public.search_films(p_query text, p_limit integer default 8, p_person integer default null)
returns table (id integer, title text, year smallint, directors text[], fame real, aka text)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  k text := public.catalog_search_key(coalesce(p_query, ''));
  n integer := least(greatest(coalesce(p_limit, 8), 1), 25);
  -- Candidates kept per tier before films are deduplicated (a film can match by several names).
  per_tier integer := n * 4;
  max_edits integer := case when char_length(k) >= 7 then 2 else 1 end;
  exact_bonus constant real := ln(10);
begin
  if k = '' then
    return;
  end if;

  if p_person is not null then
    -- One person's filmography: a few hundred names at most, so rank them all.
    return query
    with names as (
      select t.film_id, t.title, t.kind, t.fame, t.search_key
      from public.movie_credits c
      join public.movie_film_titles t on t.film_id = c.film_id
      where c.person_id = p_person
    ),
    matched as (
      select
        x.film_id, x.title, x.kind, x.fame,
        case
          when x.search_key = k then 0
          when x.search_key like k || '%' or x.search_key like '% ' || k || '%' then 1
          when char_length(k) >= 3 and x.search_key like '%' || k || '%' then 2
          when char_length(k) >= 4 and (
            k operator(extensions.<%) x.search_key
            or (left(x.search_key, 1) = left(k, 1)
                and extensions.levenshtein_less_equal(k, left(x.search_key, char_length(k)), max_edits) <= max_edits)
          ) then 3
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
    )
    -- Typo matches sort last, so they only fill a list the real matches left short.
    select f.id, f.title, f.year, f.directors, f.fame, case when b.kind <> 'display' then b.title end
    from best b
    join public.movie_films f on f.id = b.film_id
    order by
      case when b.tier <= 1 then 0 else b.tier end,
      b.fame + case when b.tier = 0 then exact_bonus when b.tier = 3 then 10 * b.close else 0 end desc,
      f.id
    limit n;
    return;
  end if;

  return query
  with cand as (
    (select t.film_id, t.title, t.kind, t.fame, 0 as tier
     from public.movie_film_titles t
     where t.search_key = k)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 1
     from public.movie_film_titles t
     where t.search_key like k || '%' and t.search_key <> k
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 1
     from public.movie_film_titles t
     where char_length(k) >= 3 and t.search_key like '% ' || k || '%'
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, 2
     from public.movie_film_titles t
     where char_length(k) >= 3
       and t.search_key like '%' || k || '%'
       and t.search_key not like k || '%'
       and t.search_key not like '% ' || k || '%'
     order by t.fame desc
     limit per_tier)
  ),
  best as (
    select distinct on (c.film_id) c.*
    from cand c
    order by c.film_id, c.tier, (c.kind <> 'display'), c.fame desc
  ),
  top as (
    select b.film_id, b.title, b.kind, b.fame, b.tier, (b.fame + case when b.tier = 0 then exact_bonus else 0 end)::real as score
    from best b
    order by case when b.tier <= 1 then 0 else b.tier end, 6 desc, b.film_id
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
    select y.film_id, y.title, y.kind, y.fame, 3 as tier, (y.fame + 10 * y.close)::real as score
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
  order by case when h.tier <= 1 then 0 else h.tier end, h.score desc, h.film_id
  limit n;
end;
$$;

drop function public.search_people(text, integer);

create function public.search_people(p_query text, p_limit integer default 8)
returns table (id integer, name text, popularity real, known_for text)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  k text := public.catalog_search_key(coalesce(p_query, ''));
  n integer := least(greatest(coalesce(p_limit, 8), 1), 25);
begin
  if k = '' then
    return;
  end if;

  return query
  with cand as (
    (select p.id, p.name, p.popularity, 0 as tier
     from public.movie_people p
     where p.search_key = k)
    union all
    (select p.id, p.name, p.popularity, 1
     from public.movie_people p
     where p.search_key like k || '%' and p.search_key <> k
     order by p.popularity desc
     limit n)
    union all
    (select p.id, p.name, p.popularity, 1
     from public.movie_people p
     where char_length(k) >= 3 and p.search_key like '% ' || k || '%'
     order by p.popularity desc
     limit n)
    union all
    (select p.id, p.name, p.popularity, 2
     from public.movie_people p
     where char_length(k) >= 3
       and p.search_key like '%' || k || '%'
       and p.search_key not like k || '%'
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
    select b.*, null::real as sim
    from best b
    order by b.tier, b.popularity desc, b.id
    limit n
  ),
  typo as (
    select p.id, p.name, p.popularity, 3 as tier, extensions.word_similarity(k, p.search_key) as sim
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
  order by h.tier, h.sim desc nulls last, h.popularity desc, h.id
  limit n;
end;
$$;

revoke execute on function public.search_films(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.search_people(text, integer) from public, anon, authenticated;
grant execute on function public.search_films(text, integer, integer) to service_role;
grant execute on function public.search_people(text, integer) to service_role;
