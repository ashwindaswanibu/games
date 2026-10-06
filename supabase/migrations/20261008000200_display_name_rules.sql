-- Display names are the main label on every board, so they must be visible and unambiguous.
-- The app (src/lib/validation.ts) normalizes to NFC and rejects control, format (zero-width, bidi
-- override) and blank-looking filler characters; this is the database half of the same rule, plus
-- case-insensitive uniqueness so one player can't take another's name.
--
-- U+200D (zero-width joiner) is allowed here because emoji sequences use it; the app only accepts
-- it between two emoji.
--
-- Before applying to an existing database, check nothing violates it:
--   select lower(display_name), count(*) from public.profiles group by 1 having count(*) > 1;

alter table public.profiles
  add constraint profiles_display_name_visible_check check (
    display_name !~ '[[:cntrl:]­؜ᅟᅠ᠎​‌‎‏ -‮⁠-⁯⠀ㅤ﻿ﾠ]'
  );

create unique index profiles_display_name_lower_key on public.profiles (lower(display_name));
