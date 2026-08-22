import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
}
if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY in environment')
}

/**
 * Service role client — bypasses RLS. Used for all writes and admin reads.
 * NEVER expose this key to the browser.
 */
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Anon client — subject to RLS. Used for public read-only queries.
 * RLS policy on the projects table allows SELECT for the anon role.
 * This client cannot insert, update, or delete anything.
 * Safe to use for public-facing reads as a defence-in-depth measure:
 * even if this key were extracted it grants only read access to
 * data that is already publicly visible through the API.
 */
export const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)
