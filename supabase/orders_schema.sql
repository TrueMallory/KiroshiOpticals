create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_nsu text not null unique,
  transaction_nsu text,
  mode text not null,
  items jsonb not null,
  total numeric not null,
  status text not null default 'paid',
  receipt_url text,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "Users can view own orders"
  on public.orders for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own orders"
  on public.orders for insert to authenticated
  with check (auth.uid() = user_id);
