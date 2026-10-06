-- Per-player request limits for route handlers that do real work per call (catalog search, puzzle
-- images). The app runs on several serverless instances, so the count lives here rather than in
-- memory. Fixed windows: one counter row per (key, window); `take_rate_limit` counts a request and
-- says whether it is within the limit, atomically.

-- Unlogged: counters are disposable (a crash just resets them) and skip WAL on every request.
create unlogged table public.rate_limits (
  key          text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits         integer not null check (hits >= 1),
  primary key (key, window_start)
);

-- No policies: only the service role, after the route has identified the caller.
alter table public.rate_limits enable row level security;

create function public.take_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  current_window timestamptz;
  taken integer;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'take_rate_limit: bad arguments' using errcode = '22023';
  end if;
  current_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, current_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into taken;

  -- This key's finished windows are never read again (a primary-key range delete, so cheap).
  delete from public.rate_limits where key = p_key and window_start < current_window;

  return taken <= p_limit;
end;
$$;

revoke all on function public.take_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text, integer, integer) to service_role;
