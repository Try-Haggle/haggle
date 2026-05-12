create table if not exists agent_payment_grants (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  agent_id text not null,
  listing_id uuid not null,
  seller_id uuid not null,
  order_id uuid,
  settlement_approval_id uuid,
  max_amount_minor numeric(18, 0) not null,
  currency text not null default 'USD',
  asset text not null default 'USDC',
  network text not null default 'base',
  allowed_rails text[] not null default array['x402', 'stripe'],
  preferred_rail text not null default 'x402',
  terms jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  nonce text not null,
  human_confirmation_required boolean not null default true,
  legal_acknowledgements jsonb not null default '{}'::jsonb,
  approval_policy_hash text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_payment_grants_policy_hash_uidx on agent_payment_grants (approval_policy_hash);
create unique index if not exists agent_payment_grants_nonce_uidx on agent_payment_grants (nonce);
create index if not exists agent_payment_grants_buyer_id_idx on agent_payment_grants (buyer_id);
create index if not exists agent_payment_grants_seller_id_idx on agent_payment_grants (seller_id);
create index if not exists agent_payment_grants_listing_id_idx on agent_payment_grants (listing_id);
create index if not exists agent_payment_grants_status_idx on agent_payment_grants (status);
create index if not exists agent_payment_grants_expires_at_idx on agent_payment_grants (expires_at);

alter table payment_intents add column if not exists agent_payment_grant_id uuid;
alter table payment_intents add column if not exists approval_policy_hash text;
alter table payment_intents add column if not exists agreement_hash text;
alter table payment_intents add column if not exists listing_hash text;

create index if not exists payment_intents_agent_payment_grant_id_idx on payment_intents (agent_payment_grant_id);
create index if not exists payment_intents_approval_policy_hash_idx on payment_intents (approval_policy_hash);

create table if not exists payment_disclosures (
  id uuid primary key default gen_random_uuid(),
  agent_payment_grant_id uuid not null,
  payment_intent_id uuid,
  rail text not null,
  version text not null,
  text_hash text not null,
  accepted_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_disclosures_agent_payment_grant_id_idx on payment_disclosures (agent_payment_grant_id);
create index if not exists payment_disclosures_payment_intent_id_idx on payment_disclosures (payment_intent_id);
