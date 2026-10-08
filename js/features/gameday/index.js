// Game-day feature: owns the selected week, the cached Sleeper/ESPN data,
// the board's grouping and live filter, and the refresh loop. Polls fast
// while games are on and slowly otherwise, and pauses while the tab is
// hidden.

import { LIVE_POLL_MS, IDLE_POLL_MS } from "../../config.js?v=5";
import { getNflState, getLeagueBundle, getMatchups, getWeekSchedule } from "../../services/sleeper.js?v=5";
import { loadPlayers } from "../../services/players.js?v=5";
import { getWeekSituations } from "../../services/espn.js?v=5";
import { getGroupBy, setGroupBy } from "../../services/prefs.js?v=5";
import { buildGameday, groupBoard, GROUP_BY } from "./model.js?v=5";
import { createGamedayView } from "./view.js?v=5";

const FIRST_WEEK = 1;
const LAST_WEEK = 18;
const STATUS_TICK_MS = 10 * 1000;

function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ago(ms) {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

// `groupByControl`: the settings-sheet fieldset of `name="group-by"` radios.
export function createGameday(root, { groupByControl }) {
  const view = createGamedayView(root, {
    onPrevWeek: () => changeWeek(-1),
    onNextWeek: () => changeWeek(1),
    onRefresh: () => refresh(),
    onToggleLive: () => {
      liveOverride = !liveOnly();
      renderBoard();
    },
  });

  let groupBy = Object.values(GROUP_BY).includes(getGroupBy()) ? getGroupBy() : GROUP_BY.position;
  // null = follow the games (live-only while any game is on); true/false =
  // the user tapped the Live button.
  let liveOverride = null;

  let session = null; // { sleeperUserId, leagues, nfl, week, lookupPlayer, bundles, matchups, errors, games, situations }
  let generation = 0; // bumps on stop/week change so stale responses are dropped
  let pollTimer = null;
  let statusTimer = null;
  let inFlight = null;
  let lastModel = null;
  let lastUpdated = 0;
  let lastFailed = false;

  function liveOnly() {
    if (!lastModel || !lastModel.anyLive) return false;
    return liveOverride == null ? true : liveOverride;
  }

  function renderBoard() {
    if (!lastModel) return;
    const filtered = liveOnly();
    view.render(lastModel, groupBoard(lastModel, { groupBy, liveOnly: filtered }), {
      groupBy,
      liveOnly: filtered,
      liveAvailable: lastModel.anyLive,
    });
  }

  for (const input of groupByControl.querySelectorAll("input[name='group-by']")) {
    input.checked = input.value === groupBy;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      groupBy = input.value;
      setGroupBy(groupBy);
      renderBoard();
    });
  }

  function showStatus() {
    if (!session || !lastUpdated) return;
    if (lastFailed) view.setStatus("error", "Reconnecting…");
    else if (lastModel && lastModel.anyLive) view.setStatus("live", `Live · ${ago(lastUpdated)}`);
    else view.setStatus("idle", `Updated ${ago(lastUpdated)}`);
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!session || document.hidden) return;
    const busy = lastModel && (lastModel.anyLive || lastModel.gamesToday);
    pollTimer = setTimeout(refresh, busy ? LIVE_POLL_MS : IDLE_POLL_MS);
  }

  async function loadLeague(league, week) {
    let bundle = session.bundles.get(league.leagueId);
    if (!bundle) {
      bundle = await getLeagueBundle(league.leagueId);
      session.bundles.set(league.leagueId, bundle);
    }
    return getMatchups(league.leagueId, week);
  }

  async function pull() {
    const gen = generation;
    const { nfl, week, leagues } = session;
    view.setRefreshing(true);

    const [gamesResult, situationsResult, ...leagueResults] = await Promise.allSettled([
      getWeekSchedule(nfl.season, nfl.seasonType, week),
      getWeekSituations(nfl.season, nfl.seasonType, week),
      ...leagues.map((l) => loadLeague(l, week)),
    ]);
    if (gen !== generation || !session) return;

    if (gamesResult.status === "fulfilled") session.games = gamesResult.value;
    if (situationsResult.status === "fulfilled") session.situations = situationsResult.value;
    leagueResults.forEach((result, i) => {
      const id = leagues[i].leagueId;
      if (result.status === "fulfilled") {
        session.matchups.set(id, result.value);
        session.errors.delete(id);
      } else {
        session.errors.set(id, (result.reason && result.reason.message) || "Couldn't load this league.");
      }
    });

    lastFailed = gamesResult.status === "rejected" && leagueResults.every((r) => r.status === "rejected");
    if (!lastFailed) lastUpdated = Date.now();

    lastModel = buildGameday({
      sleeperUserId: session.sleeperUserId,
      leagues: leagues.map((l) => ({
        leagueId: l.leagueId,
        name: l.name,
        bundle: session.bundles.get(l.leagueId) || null,
        matchups: session.matchups.get(l.leagueId) || null,
        error: session.errors.get(l.leagueId) || "",
      })),
      lookupPlayer: session.lookupPlayer,
      games: session.games,
      situations: session.situations,
      today: localDate(),
    });
    renderBoard();
    view.setRefreshing(false);
    showStatus();
  }

  function refresh() {
    if (!session || !session.nfl) return Promise.resolve();
    if (!inFlight) {
      const current = pull()
        .catch(() => {
          lastFailed = true;
          showStatus();
        })
        .finally(() => {
          if (inFlight !== current) return; // superseded by a week change or stop
          inFlight = null;
          view.setRefreshing(false);
          schedulePoll();
        });
      inFlight = current;
    }
    return inFlight;
  }

  function showWeek() {
    view.setWeek(session.week, {
      canPrev: session.week > FIRST_WEEK,
      canNext: session.week < LAST_WEEK,
    });
  }

  function changeWeek(delta) {
    if (!session || !session.nfl) return;
    const week = Math.max(FIRST_WEEK, Math.min(LAST_WEEK, session.week + delta));
    if (week === session.week) return;
    generation += 1;
    inFlight = null;
    session.week = week;
    session.matchups.clear();
    session.errors.clear();
    session.games = [];
    session.situations = new Map();
    lastModel = null;
    showWeek();
    view.showLoading();
    refresh();
  }

  document.addEventListener("visibilitychange", () => {
    if (!session) return;
    if (document.hidden) clearTimeout(pollTimer);
    else refresh();
  });

  return {
    // `leagues`: the enabled leagues, [{ leagueId, name }].
    async start({ sleeperUserId, leagues }) {
      this.stop();
      const gen = generation;
      session = {
        sleeperUserId,
        leagues,
        nfl: null,
        week: FIRST_WEEK,
        lookupPlayer: null,
        bundles: new Map(),
        matchups: new Map(),
        errors: new Map(),
        games: [],
        situations: new Map(),
      };

      if (leagues.length === 0) {
        view.setWeek("", { canPrev: false, canNext: false });
        view.showEmpty();
        return;
      }

      view.showLoading();
      view.setStatus("loading", "Loading…");
      try {
        const [nfl, lookupPlayer] = await Promise.all([getNflState(), loadPlayers()]);
        if (gen !== generation) return;
        session.nfl = nfl;
        session.week = nfl.week;
        session.lookupPlayer = lookupPlayer;
      } catch (err) {
        if (gen !== generation) return;
        view.setStatus("error", "Can't reach Sleeper");
        view.setWeek("", { canPrev: false, canNext: false });
        clearTimeout(pollTimer);
        pollTimer = setTimeout(() => this.start({ sleeperUserId, leagues }), LIVE_POLL_MS);
        return;
      }

      showWeek();
      statusTimer = setInterval(showStatus, STATUS_TICK_MS);
      await refresh();
    },

    stop() {
      generation += 1;
      session = null;
      inFlight = null;
      lastModel = null;
      lastUpdated = 0;
      lastFailed = false;
      clearTimeout(pollTimer);
      clearInterval(statusTimer);
    },

    refresh,
  };
}
