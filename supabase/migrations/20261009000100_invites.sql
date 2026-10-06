-- Single-use invites instead of one shared invite code.
--
-- With a shared code, any player could mint alt accounts at will, play today's puzzle on an alt to
-- learn the answer, then score perfectly on their main account (and an outsider who got hold of
-- the code could join). Now an admin creates one invite per new player in /admin, the invite works
-- once and expires, and every account records the invite it came from, so admins can see who
-- invited whom.
--
-- Only a SHA-256 hash of the code is stored: the code itself is shown once to the admin who
-- created it. Codes carry 100 random bits, so guessing one is hopeless (guesses are also rate
-- limited by the app).

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Who the invite is for, so admins can tell invites (and the accounts they made) apart.
  note        text not null check (char_length(btrim(note)) between 1 and 40),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_by     uuid unique references public.profiles (id) on delete set null,
  used_at     timestamptz,
  -- `used_at` marks the invite as spent for good, even if its player is later deleted.
  constraint invites_used_by_has_used_at check (used_by is null or used_at is not null),
  constraint invites_expire_after_creation check (expires_at > created_at)
);

create index invites_created_at_idx on public.invites (created_at desc);

-- No policies and no grants for the public API roles (default privileges from the lock-down
-- migration): only the service role touches invites.
alter table public.invites enable row level security;

-- Creates the player's profile and spends the invite in one transaction, so an invite makes at most
-- one account even when two sign-ups race with the same code. Returns false (and creates nothing)
-- if the invite doesn't exist, is used or has expired. Profile constraint violations (a taken
-- username or display name) raise as usual.
create function public.redeem_invite(p_token_hash text, p_user_id uuid, p_username text, p_display_name text)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  invite_id uuid;
begin
  select i.id into invite_id
  from public.invites i
  where i.token_hash = p_token_hash and i.used_at is null and i.expires_at > now()
  for update;
  if invite_id is null then
    return false;
  end if;

  insert into public.profiles (id, username, display_name)
  values (p_user_id, p_username, p_display_name);

  update public.invites set used_by = p_user_id, used_at = now() where id = invite_id;
  return true;
end;
$$;

revoke all on function public.redeem_invite(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text, uuid, text, text) to service_role;
