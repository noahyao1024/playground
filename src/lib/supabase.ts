import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Null when the environment does not describe a project.
 *
 *  These two used to fall back to the production URL and anon key written into
 *  this file. The key is public by design -- it ships in the browser bundle and
 *  RLS holds it to reads -- so it was not a leak, but the fallback was still the
 *  wrong shape: an environment that forgot to set these did not fail, it quietly
 *  attached to production. That is the last thing a preview or a second
 *  deployment should do, and it meant the project could not be pointed anywhere
 *  else without editing source.
 *
 *  Every caller already handles null by falling back to localStorage; until now
 *  those branches could not be reached, because the fallback guaranteed a
 *  client. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
