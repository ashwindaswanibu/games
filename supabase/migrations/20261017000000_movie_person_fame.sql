-- How well known a catalog person is to the site's players: how often English Wikipedia readers
-- open their article (the median of its daily views over the last 60 days). Degrees of Separation
-- picks its start and end actors by it, so a day's two names are people players know. Wikipedia's
-- language editions (movie_people.popularity) measure how widely a career travelled, not who
-- players know: a star of one country's cinema can top it and be a stranger here.
--
-- Written by the content pipeline (`content:movies:fame`), measured again now and then. A person
-- measured without an English article has a row with no title and no views, so the next run knows
-- they were looked at.
create table public.movie_person_fame (
  person_id integer primary key references public.movie_people (id) on delete cascade,
  en_title text check (char_length(en_title) between 1 and 300),
  daily_views integer not null check (daily_views >= 0),
  measured_at timestamptz not null default now()
);

comment on table public.movie_person_fame is
  'English Wikipedia readership of catalog people: the median daily views of their article over the last 60 days, for Degrees of Separation''s start and end actors. Written by content:movies:fame.';

alter table public.movie_person_fame enable row level security;
revoke all on table public.movie_person_fame from anon, authenticated;
