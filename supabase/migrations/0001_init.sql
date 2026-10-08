-- Game Day schema: one profile (linked Sleeper account) per user and one
-- row per league per user. Row-level security limits every row to its owner.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sleeper_username text,
  sleeper_user_id text,
  updated_at timestamptz not null default now()
);

create table public.leagues (
  user_id uuid not null references auth.users (id) on delete cascade,
  league_id text not null,
  season text not null,
  name text not null default '',
  enabled boolean not null default true,
  sort integer not null default 0,
  primary key (user_id, league_id)
);

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;

create policy "Own profile: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own profile: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own profile: update" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own profile: delete" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own leagues: select" on public.leagues for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own leagues: insert" on public.leagues for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own leagues: update" on public.leagues for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own leagues: delete" on public.leagues for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.leagues to authenticated;
revoke all on public.profiles from anon;
revoke all on public.leagues from anon;
