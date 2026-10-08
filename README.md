# Game Day 🏈

Every Sleeper league on one phone screen: who you're starting, who you're up against, and the live scores.

- **Matchups**: one compact row per league with the live score, a winning/losing tint, and lineup warnings (empty slot, starter Out/IR/on bye). Tap a row to see both full lineups.
- **Root for / Root against board**: your starters on the left, your opponents' starters on the right, grouped by NFL game, so each game you're watching reads as one row. Each player shows league tags (`GOAT`, `Ketchup`, …) and appears once even if you start them in several leagues. Players you have on both sides are tagged `both`.
- Live games sort to the top. Scores refresh every 30s while games are on, every 5 minutes otherwise, and pause while the tab is in the background. Changed scores briefly highlight.

Live site: https://calebheinzman.github.io/gameday/

## How it works

A static site (HTML/CSS/ES modules, no build step). The browser talks directly to:

- **Sleeper's public API** (no key; CORS open): `state/nfl`, `user/…/leagues`, `league/…`, `…/rosters`, `…/users`, `…/matchups/{week}`, `schedule/nfl/…`, and the player directory (cached in localStorage once a day).
- **Supabase**: email magic-link auth, plus the `profiles` and `leagues` tables (row-level security; see `supabase/migrations/`).

## Run locally

```sh
npm run dev   # http://localhost:3000
```

## Supabase setup (one time)

Project: `gameday` (`whzscbcoduaxbjcftuce`). Schema is in `supabase/migrations/0001_init.sql`.

In the Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://calebheinzman.github.io/gameday/`
- **Redirect URLs**: add `https://calebheinzman.github.io/gameday/**` and `http://localhost:3000/**`

Supabase's built-in email sender only sends a few emails per hour. That's fine for personal use; add custom SMTP under Authentication → Emails if you share the site widely.

To make the sign-in email also carry a typeable code (needed when the link would open in a different browser, e.g. a home-screen app on iPhone), edit **Authentication → Emails → Magic Link** and add `{{ .Token }}` to the template, e.g. `<p>Or enter this code: <strong>{{ .Token }}</strong></p>`.

Tip: on iPhone, open the site in Safari and use **Share → Add to Home Screen** for a full-screen app.
