create extension if not exists pgcrypto;

create table if not exists trust_penalty_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  actor_id uuid not null,
  actor_role text not null,
  reason text not null,
  penalty_score numeric(8, 4) not null,
  onchain_reference text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trust_penalty_records_actor_id_idx on trust_penalty_records (actor_id);
create index if not exists trust_penalty_records_order_id_idx on trust_penalty_records (order_id);

create table if not exists settlement_reliability_snapshots (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_role text not null,
  successful_settlements integer not null default 0,
  approval_defaults integer not null default 0,
  shipment_sla_misses integer not null default 0,
  dispute_wins integer not null default 0,
  dispute_losses integer not null default 0,
  settlement_reliability numeric(8, 4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists settlement_reliability_snapshots_actor_uidx
  on settlement_reliability_snapshots (actor_id, actor_role);

create table if not exists onchain_trust_profiles (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  wallet_address text,
  anchored_at timestamptz,
  reputation_score numeric(8, 4) not null,
  settlement_reliability numeric(8, 4) not null,
  successful_settlements integer not null default 0,
  approval_defaults integer not null default 0,
  shipment_sla_misses integer not null default 0,
  dispute_wins integer not null default 0,
  dispute_losses integer not null default 0,
  onchain_reference text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists onchain_trust_profiles_actor_uidx
  on onchain_trust_profiles (actor_id);
