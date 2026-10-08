# Project Instructions

## Project overview

Game Day is a static, mobile-first site that shows, across every Sleeper league a user is in, who they are starting ("root for") and who their opponents are starting ("root against"), with live scores. Plain HTML, CSS, and ES modules; no build step. Hosted on GitHub Pages. Supabase stores accounts (email magic link), the linked Sleeper account, and which leagues are switched on.

## Key files

- `index.html`: Page structure for every view (loading, sign-in, Sleeper setup, game day, settings sheet).
- `styles.css`: All visual rules. Mobile first; light/dark follow the system.
- `js/app.js`: Startup and coordination between the account and game-day features. Decides which view is shown.
- `js/config.js`: Supabase URL, publishable key, poll intervals.
- `js/services/sleeper.js`: Sleeper REST requests and response normalization.
- `js/services/players.js`: Daily localStorage cache of the slimmed Sleeper player directory.
- `js/services/supabase.js`: Supabase client, auth, and profile/league persistence.
- `js/features/account/`: Sign-in, linking a Sleeper username, settings sheet.
- `js/features/gameday/index.js`: Week selection, data cache, and the refresh loop.
- `js/features/gameday/model.js`: Pure rules that turn Sleeper data into scoreboards and the root-for/against board (grouped by NFL game).
- `js/features/gameday/view.js`: Keyed rendering of the scoreboard and the two-column game board (mine left, opponents right).
- `js/utils/dom.js`: `h()` element builder (text nodes only, no innerHTML).
- `supabase/migrations/`: SQL applied to the Supabase project.

## Local development

```sh
npm run dev
```

Starts Live Server on port 3000. Magic links redirect to the page they were requested from, so `http://localhost:3000` must be in the Supabase Auth redirect allow list.

## Conventions

- Keep Sleeper calls and normalization in `services/sleeper.js`. Nothing else should read raw Sleeper payloads.
- Keep `model.js` pure: no DOM, network, storage, or clock reads. Pass `today` and data in.
- Build DOM with `h()` so Sleeper-provided names are always text, never markup.
- Re-render through keyed `reconcile()` in `view.js` so polls only touch changed rows and open lineups stay open.
- Schema changes go in a new numbered file in `supabase/migrations/`, and every table has RLS limiting rows to `auth.uid()`.
- Only the publishable Supabase key may appear in client code.
- Keep the `?v=` cache-busting values on `styles.css` and `js/app.js` in `index.html` in sync, and bump them when a deploy needs to bypass browser cache.
- Remove dead code and temporary logging before finishing a change.

## Useful checks

- Load `http://localhost:3000` and check the console for errors.
- Check the page at phone width (~390px) and desktop width.
- Exercise loading, empty (no leagues enabled), error (Sleeper unreachable), and live paths after changing data or refresh behavior.
