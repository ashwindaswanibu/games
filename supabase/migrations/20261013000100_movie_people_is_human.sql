-- Degrees of Separation starts and ends at people: `movie_people.is_human` records whether Wikidata
-- says a catalog person is an instance of human (Q5). Groups credited as one cast member (Marx
-- Brothers, The Beatles, The Three Stooges) and animals (Lassie, Rin Tin Tin) are false; people
-- without a Wikidata item are null (IMDb's names are people). Set by the catalog import; until an
-- import has run it is null everywhere, which excludes nobody.

alter table public.movie_people add column is_human boolean;
comment on column public.movie_people.is_human is
  'Wikidata says this is a human (instance of Q5): true; a Wikidata item that is not (a group, an animal): false; no Wikidata item: null. Set by the catalog import; Degrees never starts or ends at false.';
