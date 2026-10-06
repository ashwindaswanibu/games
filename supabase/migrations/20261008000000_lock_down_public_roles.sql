-- Lock the public API roles out of the public schema entirely.
--
-- The app never reads or writes tables with a user's session: the server authenticates the caller
-- and then uses the service role (CLAUDE.md). But the Supabase URL and publishable key are public,
-- and anyone who completes a Supabase Auth sign-up (no invite code needed) holds an
-- `authenticated` token. Until now that token could read every profile (usernames, display names,
-- who is an admin) through PostgREST, and anon/authenticated kept Supabase's default full DML
-- grants on every table, so RLS was the only thing standing between them and the data.
--
-- After this migration anon and authenticated have no table, sequence or function privileges in
-- `public` at all, and objects created later don't get them by default. RLS stays enabled on every
-- table as a second layer. Only the service role (the server) can touch the data.

-- ---------------------------------------------------------------------------------------------
-- Policies the app never used
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Players can see every profile" on public.profiles;
drop policy if exists "Players can see their own plays" on public.plays;

-- ---------------------------------------------------------------------------------------------
-- Existing objects
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Make the server's access explicit rather than relying on defaults.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- Objects created by later migrations (which run as `postgres`)
-- ---------------------------------------------------------------------------------------------

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
-- EXECUTE for PUBLIC is a global default, so it can only be revoked globally (not per schema).
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Reclaiming a username held by an orphaned auth user
-- ---------------------------------------------------------------------------------------------

-- Password accounts use a predictable synthetic email (<username>@users.daily.invalid). If an auth
-- user holds that email but has no profile (someone registered it straight through Supabase Auth,
-- or a sign-up crashed between creating the user and its profile), the real player would be told
-- the username is taken forever. The sign-up action uses this to find such a user and remove it.
-- Server only: SECURITY DEFINER because the service role can't read auth.users through PostgREST.
create function public.orphan_auth_user_for_email(p_email text)
returns table (id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.created_at
  from auth.users u
  where u.email = lower(p_email)
    and not exists (select 1 from public.profiles p where p.id = u.id);
$$;

revoke all on function public.orphan_auth_user_for_email(text) from public, anon, authenticated;
grant execute on function public.orphan_auth_user_for_email(text) to service_role;
