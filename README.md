# Game Day 🏈

Every Sleeper league on one phone screen: who you're starting, who you're up against, and the live scores.

- **Matchups**: one compact row per league with the live score, a winning/losing tint, and lineup warnings (empty slot, starter Out/IR/on bye). Tap a row to see both full lineups.
- **Root for / Root against board**: your starters on the left, your opponents' starters on the right. Grouped by **position** by default; switch to **game** or **league** in settings (remembered per device). Each player shows league tags (`GOAT`, `Ketchup`, …) and appears once even if you start them in several leagues. Players you have on both sides are tagged `both`.
- **Live button**: shows only players in games that are on right now. It's on automatically while games are live and off otherwise; tap to switch.
- **On the field**: 🏈 on a player's photo means their unit is on the field (offense has the ball, or the other team does for a defense); **RZ** means that drive is in the red zone. Game clock and kickoff times come from ESPN's public scoreboard.
- Live games sort to the top. Scores refresh every 30s while games are on, every 5 minutes otherwise, and pause while the tab is in the background. Changed scores briefly highlight.

Live site: https://calebheinzman.github.io/gameday/

## How it works

A static site (HTML/CSS/ES modules, no build step). The browser talks directly to:

- **Sleeper's public API** (no key; CORS open): `state/nfl`, `user/…/leagues`, `league/…`, `…/rosters`, `…/users`, `…/matchups/{week}`, `schedule/nfl/…`, and the player directory (cached in localStorage once a day).
- **ESPN's public scoreboard** (no key; CORS open) for game clock, kickoff times, possession, and red zone.
- **Supabase**: username/password auth, plus the `profiles` and `leagues` tables (row-level security; see `supabase/migrations/`).

## Run locally

```sh
npm run dev   # http://localhost:3000
```

## Supabase

Project `gameday` (ref `ymleajgxpytkxfeswxfp`) in the free **Game Day** organization. Schema: `supabase/migrations/0001_init.sql`.

**Sign-in is username + password.** Supabase password auth is keyed by email, so each username is stored as `<username>@users.gameday.invalid` (a reserved, undeliverable domain). **Confirm email** is turned off for the project, so sign-up is instant and Supabase never sends mail, which avoids the free tier's email limit. There's no self-serve password reset; reset a password from the Supabase dashboard (Authentication → Users) or the admin API.

Auth URL configuration (Site URL `https://calebheinzman.github.io/gameday/`, redirects for that URL and `http://localhost:3000/**`) is set but only matters if email links are ever turned back on.
