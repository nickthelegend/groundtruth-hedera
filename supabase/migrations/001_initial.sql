-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── TABLES ───────────────────────────────────────────────────────────────────

create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  intent          text not null,
  proof_spec      jsonb not null,
  budget_usdt     text not null,
  status          text not null default 'pending'
                  check (status in ('pending','claimed','submitted','needs_review','verified','failed','expired')),
  worker_wallet   text,
  payment_ref     text,
  proof_payload   jsonb,
  result          jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  claimed_at      timestamptz,
  submitted_at    timestamptz,
  resolved_at     timestamptz
);

create table payments (
  payment_ref     text primary key,
  task_id         uuid not null references tasks(id),
  amount_units    bigint not null,
  fee_units       bigint not null,
  payer_address   text not null,
  tx_hash         text,
  settled_at      timestamptz,
  created_at      timestamptz not null default now()
);

create table workers (
  wallet          text primary key,
  tasks_completed integer not null default 0,
  tasks_failed    integer not null default 0,
  total_earned_units bigint not null default 0,
  last_seen       timestamptz not null default now()
);

create table proof_hashes (
  id              uuid primary key default uuid_generate_v4(),
  task_id         uuid not null references tasks(id),
  phash           text not null,
  created_at      timestamptz not null default now()
);

create index on tasks (status, expires_at);
create index on tasks (worker_wallet);
create index on proof_hashes (phash);

-- ─── REALTIME ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table tasks;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

alter table tasks       enable row level security;
alter table payments    enable row level security;
alter table workers     enable row level security;
alter table proof_hashes enable row level security;

-- tasks: anon can read pending tasks; service role has full access (implicit)
create policy "anon read tasks" on tasks
  for select to anon using (true);

-- workers: anon can read worker profiles
create policy "anon read workers" on workers
  for select to anon using (true);

-- payments and proof_hashes: no anon access (service role only)
-- (no policies = no access for anon/authenticated roles)

-- ─── ATOMIC CLAIM FUNCTION ────────────────────────────────────────────────────

create or replace function claim_task(
  p_task_id     uuid,
  p_worker      text,
  p_expires_at  timestamptz
)
returns tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks;
begin
  update tasks
  set
    status      = 'claimed',
    worker_wallet = p_worker,
    claimed_at  = now(),
    expires_at  = least(expires_at, p_expires_at)
  where id = p_task_id
    and status = 'pending'
    and expires_at > now()
  returning * into v_task;

  return v_task;
end;
$$;

-- ─── INCREMENT WORKER FUNCTION ────────────────────────────────────────────────

create or replace function increment_worker(
  p_wallet  text,
  p_col     text,
  p_earned  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_col = 'tasks_completed' then
    update workers
    set tasks_completed = tasks_completed + 1,
        total_earned_units = total_earned_units + p_earned::bigint,
        last_seen = now()
    where wallet = p_wallet;
  else
    update workers
    set tasks_failed = tasks_failed + 1,
        last_seen = now()
    where wallet = p_wallet;
  end if;
end;
$$;

-- ─── PRIVATE STORAGE BUCKET ───────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;
