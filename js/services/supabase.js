// Accounts and saved settings. Supabase holds one profile row (the linked
// Sleeper account) and one row per league per user; row-level security
// limits every query to the signed-in user's own rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || "Couldn't reach your account.");
  return data;
}

// --- auth ---

// Calls `callback(session | null)` now and whenever sign-in state changes.
// Deferred because awaiting other Supabase calls inside the auth listener
// itself can deadlock the client.
export function watchSession(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => callback(session), 0);
  });
}

export async function sendMagicLink(email) {
  const redirectTo = `${location.origin}${location.pathname}`;
  unwrap(await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }));
}

// The code from the same email, for when the link would open in a different
// browser than the one signing in (e.g. a home-screen app on iPhone).
export async function verifyEmailCode(email, token) {
  unwrap(await supabase.auth.verifyOtp({ email, token, type: "email" }));
}

export async function signOut() {
  unwrap(await supabase.auth.signOut());
}

// --- profile ---

export async function getProfile(userId) {
  const row = unwrap(
    await supabase
      .from("profiles")
      .select("sleeper_username, sleeper_user_id")
      .eq("user_id", userId)
      .maybeSingle()
  );
  if (!row || !row.sleeper_user_id) return null;
  return { sleeperUsername: row.sleeper_username || "", sleeperUserId: row.sleeper_user_id };
}

export async function saveProfile(userId, { sleeperUsername, sleeperUserId }) {
  unwrap(
    await supabase.from("profiles").upsert({
      user_id: userId,
      sleeper_username: sleeperUsername,
      sleeper_user_id: sleeperUserId,
      updated_at: new Date().toISOString(),
    })
  );
}

// --- leagues ---

export async function getLeagues(userId, season) {
  const rows = unwrap(
    await supabase
      .from("leagues")
      .select("league_id, name, enabled")
      .eq("user_id", userId)
      .eq("season", season)
      .order("sort")
  );
  return (rows || []).map((r) => ({ leagueId: r.league_id, name: r.name, enabled: r.enabled }));
}

// Makes the saved list match `leagues` (what Sleeper reports for the season):
// new leagues are added switched on, names are refreshed, the on/off choice
// for existing ones is kept, and leagues the user has left are removed.
export async function syncLeagues(userId, season, leagues) {
  if (leagues.length > 0) {
    unwrap(
      await supabase.from("leagues").upsert(
        leagues.map((l, index) => ({
          user_id: userId,
          league_id: l.leagueId,
          season,
          name: l.name,
          sort: index,
        })),
        { onConflict: "user_id,league_id" }
      )
    );
  }
  const keep = leagues.map((l) => l.leagueId);
  let stale = supabase.from("leagues").delete().eq("user_id", userId).eq("season", season);
  if (keep.length > 0) stale = stale.not("league_id", "in", `(${keep.join(",")})`);
  unwrap(await stale);
}

export async function clearLeagues(userId) {
  unwrap(await supabase.from("leagues").delete().eq("user_id", userId));
}

export async function setLeagueEnabled(userId, leagueId, enabled) {
  unwrap(
    await supabase
      .from("leagues")
      .update({ enabled })
      .eq("user_id", userId)
      .eq("league_id", leagueId)
  );
}
