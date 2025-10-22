-- Migration: add source column to scrape_log for variant tracking (2025-10-21)

alter table if exists public.scrape_log
    add column if not exists source text;
