create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  file_name text,
  total_rows integer not null default 0 check (total_rows >= 0),
  inserted_rows integer not null default 0 check (inserted_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  status text not null check (status in ('completed', 'partial', 'failed')),
  error_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'import_runs_entity_type_check'
      and conrelid = 'public.import_runs'::regclass
  ) then
    alter table public.import_runs
      add constraint import_runs_entity_type_check
      check (
        entity_type in (
          'products',
          'suppliers',
          'inventory',
          'purchase_orders',
          'purchase_order_lines',
          'demand_history'
        )
      );
  end if;
end $$;

create index if not exists idx_import_runs_user_created_at
  on public.import_runs(user_id, created_at desc);

alter table public.import_runs enable row level security;

drop policy if exists "import_runs_insert_own" on public.import_runs;
create policy "import_runs_insert_own"
  on public.import_runs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "import_runs_select_own" on public.import_runs;
create policy "import_runs_select_own"
  on public.import_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "import_runs_select_admin" on public.import_runs;
create policy "import_runs_select_admin"
  on public.import_runs
  for select
  to authenticated
  using (public.get_user_role() = 'admin'::public.user_role);
