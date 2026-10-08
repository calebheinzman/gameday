// Accounts and saved settings. Supabase holds one profile row (the linked
// Sleeper account) and one row per league per user; row-level security
// limits every query to the signed-in user's own rows.
//
// Sign-in is username + password. Supabase password auth is keyed by email,
// so each username maps to an address on a reserved, undeliverable domain;
// email confirmation is off for the project, so nothing is ever sent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js?v=6";

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

const USERNAME_DOMAIN = "users.gameday.invalid";
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,24}$/;

// Lowercased username, or throws a readable error if it isn't allowed.
export function normalizeUsername(raw) {
  const username = String(raw || "").trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error("Usernames are 3–24 letters, numbers, dots, dashes or underscores.");
  }
  return username;
}

function usernameEmail(username) {
  return `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;
}

// The username behind a session, for display.
export function sessionUsername(session) {
  const email = (session && session.user && session.user.email) || "";
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.split("@")[0] : email;
}

export async function signIn(username, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
  if (error) {
    throw new Error(/invalid login credentials/i.test(error.message) ? "Wrong username or password." : error.message);
  }
}

export async function signUp(username, password) {
  const { data, error } = await supabase.auth.signUp({ email: usernameEmail(username), password });
  if (error) {
    throw new Error(/already registered|already exists/i.test(error.message) ? "That username is taken." : error.message);
  }
  // With email confirmation off a session comes back immediately; an empty
  // identities list means the username was already taken.
  if (!data.session || (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
    throw new Error("That username is taken.");
  }
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
