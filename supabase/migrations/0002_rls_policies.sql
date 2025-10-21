-- Enable RLS on core tables
alter table offers enable row level security;
alter table users enable row level security;
alter table scrape_log enable row level security;

-- Offers policies
alter table offers force row level security;

drop policy if exists "Allow read access to offers for anon" on offers;
create policy "Allow read access to offers for anon" on offers
    for select
    to anon
    using (true);

drop policy if exists "Allow read access to offers for authenticated" on offers;
create policy "Allow read access to offers for authenticated" on offers
    for select
    to authenticated
    using (true);

drop policy if exists "Allow insert on offers for service_role" on offers;
create policy "Allow insert on offers for service_role" on offers
    for insert
    to service_role
    with check (true);

drop policy if exists "Allow update on offers for service_role" on offers;
create policy "Allow update on offers for service_role" on offers
    for update
    to service_role
    using (true)
    with check (true);

drop policy if exists "Allow delete on offers for service_role" on offers;
create policy "Allow delete on offers for service_role" on offers
    for delete
    to service_role
    using (true);

-- Users policies
alter table users force row level security;

drop policy if exists "Allow anon inserts on users" on users;
create policy "Allow anon inserts on users" on users
    for insert
    to anon
    with check (true);

drop policy if exists "Allow service_role access to users" on users;
create policy "Allow service_role access to users" on users
    for all
    to service_role
    using (true)
    with check (true);

-- Scrape log policies
alter table scrape_log force row level security;

drop policy if exists "Allow service_role access to scrape_log" on scrape_log;
create policy "Allow service_role access to scrape_log" on scrape_log
    for all
    to service_role
    using (true)
    with check (true);
