-- Migration: add scrape_variant column for geo preset tracking (2025-10-21)

alter table if exists public.offers
    add column if not exists scrape_variant text;

alter table if exists public.offer_versions
    add column if not exists scrape_variant text;

-- Drop legacy uniqueness constraint before backfilling values.
drop index if exists offers_source_link_key;

-- Backfill offers table.
update public.offers
set scrape_variant = coalesce(scrape_variant, source);

update public.offers
set source = case when source = 'us-florida' then 'us' else source end;

-- Backfill offer_versions history table.
update public.offer_versions
set scrape_variant = coalesce(scrape_variant, source);

update public.offer_versions
set source = case when source = 'us-florida' then 'us' else source end;

-- Recreate uniqueness constraint with the new dimension.
create unique index if not exists offers_source_variant_link_key
    on public.offers (source, scrape_variant, link);
