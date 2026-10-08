// Sleeper's public, unauthenticated REST API. Every endpoint used here sends
// `access-control-allow-origin: *`, so the browser talks to Sleeper directly.
// Responses are normalized into small plain objects before the rest of the
// app sees them.

const SLEEPER_V1 = "https://api.sleeper.app/v1";
const SLEEPER_API = "https://api.sleeper.com";
const AVATAR_BASE = "https://sleepercdn.com/avatars/thumbs/";

// The last regular-season week; Sleeper fantasy playoffs live inside it.
const MAX_WEEK = 18;

// Slots in `roster_positions` that are not starting spots.
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);

async function sleeperGet(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sleeper request failed (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function avatarUrl(avatar) {
  if (!avatar) return "";
  return avatar.startsWith("http") ? avatar : `${AVATAR_BASE}${avatar}`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Which NFL season and scoring week it is right now.
export async function getNflState() {
  const data = await sleeperGet(`${SLEEPER_V1}/state/nfl`);
  if (!data || typeof data !== "object") throw new Error("Couldn't read the NFL calendar from Sleeper.");
  const week = Math.max(1, Math.min(MAX_WEEK, parseInt(data.week, 10) || 1));
  return {
    season: String(data.season || new Date().getFullYear()),
    seasonType: data.season_type || "regular",
    week,
  };
}

// A Sleeper user by username or user id, or null if none exists.
export async function resolveUser(usernameOrId) {
  const query = (usernameOrId || "").trim();
  if (!query) return null;
  const data = await sleeperGet(`${SLEEPER_V1}/user/${encodeURIComponent(query)}`);
  if (!data || typeof data !== "object" || !data.user_id) return null;
  return {
    userId: String(data.user_id),
    username: data.username || data.display_name || query,
    displayName: data.display_name || data.username || query,
  };
}

// Every NFL league a user is in for a season. Needs the user *id*; the
// endpoint answers null for usernames.
export async function getUserLeagues(userId, season) {
  const data = await sleeperGet(
    `${SLEEPER_V1}/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((l) => l && l.league_id)
    .map((l) => ({
      leagueId: String(l.league_id),
      name: l.name || "Sleeper league",
      season: String(l.season || season),
    }));
}

// The parts of a league that don't change during a week: its name, starting
// slots, who owns which roster, and member names. Fetched once per session.
export async function getLeagueBundle(leagueId) {
  const id = encodeURIComponent(leagueId);
  const [league, rosters, users] = await Promise.all([
    sleeperGet(`${SLEEPER_V1}/league/${id}`),
    sleeperGet(`${SLEEPER_V1}/league/${id}/rosters`),
    sleeperGet(`${SLEEPER_V1}/league/${id}/users`),
  ]);
  if (!league || !league.league_id) throw new Error("League not found on Sleeper.");

  const members = {};
  for (const u of Array.isArray(users) ? users : []) {
    if (!u || !u.user_id) continue;
    const teamName = u.metadata && u.metadata.team_name ? String(u.metadata.team_name).trim() : "";
    members[String(u.user_id)] = {
      name: (u.display_name && u.display_name.trim()) || teamName || "Unknown",
      teamName,
      avatarUrl: avatarUrl((u.metadata && u.metadata.avatar) || u.avatar),
    };
  }

  return {
    leagueId: String(league.league_id),
    name: league.name || "Sleeper league",
    startingSlots: (Array.isArray(league.roster_positions) ? league.roster_positions : []).filter(
      (slot) => !BENCH_SLOTS.has(slot)
    ),
    rosters: (Array.isArray(rosters) ? rosters : [])
      .filter((r) => r && r.roster_id != null)
      .map((r) => ({
        rosterId: r.roster_id,
        ownerIds: [r.owner_id, ...(Array.isArray(r.co_owners) ? r.co_owners : [])]
          .filter(Boolean)
          .map(String),
      })),
    members,
  };
}

// Live scores for one league-week. `starters` keeps Sleeper's "0" for an
// empty slot so lineup holes can be flagged.
export async function getMatchups(leagueId, week) {
  const data = await sleeperGet(
    `${SLEEPER_V1}/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(week)}`
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => m && m.roster_id != null)
    .map((m) => ({
      rosterId: m.roster_id,
      matchupId: m.matchup_id ?? null,
      points: toNumber(m.custom_points ?? m.points),
      starters: (Array.isArray(m.starters) ? m.starters : []).map((s) => (s == null ? "0" : String(s))),
      startersPoints: (Array.isArray(m.starters_points) ? m.starters_points : []).map(toNumber),
    }));
}

// One week of NFL games: `{ home, away, date, status }`. Status is
// "pre_game", "complete", "canceled", or an in-progress value.
export async function getWeekSchedule(season, seasonType, week) {
  const type = seasonType === "post" ? "post" : "regular";
  const data = await sleeperGet(
    `${SLEEPER_API}/schedule/nfl/${type}/${encodeURIComponent(season)}`
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((g) => g && Number(g.week) === Number(week) && g.home && g.away)
    .map((g) => ({
      home: String(g.home),
      away: String(g.away),
      date: g.date || "",
      status: g.status || "pre_game",
    }));
}

export const PLAYERS_URL = `${SLEEPER_V1}/players/nfl`;
