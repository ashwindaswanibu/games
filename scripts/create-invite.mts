/**
 * Creates a single-use invite from the command line, for the very first account (before there is an
 * admin to create one in /admin). Uses the Supabase keys in `.env.local`.
 *
 *   npm run invite -- "<who it's for>"
 */
import { createInvite, INVITE_TTL_DAYS } from "@/server/invite";

const note = process.argv.slice(2).join(" ").trim();
if (!note || note.length > 40) {
  console.error('Usage: npm run invite -- "<who it\'s for, at most 40 characters>"');
  process.exit(1);
}

const code = await createInvite(null, note);
console.log(`Invite for ${note} (works once, expires in ${INVITE_TTL_DAYS} days):\n\n  ${code}\n`);
