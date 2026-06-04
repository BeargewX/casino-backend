-- Run this in your Supabase SQL editor

create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  balance integer not null default 10000,
  is_admin boolean default false,
  created_at timestamptz default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  type text not null,
  amount integer not null,
  description text,
  balance_after integer,
  created_at timestamptz default now()
);

create table bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  match_id text not null,
  market text not null,
  selection text not null,
  odds numeric not null,
  amount integer not null,
  potential_win integer,
  status text default 'pending',
  created_at timestamptz default now()
);

-- Disable row-level security for simplicity (use service role key in backend)
alter table users disable row level security;
alter table transactions disable row level security;
alter table bets disable row level security;
