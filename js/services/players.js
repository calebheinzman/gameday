// The NFL player directory: names, positions, teams and injury status keyed
// by Sleeper player id. Sleeper's full dump is ~14 MB and they ask callers to
// pull it at most once a day, so a slimmed copy is cached in localStorage and
// refreshed on the first visit of each day.

import { PLAYERS_URL } from "./sleeper.js?v=5";

const STORAGE_KEY = "gameday.players.v1";

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || typeof cached.players !== "object" || !cached.fetchedOn) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(players) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fetchedOn: todayStamp(), players }));
  } catch {
    // Storage full or disabled: the directory still works for this visit.
  }
}

// Sleeper's per-player object → [name, position, team, injuryStatus].
function slim(raw) {
  const players = {};
  for (const [id, p] of Object.entries(raw || {})) {
    if (!p || typeof p !== "object") continue;
    const name =
      p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || id;
    players[id] = [name, p.position || "", p.team || "", p.injury_status || ""];
  }
  return players;
}

async function fetchDirectory() {
  const res = await fetch(PLAYERS_URL);
  if (!res.ok) throw new Error(`Sleeper player list failed (HTTP ${res.status})`);
  return slim(await res.json());
}

// Resolves to a lookup function: id → { id, name, position, team, injury }.
// Falls back to a stale cache (or bare ids) rather than failing the page.
export async function loadPlayers() {
  const cached = readCache();
  let players = cached && cached.fetchedOn === todayStamp() ? cached.players : null;

  if (!players) {
    try {
      players = await fetchDirectory();
      writeCache(players);
    } catch {
      players = cached ? cached.players : {};
    }
  }

  return (id) => {
    const p = players[id];
    if (!p) return { id, name: id, position: "", team: "", injury: "" };
    return { id, name: p[0], position: p[1], team: p[2], injury: p[3] };
  };
}
