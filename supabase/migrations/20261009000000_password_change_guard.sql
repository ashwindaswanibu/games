-- Passwords change only through the app's admin reset.
--
-- The Supabase URL and publishable key are public, so anyone holding a player's session (a stolen
-- `sb-…-auth-token` cookie carries both the access and the refresh token) can call
-- `PUT /auth/v1/user {"password": …}` directly. `secure_password_change` only demands
-- reauthentication for sessions older than 24 hours, and GoTrue then signs out every *other*
-- session: a freshly stolen session could take the account over and lock the owner out.
--
-- The app never changes a password through the user API: password accounts have no email, so an
-- admin sets a new password from /admin with the admin API. So every password change must be
-- pre-authorised by the server: it calls `allow_password_change(user)` (service role only) right
-- before the admin API call, and a trigger on auth.users refuses any password change without a
-- fresh, unused authorisation for that user. GoTrue rolls back the whole update (and the session
-- revocation that goes with it) and answers with an error.
--
-- Not affected: creating users (an INSERT), sign-in, and GoTrue re-hashing a password on sign-in to
-- move it to another bcrypt cost or algorithm (the hash scheme changes; an ordinary password change
-- keeps it). Recovering an owner's account without the app: insert a row into
-- public.password_change_grants (or call allow_password_change) in the SQL editor first, then set
-- the password with the admin API.

create table public.password_change_grants (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

-- No policies and no grants for the public API roles (default privileges from the lock-down
-- migration): only the service role and the trigger below touch it.
alter table public.password_change_grants enable row level security;

create function public.allow_password_change(p_user_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.password_change_grants (user_id, expires_at)
  values (p_user_id, now() + interval '1 minute')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
$$;

revoke all on function public.allow_password_change(uuid) from public, anon, authenticated;
grant execute on function public.allow_password_change(uuid) to service_role;

/** The `$<algorithm>$<cost>` prefix of a crypt-style hash, e.g. `$2a$10`. */
create function public.password_hash_scheme(p_hash text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || split_part(p_hash, '$', 2) || '$' || split_part(p_hash, '$', 3);
$$;

revoke all on function public.password_hash_scheme(text) from public, anon, authenticated;

-- SECURITY DEFINER: it runs inside GoTrue's update (as supabase_auth_admin), which has no access
-- to public tables.
create function public.guard_password_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;
  -- A re-hash of the same password by GoTrue changes the scheme (cost or algorithm).
  if coalesce(old.encrypted_password, '') <> ''
     and public.password_hash_scheme(old.encrypted_password) <> public.password_hash_scheme(new.encrypted_password) then
    return new;
  end if;

  delete from public.password_change_grants
  where user_id = new.id and expires_at > now();
  if not found then
    raise exception 'Passwords can only be changed by an admin from the app'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_password_change() from public, anon, authenticated;

create trigger guard_password_change
  before update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.guard_password_change();
