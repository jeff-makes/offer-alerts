-- Migration: Add offer hashing and historical tracking support (2024-04-27)
-- Ensures offer metadata columns exist, introduces offer_versions history table,
-- and refreshes RLS policies for read access.

-- Ensure required extensions for UUID generation
create extension if not exists "pgcrypto";

-- Core offers table adjustments
alter table if exists public.offers
    add column if not exists hash text,
    add column if not exists first_seen timestamptz default now(),
    add column if not exists last_seen timestamptz default now(),
    add column if not exists last_changed timestamptz default now(),
    add column if not exists source text,
    add column if not exists category text;

-- Backfill temporal metadata for existing rows
update public.offers
set
    first_seen = coalesce(first_seen, created_at, now()),
    last_seen = coalesce(last_seen, created_at, now()),
    last_changed = coalesce(last_changed, created_at, now())
where
    first_seen is null
    or last_seen is null
    or last_changed is null;

-- Ensure supporting tables exist (simple definitions)
create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    name text,
    email text unique,
    region_tag text,
    created_at timestamptz default now()
);

create table if not exists public.scrape_log (
    id uuid primary key default gen_random_uuid(),
    run_time timestamptz default now(),
    offers_found integer,
    offers_new integer,
    offers_changed integer
);

-- Historical offer versions table for tracking changes over time
create table if not exists public.offer_versions (
    id uuid primary key default gen_random_uuid(),
    offer_id uuid not null references public.offers(id) on delete cascade,
    title text,
    text text,
    link text,
    category text,
    source text,
    hash text,
    captured_at timestamptz not null default now()
);

-- Helpful indexes for current and historical lookups
create unique index if not exists offers_source_link_key on public.offers (source, link);
create index if not exists offer_versions_offer_id_captured_idx on public.offer_versions (offer_id, captured_at desc);

-- Row Level Security configuration
alter table if exists public.offers enable row level security;
alter table if exists public.offer_versions enable row level security;

alter table if exists public.offers force row level security;
alter table if exists public.offer_versions force row level security;

-- Offers policies (read-only for client roles, full access for service role)
drop policy if exists "Allow read access to offers for anon" on public.offers;
create policy "Allow read access to offers for anon" on public.offers
    for select
    to anon
    using (true);

drop policy if exists "Allow read access to offers for authenticated" on public.offers;
create policy "Allow read access to offers for authenticated" on public.offers
    for select
    to authenticated
    using (true);

drop policy if exists "Allow insert on offers for service_role" on public.offers;
drop policy if exists "Allow update on offers for service_role" on public.offers;
drop policy if exists "Allow delete on offers for service_role" on public.offers;
drop policy if exists "Allow service_role access to offers" on public.offers;
create policy "Allow service_role access to offers" on public.offers
    for all
    to service_role
    using (true)
    with check (true);

-- Offer versions policies (read-only for client roles, full access for service role)
drop policy if exists "Allow read access to offer_versions for anon" on public.offer_versions;
create policy "Allow read access to offer_versions for anon" on public.offer_versions
    for select
    to anon
    using (true);

drop policy if exists "Allow read access to offer_versions for authenticated" on public.offer_versions;
create policy "Allow read access to offer_versions for authenticated" on public.offer_versions
    for select
    to authenticated
    using (true);

drop policy if exists "Allow service_role access to offer_versions" on public.offer_versions;
create policy "Allow service_role access to offer_versions" on public.offer_versions
    for all
    to service_role
    using (true)
    with check (true);
