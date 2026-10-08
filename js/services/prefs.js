// Per-device display preferences, kept in localStorage.

const GROUP_BY_KEY = "gameday.groupBy";

export function getGroupBy(fallback) {
  try {
    return localStorage.getItem(GROUP_BY_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function setGroupBy(value) {
  try {
    localStorage.setItem(GROUP_BY_KEY, value);
  } catch {
    // Storage disabled: the choice lasts for this visit only.
  }
}
