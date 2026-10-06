-- Sign-up is open (owner decision): no invite codes at all.
--
-- Removes everything `20261009000100_invites` created. That migration stays in the history
-- because migrations are never edited once applied (it already ran on local databases); on a
-- database that has neither, the two run back to back and leave nothing behind.
--
-- Nothing else referenced invites: profiles never pointed at them (the foreign keys went from
-- invites to profiles), so dropping the table loses only the record of who invited whom.

drop function if exists public.redeem_invite(text, uuid, text, text);
drop table if exists public.invites;
