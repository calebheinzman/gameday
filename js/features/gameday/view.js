// Game-day rendering. Rows are keyed (league id / player id) so a poll only
// touches rows whose content changed, open lineups stay open, and changed
// point totals get a brief highlight.

import { h } from "../../utils/dom.js?v=3";

const HEADSHOT_URL = (id) => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
const TEAM_LOGO_URL = (team) => `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
const FLASH_MS = 1600;

// Last rendered item and its signature, per row element.
const rendered = new WeakMap();

function formatPoints(value, digits = 1) {
  return (Number(value) || 0).toFixed(digits);
}

function pointsLabel(row) {
  if (row.game.state === "upcoming" && row.maxPoints === 0) return "–";
  if (row.minPoints === row.maxPoints) return formatPoints(row.maxPoints);
  return `${formatPoints(row.minPoints)}–${formatPoints(row.maxPoints)}`;
}

function playerPhoto(player) {
  const isDefense = player.position === "DEF";
  const img = h("img", {
    src: isDefense ? TEAM_LOGO_URL(player.id) : HEADSHOT_URL(player.id),
    alt: "",
    loading: "lazy",
    decoding: "async",
  });
  img.addEventListener("error", () => img.remove(), { once: true });
  return h(
    "span",
    { class: `photo pos-${(player.position || "na").toLowerCase()}`, "aria-hidden": "true" },
    h("span", { class: "photo-fallback" }, player.position || "?"),
    img
  );
}

function injuryTag(player) {
  if (!player.injury) return null;
  const short = player.injury === "Questionable" ? "Q" : player.injury === "Doubtful" ? "D" : player.injury;
  return h("span", { class: "tag tag--injury", title: player.injury }, short);
}

// --- keyed list reconciliation ---

// Re-renders only rows whose signature changed, then puts rows in order.
// `onChange(el, prevItem, item)` runs after a changed row is rebuilt.
function reconcile(container, items, { key, signature, render, update, onChange }) {
  const existing = new Map();
  for (const el of container.children) {
    if (el.dataset.key) existing.set(el.dataset.key, el);
  }

  const ordered = items.map((item) => {
    const k = key(item);
    const sig = signature(item);
    let el = existing.get(k);
    const prev = el && rendered.get(el);
    if (!el) {
      el = render(item);
      el.dataset.key = k;
    } else if (prev.sig !== sig) {
      update(el, item);
      if (onChange) onChange(el, prev.item, item);
    }
    rendered.set(el, { item, sig });
    existing.delete(k);
    return el;
  });

  for (const el of existing.values()) el.remove();
  ordered.forEach((el, index) => {
    if (container.children[index] !== el) container.insertBefore(el, container.children[index] || null);
  });
}

function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), FLASH_MS);
}

// --- game board: my starters (left) vs opponents' starters (right) ---

// "Jalon Daniels" → "J. Daniels"; defenses → "JAX D/ST". Keeps columns narrow.
function shortName(player) {
  if (player.position === "DEF") return `${player.team || player.id} D/ST`;
  const parts = player.name.split(" ");
  if (parts.length < 2 || !parts[0]) return player.name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function cellContent(row) {
  const { player } = row;
  return [
    playerPhoto(player),
    h(
      "div",
      { class: "cell-main" },
      h(
        "div",
        { class: "cell-name", title: player.name },
        h("span", { class: "cell-name-text" }, shortName(player)),
        injuryTag(player)
      ),
      h(
        "div",
        { class: "cell-tags" },
        player.position ? h("span", { class: "cell-pos" }, player.position) : null,
        row.leagues.map((l) => h("span", { class: "league-tag", title: l.name }, l.label)),
        row.otherSide ? h("span", { class: "tag tag--split", title: "You have this player on both sides" }, "both") : null
      )
    ),
    h("span", { class: "cell-pts" }, pointsLabel(row)),
  ];
}

function renderCells(list, rows) {
  reconcile(list, rows, {
    key: (row) => row.key,
    signature: (row) =>
      JSON.stringify([row.player.name, row.player.injury, row.leagues, row.minPoints, row.maxPoints, row.otherSide, row.game.state]),
    render: (row) => h("li", { class: "cell" }, cellContent(row)),
    update: (el, row) => el.replaceChildren(...cellContent(row)),
    onChange: (el, prev, row) => {
      if (prev && (prev.maxPoints !== row.maxPoints || prev.minPoints !== row.minPoints)) flash(el);
    },
  });
}

function gameHeaderContent(game) {
  return [
    h("span", { class: "game-label" }, game.label),
    game.detail ? h("span", { class: `game-state game-state--${game.state}` }, game.detail) : null,
  ];
}

function fillGame(el, group) {
  el.className = `game game--${group.game.state}`;
  el.querySelector(".game-header").replaceChildren(...gameHeaderContent(group.game));
  renderCells(el.querySelector(".cells--mine"), group.mine);
  renderCells(el.querySelector(".cells--theirs"), group.theirs);
}

function renderBoard(board, groups) {
  reconcile(board, groups, {
    key: (group) => group.key,
    signature: (group) => JSON.stringify(group),
    render: (group) => {
      const el = h(
        "section",
        { class: "game" },
        h("header", { class: "game-header" }),
        h(
          "div",
          { class: "game-cols" },
          h("ul", { class: "cells cells--mine", "aria-label": "Your starters" }),
          h("ul", { class: "cells cells--theirs", "aria-label": "Opponents' starters" })
        )
      );
      fillGame(el, group);
      return el;
    },
    update: fillGame,
  });
}

// --- scoreboard ---

function lineupRow(mine, theirs) {
  const name = (spot) => (spot && spot.player ? spot.player.name : spot ? "Empty" : "");
  const pts = (spot) => (spot && spot.player ? formatPoints(spot.points) : "");
  const state = (spot) => (spot && spot.game ? `is-${spot.game.state}` : "");
  return h(
    "li",
    { class: "lineup-row" },
    h("span", { class: `lineup-name lineup-name--mine ${state(mine)}` }, name(mine)),
    h("span", { class: "lineup-pts" }, pts(mine)),
    h("span", { class: "lineup-slot" }, (mine || theirs || {}).slot || ""),
    h("span", { class: "lineup-pts" }, pts(theirs)),
    h("span", { class: `lineup-name lineup-name--theirs ${state(theirs)}` }, name(theirs))
  );
}

function matchupContent(m) {
  if (m.kind !== "ok" && m.kind !== "no-matchup") {
    return [
      h(
        "summary",
        { class: "matchup-summary" },
        h("span", { class: "matchup-league" }, m.leagueName),
        h("span", { class: `matchup-message ${m.kind === "error" ? "is-error" : ""}` }, m.message)
      ),
    ];
  }

  const diff = m.opp ? m.me.points - m.opp.points : 0;
  const outcome = !m.opp ? "" : diff > 0 ? "is-winning" : diff < 0 ? "is-losing" : "is-tied";
  const rows = Math.max(m.me.lineup.length, m.opp ? m.opp.lineup.length : 0);
  const lineup = [];
  for (let i = 0; i < rows; i += 1) lineup.push(lineupRow(m.me.lineup[i], m.opp && m.opp.lineup[i]));

  return [
    h(
      "summary",
      { class: `matchup-summary ${outcome}` },
      h(
        "span",
        { class: "matchup-league" },
        m.leagueName,
        m.error ? h("span", { class: "tag tag--stale", title: m.error }, "stale") : null
      ),
      h(
        "span",
        { class: "matchup-score" },
        h("span", { class: "score score--mine" }, formatPoints(m.me.points, 2)),
        h("span", { class: "score-sep" }, "–"),
        h("span", { class: "score score--theirs" }, m.opp ? formatPoints(m.opp.points, 2) : "—")
      ),
      h("span", { class: "matchup-opp" }, m.opp ? `vs ${m.opp.name}` : m.message),
      m.warnings.length
        ? h("ul", { class: "warnings" }, m.warnings.map((w) => h("li", {}, w)))
        : null
    ),
    h("ul", { class: "lineup" }, lineup),
  ];
}

function renderScoreboard(container, matchups) {
  reconcile(container, matchups, {
    key: (m) => m.leagueId,
    signature: (m) => JSON.stringify(m),
    render: (m) => h("details", { class: "matchup" }, matchupContent(m)),
    update: (el, m) => el.replaceChildren(...matchupContent(m)),
    onChange: (el, prev, m) => {
      const before = prev && prev.me && prev.opp ? [prev.me.points, prev.opp.points] : null;
      const after = m.me && m.opp ? [m.me.points, m.opp.points] : null;
      if (before && after && (before[0] !== after[0] || before[1] !== after[1])) {
        flash(el.querySelector(".matchup-summary"));
      }
    },
  });
}

// --- public ---

export function createGamedayView(root, { onPrevWeek, onNextWeek, onRefresh }) {
  const els = {
    weekLabel: root.querySelector("[data-week-label]"),
    prev: root.querySelector("[data-week-prev]"),
    next: root.querySelector("[data-week-next]"),
    refresh: root.querySelector("[data-refresh]"),
    status: root.querySelector("[data-status]"),
    statusText: root.querySelector("[data-status-text]"),
    scoreboard: root.querySelector("[data-scoreboard]"),
    board: root.querySelector("[data-board]"),
    forCount: root.querySelector("[data-for-count]"),
    againstCount: root.querySelector("[data-against-count]"),
    empty: root.querySelector("[data-empty]"),
    content: root.querySelector("[data-content]"),
  };

  els.prev.addEventListener("click", onPrevWeek);
  els.next.addEventListener("click", onNextWeek);
  els.refresh.addEventListener("click", onRefresh);

  function clear() {
    els.scoreboard.replaceChildren();
    els.board.replaceChildren();
    els.forCount.textContent = "";
    els.againstCount.textContent = "";
  }

  return {
    setWeek(week, { canPrev, canNext }) {
      els.weekLabel.textContent = week ? `Week ${week}` : "Game Day";
      els.prev.disabled = !canPrev;
      els.next.disabled = !canNext;
    },

    showLoading() {
      clear();
      els.empty.hidden = true;
      els.content.hidden = false;
      els.content.classList.add("is-loading");
    },

    showEmpty() {
      clear();
      els.content.hidden = true;
      els.empty.hidden = false;
    },

    render(model) {
      els.empty.hidden = true;
      els.content.hidden = false;
      els.content.classList.remove("is-loading");
      renderScoreboard(els.scoreboard, model.matchups);
      renderBoard(els.board, model.gameGroups);
      els.forCount.textContent = model.rootFor.length ? String(model.rootFor.length) : "";
      els.againstCount.textContent = model.rootAgainst.length ? String(model.rootAgainst.length) : "";
    },

    // kind: "live" | "idle" | "error" | "loading"
    setStatus(kind, text) {
      els.status.dataset.state = kind;
      els.statusText.textContent = text;
    },

    setRefreshing(busy) {
      els.refresh.classList.toggle("is-spinning", busy);
    },
  };
}
