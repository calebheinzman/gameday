// ESPN's public NFL scoreboard (CORS open, no key). Sleeper has no live game
// situation, so this supplies what Sleeper can't: who has the ball, whether
// they're in the red zone, the game clock, and kickoff times.

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

// ESPN abbreviations that differ from Sleeper's.
const TEAM_ALIASES = { WSH: "WAS" };

const SEASON_TYPES = { pre: 1, regular: 2, post: 3 };

// ESPN's "7:12 - 2nd" / "End of 3rd" / "Halftime" → "Q2 7:12" / "End Q3" /
// "Half", so the clock fits in a narrow cell.
function compactClock(detail) {
  const text = String(detail || "").trim();
  const quarter = (q) => (/^\d/.test(q) ? `Q${parseInt(q, 10)}` : q.toUpperCase());
  let match = text.match(/^(\d{1,2}:\d{2})\s*-\s*(\d(?:st|nd|rd|th)|OT)$/i);
  if (match) return `${quarter(match[2])} ${match[1]}`;
  match = text.match(/^End of (\d(?:st|nd|rd|th)|OT)/i);
  if (match) return `End ${quarter(match[1])}`;
  if (/^halftime$/i.test(text)) return "Half";
  return text;
}

function sleeperTeam(abbr) {
  const team = String(abbr || "").toUpperCase();
  return TEAM_ALIASES[team] || team;
}

// Map of Sleeper team abbreviation → { state, clock, kickoff, possession,
// redZone }. `state` is ESPN's "pre" | "in" | "post"; `possession` is the
// team with the ball (Sleeper abbreviation) or "" when unknown.
export async function getWeekSituations(season, seasonType, week) {
  const params = new URLSearchParams({
    dates: String(season),
    seasontype: String(SEASON_TYPES[seasonType] || SEASON_TYPES.regular),
    week: String(week),
  });
  const res = await fetch(`${SCOREBOARD_URL}?${params}`);
  if (!res.ok) throw new Error(`ESPN scoreboard failed (HTTP ${res.status})`);
  const data = await res.json();

  const byTeam = new Map();
  for (const event of Array.isArray(data && data.events) ? data.events : []) {
    const competition = event && Array.isArray(event.competitions) ? event.competitions[0] : null;
    if (!competition || !Array.isArray(competition.competitors)) continue;

    const teamsById = new Map(
      competition.competitors
        .filter((c) => c && c.team)
        .map((c) => [String(c.team.id), sleeperTeam(c.team.abbreviation)])
    );
    const status = (competition.status && competition.status.type) || {};
    const situation = competition.situation || {};
    const info = {
      state: status.state || "pre",
      clock: compactClock(status.shortDetail),
      kickoff: event.date || competition.date || "",
      possession: teamsById.get(String(situation.possession || "")) || "",
      redZone: Boolean(situation.isRedZone),
    };
    for (const team of teamsById.values()) byTeam.set(team, info);
  }
  return byTeam;
}
