// Pure game-day rules: turn normalized Sleeper data (plus ESPN's live game
// situations) into league scoreboards, the deduplicated "root for" / "root
// against" player lists, and their grouping for the board. No DOM, no
// network, no clock reads — everything arrives as arguments.

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

// Board order when grouping by position. Anything else sorts after these.
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

// Positions that are on the field when their team does *not* have the ball.
const DEFENSIVE_POSITIONS = new Set(["DEF", "DL", "LB", "DB", "IDP"]);

export const GROUP_BY = { position: "position", game: "game", league: "league" };

function weekday(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

// "Thu 6:15p" / "Sun 11a" in the viewer's time zone, or "" if unknown.
function kickoffLabel(iso) {
  const when = new Date(iso);
  if (!iso || Number.isNaN(when.getTime())) return "";
  const hours = when.getHours();
  const minutes = when.getMinutes();
  const time = `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hours < 12 ? "a" : "p"}`;
  return `${WEEKDAYS[when.getDay()]} ${time}`;
}

// One player's game this week, shaped for display and sorting. Sleeper's
// schedule says which games exist; ESPN's situation (when available) adds
// the clock, kickoff time, and who has the ball.
function gameFor(team, gamesByTeam, situations, today) {
  if (!team) return { state: "none", label: "Free agent", detail: "", date: "" };
  const g = gamesByTeam.get(team);
  if (!g) return { state: "none", label: `${team} on bye`, detail: "Bye", date: "" };

  const label = `${g.away} @ ${g.home}`;
  const sit = situations.get(team);
  if (g.status === "canceled") return { state: "none", label, detail: "Canceled", date: g.date };

  const finished = g.status === "complete" || (sit && sit.state === "post");
  if (finished) return { state: "final", label, detail: "Final", date: g.date };

  const live = (g.status !== "pre_game" && g.status !== "complete") || (sit && sit.state === "in");
  if (live) {
    return {
      state: "live",
      label,
      detail: (sit && sit.clock) || "Live",
      date: g.date,
      possession: (sit && sit.possession) || "",
      redZone: Boolean(sit && sit.redZone),
    };
  }

  const kickoff = sit ? kickoffLabel(sit.kickoff) : "";
  const detail = kickoff || (g.date === today ? "Today" : weekday(g.date));
  return { state: "upcoming", label, detail, date: (sit && sit.kickoff) || g.date };
}

// "redzone" | "field" | "" — is this player on the field right now? Offense
// is on when their team has the ball; defenses when the other team does.
function fieldStatus(player, game) {
  if (!game || game.state !== "live" || !game.possession || !player.team) return "";
  const defensive = DEFENSIVE_POSITIONS.has(player.position);
  const onField = defensive ? game.possession !== player.team : game.possession === player.team;
  if (!onField) return "";
  return game.redZone ? "redzone" : "field";
}

function lineupFor(entry, startingSlots, lookupPlayer, gamesByTeam, situations, today) {
  if (!entry) return [];
  return entry.starters.map((id, index) => {
    const rawSlot = startingSlots[index] || "";
    const slot = SLOT_LABELS[rawSlot] || rawSlot;
    if (!id || id === "0") return { slot, player: null, points: 0, game: null, field: "" };
    const player = lookupPlayer(id);
    const game = gameFor(player.team, gamesByTeam, situations, today);
    return { slot, player, points: entry.startersPoints[index] || 0, game, field: fieldStatus(player, game) };
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

function buildMatchup(league, sleeperUserId, lookupPlayer, gamesByTeam, situations, today) {
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

  const myLineup = lineupFor(mine, bundle.startingSlots, lookupPlayer, gamesByTeam, situations, today);
  const oppLineup = lineupFor(theirs, bundle.startingSlots, lookupPlayer, gamesByTeam, situations, today);
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
        row = {
          key,
          player: spot.player,
          game: spot.game,
          field: spot.field,
          leagues: [],
          minPoints: spot.points,
          maxPoints: spot.points,
        };
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

// --- board grouping ---

function makeGroups(rows, keyOf, describe) {
  const groups = new Map();
  for (const [sideName, list] of [["mine", rows.mine], ["theirs", rows.theirs]]) {
    for (const row of list) {
      const key = keyOf(row);
      if (!groups.has(key)) groups.set(key, { key, ...describe(row, key), mine: [], theirs: [] });
      groups.get(key)[sideName].push(row);
    }
  }
  return [...groups.values()];
}

// Each NFL game is one group: my starters in it vs my opponents'. Players
// with no game this week (bye, free agent) share one trailing group.
function groupByGame(rows) {
  return makeGroups(
    rows,
    (row) => (row.game.state === "none" ? "none" : row.game.label),
    (row, key) =>
      key === "none"
        ? { title: "Not playing", detail: "", state: "none", game: { state: "none", label: "", date: "" } }
        : { title: row.game.label, detail: row.game.detail, state: row.game.state, game: row.game }
  ).sort((a, b) => byGame(a.game, b.game));
}

function groupByPosition(rows) {
  const rank = (pos) => {
    const i = POSITION_ORDER.indexOf(pos);
    return i === -1 ? POSITION_ORDER.length : i;
  };
  return makeGroups(
    rows,
    (row) => row.player.position || "Other",
    (row, key) => ({ title: key, detail: "", state: "" })
  ).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

// Each league is one group: my lineup vs that week's opponent, in slot
// order, without cross-league deduplication.
function groupByLeague(matchups, keep) {
  const lineupRows = (team, leagueId) =>
    team
      ? team.lineup
          .filter((spot) => spot.player && keep(spot))
          .map((spot) => ({
            key: `${leagueId}:${spot.player.id}`,
            player: spot.player,
            game: spot.game,
            field: spot.field,
            leagues: [],
            minPoints: spot.points,
            maxPoints: spot.points,
            otherSide: 0,
          }))
      : [];
  return matchups
    .filter((m) => m.me)
    .map((m) => ({
      key: m.leagueId,
      title: m.leagueName,
      detail: m.opp ? `${m.me.points.toFixed(2)} – ${m.opp.points.toFixed(2)}` : "",
      state: "",
      mine: lineupRows(m.me, m.leagueId),
      theirs: lineupRows(m.opp, m.leagueId),
    }))
    .filter((g) => g.mine.length || g.theirs.length);
}

// Board groups for the chosen grouping, optionally limited to players whose
// game is live right now. Returns { groups, mineCount, theirsCount }.
export function groupBoard(model, { groupBy = GROUP_BY.position, liveOnly = false } = {}) {
  const keep = (row) => !liveOnly || row.game.state === "live";
  let groups;
  if (groupBy === GROUP_BY.league) {
    groups = groupByLeague(model.matchups, keep);
  } else {
    const rows = { mine: model.rootFor.filter(keep), theirs: model.rootAgainst.filter(keep) };
    groups = groupBy === GROUP_BY.game ? groupByGame(rows) : groupByPosition(rows);
  }
  const count = (side) => new Set(groups.flatMap((g) => g[side].map((row) => row.player.id))).size;
  return { groups, mineCount: count("mine"), theirsCount: count("theirs") };
}

// `leagues`: [{ leagueId, name, bundle, matchups, error }]
// `games`: this week's Sleeper schedule; `situations`: ESPN info by team
// (may be empty); `today`: local "YYYY-MM-DD".
export function buildGameday({ sleeperUserId, leagues, lookupPlayer, games, situations = new Map(), today }) {
  const gamesByTeam = new Map();
  for (const g of games) {
    gamesByTeam.set(g.home, g);
    gamesByTeam.set(g.away, g);
  }

  const matchups = leagues.map((l) =>
    buildMatchup(l, sleeperUserId, lookupPlayer, gamesByTeam, situations, today)
  );
  const labels = leagueLabels(matchups);
  const mine = aggregate(matchups, (m) => m.me, labels);
  const theirs = aggregate(matchups, (m) => m.opp, labels);

  return {
    matchups,
    rootFor: finish(mine, theirs),
    rootAgainst: finish(theirs, mine),
    anyLive: games.some((g) => gameFor(g.home, gamesByTeam, situations, today).state === "live"),
    gamesToday: games.some((g) => g.date === today && g.status === "pre_game"),
  };
}
