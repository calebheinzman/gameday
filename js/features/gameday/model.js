// Pure game-day rules: turn normalized Sleeper data into league scoreboards
// plus the deduplicated "root for" / "root against" player lists. No DOM, no
// network — everything arrives as arguments.

const SLOT_LABELS = {
  SUPER_FLEX: "SF",
  FLEX: "FLX",
  REC_FLEX: "W/T",
  WRRB_FLEX: "W/R",
  IDP_FLEX: "IDP",
};

// Injury statuses that mean the player will not score.
const WONT_PLAY = new Set(["Out", "IR", "Sus", "PUP", "NA", "COV"]);

const GAME_ORDER = { live: 0, upcoming: 1, final: 2, none: 3 };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekday(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

// One player's game this week, shaped for display and sorting.
function gameFor(team, gamesByTeam, today) {
  if (!team) return { state: "none", label: "Free agent", detail: "", date: "" };
  const g = gamesByTeam.get(team);
  if (!g) return { state: "none", label: `${team} on bye`, detail: "Bye", date: "" };

  const label = `${g.away} @ ${g.home}`;
  if (g.status === "canceled") return { state: "none", label, detail: "Canceled", date: g.date };
  if (g.status === "complete") return { state: "final", label, detail: "Final", date: g.date };
  if (g.status === "pre_game") {
    const detail = g.date === today ? "Today" : weekday(g.date);
    return { state: "upcoming", label, detail, date: g.date };
  }
  return { state: "live", label, detail: "Live", date: g.date };
}

function lineupFor(entry, startingSlots, lookupPlayer, gamesByTeam, today) {
  if (!entry) return [];
  return entry.starters.map((id, index) => {
    const rawSlot = startingSlots[index] || "";
    const slot = SLOT_LABELS[rawSlot] || rawSlot;
    if (!id || id === "0") return { slot, player: null, points: 0, game: null };
    const player = lookupPlayer(id);
    return {
      slot,
      player,
      points: entry.startersPoints[index] || 0,
      game: gameFor(player.team, gamesByTeam, today),
    };
  });
}

// Problems with *my* lineup that are still fixable before kickoff.
function lineupWarnings(lineup) {
  const warnings = [];
  for (const spot of lineup) {
    if (!spot.player) {
      warnings.push(`Empty ${spot.slot || "starting"} slot`);
      continue;
    }
    if (spot.game.state === "final" || spot.game.state === "live") continue;
    if (WONT_PLAY.has(spot.player.injury)) {
      warnings.push(`${spot.player.name} is ${spot.player.injury}`);
    } else if (spot.game.detail === "Bye") {
      warnings.push(`${spot.player.name} is on bye`);
    }
  }
  return warnings;
}

function side(member, entry, lineup) {
  return {
    name: member ? member.name : "Unknown",
    teamName: member ? member.teamName : "",
    avatarUrl: member ? member.avatarUrl : "",
    points: entry ? entry.points : 0,
    lineup,
  };
}

function buildMatchup(league, sleeperUserId, lookupPlayer, gamesByTeam, today) {
  const base = { leagueId: league.leagueId, leagueName: league.name, warnings: [], me: null, opp: null };
  if (!league.bundle || !league.matchups) {
    return league.error
      ? { ...base, kind: "error", message: league.error }
      : { ...base, kind: "loading", message: "Loading…" };
  }

  const { bundle, matchups } = league;
  const leagueName = bundle.name || league.name;
  const myRoster = bundle.rosters.find((r) => r.ownerIds.includes(sleeperUserId));
  if (!myRoster) {
    return { ...base, leagueName, kind: "not-member", message: "You don't have a team here." };
  }

  const mine = matchups.find((m) => m.rosterId === myRoster.rosterId);
  const theirs =
    mine && mine.matchupId != null
      ? matchups.find((m) => m.matchupId === mine.matchupId && m.rosterId !== myRoster.rosterId)
      : null;
  const theirRoster = theirs ? bundle.rosters.find((r) => r.rosterId === theirs.rosterId) : null;

  const myLineup = lineupFor(mine, bundle.startingSlots, lookupPlayer, gamesByTeam, today);
  const oppLineup = lineupFor(theirs, bundle.startingSlots, lookupPlayer, gamesByTeam, today);
  const me = side(bundle.members[sleeperUserId], mine, myLineup);
  const opp = theirs
    ? side(theirRoster ? bundle.members[theirRoster.ownerIds[0]] : null, theirs, oppLineup)
    : null;

  return {
    ...base,
    leagueName,
    kind: opp ? "ok" : "no-matchup",
    message: opp ? "" : "No opponent this week.",
    me,
    opp,
    warnings: lineupWarnings(myLineup),
    error: league.error || "",
  };
}

// Short league labels for tags: the first word of each name ("GOAT",
// "Ketchup"), falling back to the full name when two leagues would collide.
function leagueLabels(matchups) {
  const firstWord = (name) => name.split(/\s+/)[0] || name;
  const counts = new Map();
  for (const m of matchups) counts.set(firstWord(m.leagueName), (counts.get(firstWord(m.leagueName)) || 0) + 1);
  const labels = new Map();
  for (const m of matchups) {
    const short = firstWord(m.leagueName);
    labels.set(m.leagueId, counts.get(short) > 1 ? m.leagueName : short);
  }
  return labels;
}

// Collapse one side of every matchup into one row per player.
function aggregate(matchups, pickSide, labels) {
  const rows = new Map();
  for (const m of matchups) {
    const team = pickSide(m);
    if (!team) continue;
    for (const spot of team.lineup) {
      if (!spot.player) continue;
      const key = spot.player.id;
      let row = rows.get(key);
      if (!row) {
        row = { key, player: spot.player, game: spot.game, leagues: [], minPoints: spot.points, maxPoints: spot.points };
        rows.set(key, row);
      }
      row.leagues.push({ name: m.leagueName, label: labels.get(m.leagueId) });
      row.minPoints = Math.min(row.minPoints, spot.points);
      row.maxPoints = Math.max(row.maxPoints, spot.points);
    }
  }
  return rows;
}

function byGame(a, b) {
  const order = GAME_ORDER[a.state] - GAME_ORDER[b.state];
  if (order) return order;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.label.localeCompare(b.label);
}

function byWeight(a, b) {
  if (a.leagues.length !== b.leagues.length) return b.leagues.length - a.leagues.length;
  return a.player.name.localeCompare(b.player.name);
}

function finish(rows, otherRows) {
  return [...rows.values()]
    .map((row) => ({ ...row, otherSide: otherRows.has(row.key) ? otherRows.get(row.key).leagues.length : 0 }))
    .sort((a, b) => byGame(a.game, b.game) || byWeight(a, b));
}

// Pair both sides up by NFL game so each game reads as one row: my
// starters in it on the left, my opponents' starters on the right. Players
// with no game this week (bye, free agent) share one trailing group.
function groupByGame(rootFor, rootAgainst) {
  const groups = new Map();
  const groupFor = (row) => {
    const key = row.game.state === "none" ? "none" : row.game.label;
    if (!groups.has(key)) {
      const game = key === "none" ? { state: "none", label: "Not playing", detail: "", date: "" } : row.game;
      groups.set(key, { key, game, mine: [], theirs: [] });
    }
    return groups.get(key);
  };
  for (const row of rootFor) groupFor(row).mine.push(row);
  for (const row of rootAgainst) groupFor(row).theirs.push(row);
  return [...groups.values()].sort((a, b) => byGame(a.game, b.game));
}

// `leagues`: [{ leagueId, name, bundle, matchups, error }]
// `games`: this week's schedule; `today`: local "YYYY-MM-DD".
export function buildGameday({ sleeperUserId, leagues, lookupPlayer, games, today }) {
  const gamesByTeam = new Map();
  for (const g of games) {
    gamesByTeam.set(g.home, g);
    gamesByTeam.set(g.away, g);
  }

  const matchups = leagues.map((l) => buildMatchup(l, sleeperUserId, lookupPlayer, gamesByTeam, today));
  const labels = leagueLabels(matchups);
  const mine = aggregate(matchups, (m) => m.me, labels);
  const theirs = aggregate(matchups, (m) => m.opp, labels);
  const rootFor = finish(mine, theirs);
  const rootAgainst = finish(theirs, mine);

  return {
    matchups,
    rootFor,
    rootAgainst,
    gameGroups: groupByGame(rootFor, rootAgainst),
    anyLive: games.some((g) => gameFor(g.home, gamesByTeam, today).state === "live"),
    gamesToday: games.some((g) => g.date === today && g.status === "pre_game"),
  };
}
