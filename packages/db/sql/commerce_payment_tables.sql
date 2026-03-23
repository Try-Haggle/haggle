create extension if not exists pgcrypto;

create table if not exists settlement_approvals (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  seller_id uuid not null,
  buyer_id uuid not null,
  approval_state text not null default 'NEGOTIATING',
  seller_approval_mode text not null,
  selected_payment_rail text not null,
  currency text not null default 'USD',
  final_amount_minor numeric(18, 0) not null,
  hold_kind text,
  held_snapshot_price_minor numeric(18, 0),
  held_snapshot_utility numeric(8, 4),
  held_at timestamptz,
  hold_reason text,
  resume_reprice_required boolean not null default true,
  reserved_until timestamptz,
  buyer_approved_at timestamptz,
  seller_approved_at timestamptz,
  shipment_input_due_at timestamptz,
  terms_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settlement_approvals_listing_id_idx on settlement_approvals (listing_id);
create index if not exists settlement_approvals_seller_id_idx on settlement_approvals (seller_id);
create index if not exists settlement_approvals_buyer_id_idx on settlement_approvals (buyer_id);
create index if not exists settlement_approvals_approval_state_idx on settlement_approvals (approval_state);

create table if not exists commerce_orders (
  id uuid primary key default gen_random_uuid(),
  settlement_approval_id uuid not null,
  listing_id uuid not null,
  seller_id uuid not null,
  buyer_id uuid not null,
  status text not null default 'APPROVED',
  currency text not null default 'USD',
  amount_minor numeric(18, 0) not null,
  order_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_orders_settlement_approval_id_uidx on commerce_orders (settlement_approval_id);
create index if not exists commerce_orders_seller_id_idx on commerce_orders (seller_id);
create index if not exists commerce_orders_buyer_id_idx on commerce_orders (buyer_id);
create index if not exists commerce_orders_status_idx on commerce_orders (status);

create table if not exists payment_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  seller_id uuid not null,
  buyer_id uuid not null,
  selected_rail text not null,
  allowed_rails text[] not null default array['x402', 'stripe'],
  buyer_authorization_mode text not null default 'human_wallet',
  currency text not null default 'USD',
  amount_minor numeric(18, 0) not null,
  status text not null default 'CREATED',
  provider_context jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_intents_order_id_idx on payment_intents (order_id);
create index if not exists payment_intents_seller_id_idx on payment_intents (seller_id);
create index if not exists payment_intents_buyer_id_idx on payment_intents (buyer_id);
create index if not exists payment_intents_status_idx on payment_intents (status);

create table if not exists payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null,
  rail text not null,
  provider_reference text not null,
  authorized_amount_minor numeric(18, 0) not null,
  currency text not null default 'USD',
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_authorizations_payment_intent_id_idx on payment_authorizations (payment_intent_id);
create index if not exists payment_authorizations_provider_reference_idx on payment_authorizations (provider_reference);

create table if not exists payment_settlements (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null,
  rail text not null,
  provider_reference text not null,
  settled_amount_minor numeric(18, 0) not null,
  currency text not null default 'USD',
  status text not null default 'PENDING',
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_settlements_payment_intent_id_idx on payment_settlements (payment_intent_id);
create index if not exists payment_settlements_provider_reference_idx on payment_settlements (provider_reference);

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null,
  amount_minor numeric(18, 0) not null,
  currency text not null default 'USD',
  reason_code text not null,
  status text not null default 'REQUESTED',
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refunds_payment_intent_id_idx on refunds (payment_intent_id);
