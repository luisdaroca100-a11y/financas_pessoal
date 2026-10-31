-- ============================================================
-- FinanSmart AI — esquema Supabase (Postgres)
-- Rode este arquivo UMA VEZ no SQL Editor do seu projeto Supabase.
-- Tabelas com RLS: cada usuário só vê e altera os PRÓPRIOS dados.
-- ids são texto (gerados pelo app). user_id referencia auth.users.
-- ============================================================

-- ---------- perfis ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  theme text not null default 'dark',
  alert_limit int not null default 80,
  updated_at timestamptz not null default now()
);

-- ---------- contas ----------
create table if not exists public.accounts (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null default 'Conta corrente',
  initial numeric not null default 0
);
create index if not exists accounts_user_id_idx on public.accounts (user_id);

-- ---------- cartões ----------
create table if not exists public.cards (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  bank text not null default '',
  brand text not null default '',
  limit_value numeric not null default 0,
  closing_day int not null default 1,
  due_day int not null default 10,
  best_day int not null default 1,
  color text not null default '#0a9a68'
);
create index if not exists cards_user_id_idx on public.cards (user_id);

-- ---------- lançamentos ----------
create table if not exists public.entries (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('receita', 'despesa', 'transferencia')),
  description text not null,
  amount numeric not null check (amount > 0),
  category text not null default 'Outros',
  date date not null,
  account_id text,
  card_id text,
  kind text not null default 'avulsa',
  recurring boolean not null default false,
  invoice_month text,
  dest_account_id text
);
create index if not exists entries_user_id_idx on public.entries (user_id);
create index if not exists entries_date_idx on public.entries (date);

-- ---------- compras parceladas ----------
create table if not exists public.purchases (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  total numeric not null check (total > 0),
  card_id text,
  n int not null check (n >= 1 and n <= 48),
  first_month text not null,
  category text not null default 'Compras',
  paid_months text[] not null default '{}'
);
create index if not exists purchases_user_id_idx on public.purchases (user_id);

-- ============================================================
-- RLS: dono vê e altera só o que é dele (auth.uid() = user_id)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.cards enable row level security;
alter table public.entries enable row level security;
alter table public.purchases enable row level security;

-- profiles (id = próprio usuário)
drop policy if exists "profiles_dono" on public.profiles;
create policy "profiles_dono" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- accounts
drop policy if exists "accounts_dono" on public.accounts;
create policy "accounts_dono" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- cards
drop policy if exists "cards_dono" on public.cards;
create policy "cards_dono" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- entries
drop policy if exists "entries_dono" on public.entries;
create policy "entries_dono" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- purchases
drop policy if exists "purchases_dono" on public.purchases;
create policy "purchases_dono" on public.purchases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Fim. Depois de rodar: Authentication > Providers > Email precisa
-- estar ativo (padrão) para o cadastro/login funcionarem.
