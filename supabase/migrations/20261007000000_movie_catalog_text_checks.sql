-- The catalog enforces the same text contract the Movies games' zod schemas expect
-- (src/games/_movies/schemas.ts): at most 20 genres of 1–60 characters, at most 10 directors of
-- 1–200 characters, each measured after trimming. Before this, only the arrays' null-freedom was
-- checked, so a hand edit or a future importer could store a film every guess of which failed
-- validation. The server also sanitizes on read (`toFilmDetails`); this stops bad rows at write time.

-- True when every element, trimmed, is 1..max_length characters long (an empty array passes).
create function public.text_array_ok(items text[], max_length integer)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(bool_and(item is not null and char_length(btrim(item)) between 1 and max_length), true)
  from unnest(items) as item;
$$;

revoke all on function public.text_array_ok(text[], integer) from public, anon, authenticated;

alter table public.movie_films
  add constraint movie_films_genres_text_check check (cardinality(genres) <= 20 and public.text_array_ok(genres, 60)),
  add constraint movie_films_directors_text_check check (cardinality(directors) <= 10 and public.text_array_ok(directors, 200));
