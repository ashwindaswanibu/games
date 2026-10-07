-- Catalog search: an apostrophe is part of its word.
--
-- The search key turned every run of non-alphanumerics into a space, so "Don't Look Up" was keyed
-- "don t look up": the query "don" matched it as a whole-word start (with that class's bonus) and,
-- with 15 times Don's IMDb votes, it ranked above Don (2006), an exact title. Now an apostrophe is
-- dropped instead: "dont look up", "oceans eleven", "schindlers list", "peter otoole". "don"
-- finds Don first and Don't Look Up as a mid-word start; "dont look up" and "don't look up" are
-- the same query. `unaccent` already turns every apostrophe-like character into "'" (’ ‘ ‛ ′ ＇
-- and the modifier letters ʹ ʻ ʼ ʽ ˈ; ŉ into "'n"), so one replace covers them all.
-- `catalogSearchKey` in src/games/_movies/search-key.ts changes with it.
--
-- The stored keys (movie_films.search_key, movie_people.search_key and compact_key,
-- movie_film_titles.search_key, compact_key and number_key) are generated from this function, so
-- every row whose key changes is recomputed below (locally: 2,429 films, 976 people and 4,356 of
-- the 102,427 searchable names, 49 of which merge with a name of the same film).

create or replace function public.catalog_search_key(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, value)), '''', ''), '[^[:alnum:]]+', ' ', 'g'));
$$;

comment on function public.catalog_search_key(text) is
  'Search normal form: lowercase, accents removed, apostrophes dropped (part of their word: "Don''t" → "dont"), every other run of non-alphanumerics one space, trimmed. Mirrored by catalogSearchKey (src/games/_movies/search-key.ts).';

-- Films and people: writing the name recomputes the generated keys (no trigger acts on it: the
-- title trigger only acts when the title or fame changes).
update public.movie_films set title = title where search_key is distinct from public.catalog_search_key(title);
update public.movie_people set name = name where search_key is distinct from public.catalog_search_key(name);

-- A film's searchable names are keyed (film_id, search_key): two names that differed only by an
-- apostrophe (Child's Play and its alias "Childs Play") now share a key and become one row.
-- The rows whose key changes are taken out and put back; where two collide, the display title
-- wins, then a former title, then IMDb's, then an alias (the display row must survive: the title
-- trigger relies on it). Taking them out first means no row can collide with another's old key.
do $$
begin
  create temporary table rekeyed as
    select t.film_id, t.title, t.kind
    from public.movie_film_titles t
    where t.search_key is distinct from public.catalog_search_key(t.title);

  delete from public.movie_film_titles t
  using rekeyed r
  where t.film_id = r.film_id and t.title = r.title;

  -- fame is copied from the film by the insert trigger.
  insert into public.movie_film_titles (film_id, title, kind)
  select distinct on (r.film_id, public.catalog_search_key(r.title)) r.film_id, r.title, r.kind
  from rekeyed r
  order by r.film_id, public.catalog_search_key(r.title), array_position(array['display', 'former', 'original', 'alias'], r.kind), r.title
  on conflict (film_id, search_key) do update
    set title = excluded.title, kind = excluded.kind
    where array_position(array['display', 'former', 'original', 'alias'], excluded.kind)
        < array_position(array['display', 'former', 'original', 'alias'], public.movie_film_titles.kind);

  drop table rekeyed;
end;
$$;
