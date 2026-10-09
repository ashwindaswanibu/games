-- Portraits of catalog people, for Degrees of Separation's thread: one face per person, cropped and
-- toned by the content pipeline (`content:movies:portraits`) from the photo Wikidata lists for them
-- on Wikimedia Commons. Only freely licensed photos (public domain, CC0, CC BY, CC BY-SA), each
-- kept with what its license asks us to show: the author, the license and the file's page.
--
-- Served by /api/catalog/portraits (the app's server, with the service role): no player reads this
-- table directly. A face isn't a secret (it's no more than the name next to it), so the bytes are
-- served publicly and cached for good; `version` (a hash of the bytes) is in the URL.
create table public.movie_person_portraits (
  person_id integer primary key references public.movie_people (id) on delete cascade,
  bytes bytea not null,
  version text not null check (version ~ '^[0-9a-f]{12}$'),
  width smallint not null check (width between 1 and 2048),
  height smallint not null check (height between 1 and 2048),
  source_file text not null check (char_length(source_file) between 1 and 300),
  source_url text not null check (source_url ~ '^https://commons\.wikimedia\.org/'),
  author text check (char_length(author) between 1 and 300),
  license text not null check (char_length(license) between 1 and 80),
  license_url text check (license_url ~ '^https?://'),
  updated_at timestamptz not null default now()
);

comment on table public.movie_person_portraits is
  'One WebP face per catalog person, from their Wikimedia Commons photo (Wikidata P18), with the photo''s author, license and page for the credit its license requires. Written by content:movies:portraits.';

alter table public.movie_person_portraits enable row level security;
revoke all on table public.movie_person_portraits from anon, authenticated;
