-- Catalog search, third pass, after a second review of the ~60k-film catalog's results:
--
--  1. A match right after a leading "the", "a" or "an" starts the name: "dark" → The Dark Knight
--     ranks like a name that starts with "dark" (it ranked as a later-word match, below every
--     exact title, since 20261012000000).
--  2. Whole words count. A name that starts with the query as a whole word ("stree" → Stree 2)
--     outranks one where the query ends mid-word (Street Kings) unless that one has three times
--     the votes; an exact title outranks a whole-word start unless that one has ten times the
--     votes (the rule so far).
--  3. A query that ends mid-word inside a *later* word ("stree" in The Wolf of Wall Street) ranks
--     below every name that starts with the query, as a group of its own; a later whole word
--     ("guide" in The Hitchhiker's Guide to the Galaxy) still ranks with them, never above an
--     exact title.
--  4. Sequel numbers: "godfather 2" finds The Godfather Part II. Names and queries are compared
--     with "part"/"chapter"/"vol."/"volume"/"episode" before a number dropped and roman numerals
--     (and "two"… after those words) written as digits (`catalog_number_key`).
--  5. People rank by the films they are in, not by Wikipedia editions: their fame is ln(1 + the
--     IMDb votes of every film they're credited in, a film counting fully when they're billed in
--     its top four, a quarter when 5th–10th and a tenth otherwise). "salman" → Salman Khan, not
--     Salman Rushdie (more Wikipedia editions, one cameo); "george" → George Clooney.
--
-- Match classes (`catalog_match_class`, one definition for films, filmographies and people):
--   0 exact (spaces and punctuation ignored)
--   1 the name starts with the query as whole words (after a leading article too)
--   2 the name starts with the query, ending mid-word (after a leading article too)
--   3 a later word starts with the query, ending at a word end (3+ characters)
--   4 a later word starts with the query, ending mid-word (3+ characters)
--   5 substring (3+ characters)
-- (then typos: 4+ characters, only when the others found fewer results than asked for).
--
-- Classes 0–3 rank together by score; then class 4, class 5 and typos, each by score:
--   exact title             fame + ln 30
--   class 0 or 1            fame + ln 3     (an exact alias next to an exact display title is class 0)
--   class 2                 fame
--   class 3                 fame, capped just below the lowest-scoring exact title
-- where fame is movie_films.fame (ln of IMDb votes) for films and the credit-weighted votes above
-- for people. An "exact title" is an exact match on a film's display title or, when no film's
-- display title matches exactly, on any of its names (people: any exact name).

-- ---------------------------------------------------------------------------------------------
-- Sequel numbers
-- ---------------------------------------------------------------------------------------------

-- A search key (see catalog_search_key) with sequel numbering normalized: roman numerals ii–xx,
-- and i, v, x after a sequel word, become digits; "one"…"ten" become digits after a sequel word;
-- the sequel word itself is dropped before a number. "the godfather part ii" → "the godfather 2",
-- "dune part two" → "dune 2", "kill bill vol 2" → "kill bill 2", "star wars episode iv a new hope"
-- → "star wars 4 a new hope". Single letters elsewhere are left alone ("i robot", "x men").
create function public.catalog_number_key(key text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select case
    -- Most names have nothing to rewrite.
    when key !~ '\m(part|pt|chapter|vol|volume|episode|[ivx]{2,5})\M' then key
    else (
      with words as (
        select w.word, w.n, lag(w.word) over (order by w.n) as prev
        from regexp_split_to_table(key, ' ') with ordinality as w(word, n)
      ),
      numbered as (
        select x.n, x.word,
          case
            when x.word ~ '^[0-9]+$' then x.word
            when r.digits is not null and (char_length(x.word) > 1 or x.prev in ('part', 'pt', 'chapter', 'vol', 'volume', 'episode')) then r.digits
            when s.digits is not null and x.prev in ('part', 'pt', 'chapter', 'vol', 'volume', 'episode') then s.digits
          end as number
        from words x
        left join (values ('i', '1'), ('ii', '2'), ('iii', '3'), ('iv', '4'), ('v', '5'), ('vi', '6'), ('vii', '7'), ('viii', '8'),
                          ('ix', '9'), ('x', '10'), ('xi', '11'), ('xii', '12'), ('xiii', '13'), ('xiv', '14'), ('xv', '15'),
                          ('xvi', '16'), ('xvii', '17'), ('xviii', '18'), ('xix', '19'), ('xx', '20')) as r(word, digits)
          on r.word = x.word
        left join (values ('one', '1'), ('two', '2'), ('three', '3'), ('four', '4'), ('five', '5'), ('six', '6'), ('seven', '7'),
                          ('eight', '8'), ('nine', '9'), ('ten', '10')) as s(word, digits)
          on s.word = x.word
      )
      select coalesce(string_agg(coalesce(y.number, y.word), ' ' order by y.n), '')
      from (select z.*, lead(z.number) over (order by z.n) as next_number from numbered z) y
      where not (y.word in ('part', 'pt', 'chapter', 'vol', 'volume', 'episode') and y.next_number is not null)
    )
  end
$$;

-- Only names with sequel numbering get one (about 1% of them), so the index stays small.
alter table public.movie_film_titles
  add column number_key text generated always as (
    nullif(public.catalog_number_key(public.catalog_search_key(title)), public.catalog_search_key(title))
  ) stored;
create index movie_film_titles_number_idx on public.movie_film_titles (number_key text_pattern_ops) where number_key is not null;
comment on column public.movie_film_titles.number_key is
  'search_key with sequel numbering as digits ("the godfather 2" for The Godfather Part II), or null when that is the search_key itself. Search matches numbered queries against it.';

-- ---------------------------------------------------------------------------------------------
-- Match classes
-- ---------------------------------------------------------------------------------------------

-- How `name_key` matches `query_key` (both search keys): the classes in the header, or null.
-- Starts and exact matches ignore spaces from 3 characters of query on (a shorter query must
-- match the spaced name, or "it" would find "I, Tonya"); later-word and substring matches need
-- 3+ characters.
create function public.catalog_match_class(name_key text, query_key text)
returns smallint
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  with q as (
    select
      replace(query_key, ' ', '') as compact,
      -- The query's letters with optional spaces between them, then a word end: "d ?o ?n( |$)".
      '^' || regexp_replace(replace(query_key, ' ', ''), '(.)(?!$)', '\1 ?', 'g') || '( |$)' as whole_start
  ),
  n as (
    select
      name_key as full_name,
      -- The name without a leading article, or null.
      case when name_key ~ '^(the|a|an) ' then substr(name_key, strpos(name_key, ' ') + 1) end as bare
  ),
  s as (
    select
      q.*,
      n.*,
      case when char_length(q.compact) >= 3 then replace(n.full_name, ' ', '') like q.compact || '%' else n.full_name like query_key || '%' end as starts,
      n.bare is not null
        and case when char_length(q.compact) >= 3 then replace(n.bare, ' ', '') like q.compact || '%' else n.bare like query_key || '%' end as bare_starts
    from q, n
  )
  select case
    when s.compact = '' then null
    when replace(s.full_name, ' ', '') = s.compact then 0
    when (s.starts and s.full_name ~ s.whole_start) or (s.bare_starts and s.bare ~ s.whole_start) then 1
    when s.starts or s.bare_starts then 2
    when char_length(query_key) >= 3 and s.full_name like '% ' || query_key || '%' then
      case when s.full_name ~ (' ' || query_key || '( |$)') then 3 else 4 end
    when char_length(query_key) >= 3 and s.full_name like '%' || query_key || '%' then 5
  end::smallint
  from s
$$;

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
      where c.person_id = p_person
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
     where t.compact_key = kc)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where spaced and t.search_key like k || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where not spaced and t.compact_key like kc || '%' and t.compact_key <> kc
     order by t.fame desc
     limit per_tier)
    union all
    -- After a leading article: "dark" → The Dark Knight.
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where spaced and (t.search_key like 'the ' || k || '%' or t.search_key like 'a ' || k || '%' or t.search_key like 'an ' || k || '%')
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where not spaced
       and ((t.compact_key like 'the' || kc || '%' and t.search_key like 'the %')
         or (t.compact_key like 'a' || kc || '%' and t.search_key like 'a %')
         or (t.compact_key like 'an' || kc || '%' and t.search_key like 'an %'))
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where char_length(k) >= 3
       and t.search_key like '% ' || k || '%'
       and t.compact_key not like kc || '%'
     order by t.fame desc
     limit per_tier)
    union all
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where char_length(k) >= 3
       and t.search_key like '%' || k || '%'
       and t.compact_key not like kc || '%'
       and t.search_key not like '% ' || k || '%'
     order by t.fame desc
     limit per_tier)
    union all
    -- Sequel numbers: "godfather 2" → The Godfather Part II.
    (select t.film_id, t.title, t.kind, t.fame, t.search_key, t.number_key
     from public.movie_film_titles t
     where numbered
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
      where cr.person_id = b.id
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
    where c.person_id = h.id
    order by f.fame desc, f.id
    limit 1
  ) k2 on true
  order by case when h.cls <= 3 then 0 else h.cls end, h.score desc, h.sim desc nulls last, h.popularity desc, h.id
  limit n;
end;
$$;

-- create or replace keeps the existing grants (service_role only); restated for clarity, with the
-- new helpers (the search functions run as their caller, so it needs them too).
revoke execute on function public.catalog_number_key(text) from public, anon, authenticated;
revoke execute on function public.catalog_match_class(text, text) from public, anon, authenticated;
revoke execute on function public.search_films(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.search_people(text, integer) from public, anon, authenticated;
grant execute on function public.catalog_number_key(text) to service_role;
grant execute on function public.catalog_match_class(text, text) to service_role;
grant execute on function public.search_films(text, integer, integer) to service_role;
grant execute on function public.search_people(text, integer) to service_role;
