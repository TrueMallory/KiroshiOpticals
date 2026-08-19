create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  cpf text,
  whatsapp text,
  cep text,
  street text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- Cria automaticamente uma linha em profiles quando um novo usuário se cadastra,
-- puxando nome e CPF do metadata enviado no signUp (options.data).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, cpf)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'cpf')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
