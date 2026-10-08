-- Film search in the browser (src/games/_movies/film-index.ts): every film players can find, as
-- compact JSON, in parts small enough for one function response each (Vercel caps a response at
-- 4.5 MB; the whole catalog is about 4 MB). One element per film:
--   [id, year, [up to 2 directors], fame, [display title, its other names…]]
-- The browser derives each name's search keys itself (src/games/_movies/search-key.ts, the same as
-- catalog_search_key). Adult films (is_adult) are left out, as search_films leaves them out.
create function public.catalog_film_index(p_part integer, p_parts integer)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    json_agg(
      json_build_array(
        f.id,
        f.year,
        coalesce(to_json(f.directors[1:2]), '[]'::json),
        f.fame,
        (select json_agg(t.title order by t.kind <> 'display', t.title) from public.movie_film_titles t where t.film_id = f.id)
      )
      order by f.id
    )::text,
    '[]'
  )
  from public.movie_films f
  where not f.is_adult and f.id % p_parts = p_part
$$;

revoke execute on function public.catalog_film_index(integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_film_index(integer, integer) to service_role;
