// App-wide configuration. The publishable key is meant to ship to browsers:
// every table is protected by row-level security, so it grants nothing on
// its own.

export const SUPABASE_URL = "https://whzscbcoduaxbjcftuce.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MwuAMcmCyhbR5ze9VoZKcA_55HTQJX1";

// How often scores are re-pulled from Sleeper.
export const LIVE_POLL_MS = 30 * 1000; // a game is on (or kicks off today)
export const IDLE_POLL_MS = 5 * 60 * 1000; // nothing happening right now
