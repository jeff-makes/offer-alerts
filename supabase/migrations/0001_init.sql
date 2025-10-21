-- Initial schema migration defining core tables

create table if not exists public.offers (
    id uuid primary key,
    title text,
    text text,
    link text,
    category text,
    hash text,
    created_at timestamptz
);

create index if not exists offers_hash_idx on public.offers(hash);

create table if not exists public.users (
    id uuid primary key,
    name text,
    email text unique,
    region_tag text,
    created_at timestamptz
);

create table if not exists public.scrape_log (
    id uuid primary key,
    run_time timestamptz,
    offers_found integer,
    offers_new integer,
    offers_changed integer
);
