# Disney World Offers Alert — Mini PRD

_Last updated: 2025-10-21._

## ✅ Quick Progress Checklist
- [x] Create GitHub repo + connect to Vercel (repo: `/web` for frontend, `/supabase/functions` for scraper) — 2025-10-21 ¹
- [x] Initialize Supabase project (DB + Edge Functions) — 2025-10-21 ¹
- [x] Create tables: `offers`, `users`, `scrape_log` (schema below) ¹
- [ ] Add Supabase Scheduled Edge Function (daily scrape) ¹
- [x] Implement scraper logic + hashing + diff detection (Cheerio DOM via `deno_dom`); capture full offer catalog with cookie-based geo presets (US national, US Florida, Canada) ¹
- [x] Store & hash offer data; detect new/changed deals ¹
- [x] Verify Supabase Edge Function (`offers-scraper`) deploy and run (with debug seed)
- [x] Confirm Supabase insert/update/versioning works
- [x] Basic local + Supabase tests passed
- [ ] Expand subscriber schema (`users`, `user_variant_preferences`, `email_queue`, `email_messages`) and import legacy Magic Trip Tools list
- [ ] Connect Supabase ↔ Kit API (bulk subscriber sync, tag assignment, webhook handling) ¹
- [ ] Build landing page (name, email, region selector) + wire to Supabase ¹
- [ ] Seed Kit segments/tags + map to Supabase variants
- [ ] Implement email content generation + broadcast automation (Kit API)
- [ ] E2E test: cron → new offer → email ¹
- [ ] GitHub Actions for Supabase deploy (Edge Functions) ¹
- [ ] (Optional) OpenAI: auto-summarize deal copy ¹
- [ ] Polish Kit email templates + add analytics/unsubscribe audit ¹
- [ ] Production deploy + domain ¹

¹ From the original PRD.  

## 🧭 Product Summary
**Goal:** Alert fans when new or updated offers appear, filtered by eligibility/region. Geo coverage now comes from deterministic Akamai cookie seeding (US national, Florida-only, Canada) and the default scrape runs every preset each time. ¹  
**Users:** Disney planners, APs, bloggers.  
**MVP Flow:** Daily scrape → compare hash → store/trigger email → link to official site. ¹

## 🗂️ Database Schema (Supabase)
- `offers(id, title, text, link, category, hash, first_seen, last_seen, last_changed, source, scrape_variant)` — live snapshot per locale; hash is SHA-256 over canonicalized title/text/link/category. `source` collapses to site family (`us` or `ca`); `scrape_variant` records the preset (`us`, `us-florida`, `ca`).
- `offer_versions(id, offer_id, title, text, link, category, source, scrape_variant, hash, captured_at)` — immutable history created whenever a hash changes.
- `users(id, email, first_name, last_name, status, marketing_opt_in, kit_contact_id, created_at, updated_at, last_synced_to_kit)` — Supabase is the source of truth for subscriber metadata.
- `user_variant_preferences(user_id, scrape_variant, created_at)` — multi-select locale preferences.
- `email_queue(id, scrape_variant, offer_ids, status, created_at, processed_at)` — pending per-variant notifications produced by the scraper.
- `email_messages(id, scrape_variant, subject, body_html, body_text, kit_broadcast_id, created_at, sent_at, summary_ai_model)` — record of outbound sends + generated copy.
- `scrape_log(id, run_time, source, offers_found, offers_new, offers_changed)` — run audit trail (source now equals the preset name).

> Legacy tables (`users`, `scrape_log`) have been extended rather than replaced. See migration notes for column additions.

## 🔄 Workflow (Vercel / Supabase / GitHub)
- Web: GitHub → Vercel auto-deploy on push to `main`. ¹
- Functions: GitHub Action deploys Edge Functions on push to `main`. ¹
- Scheduled job: runs scraper daily (04:00 ET target), enqueues emails, syncs subscribers, triggers Kit broadcasts, logs to `scrape_log` + `email_messages`.
- Env vars in Vercel & Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIT_API_KEY`, `OPENAI_API_KEY`. ¹

## v0.2 Milestone Summary
- Scraper deployed and verified end-to-end.
- Hashing + diff detection implemented.
- `offer_versions` table tracks historical changes; rows are captured whenever a hash changes. 
- Debug seed mode added for offline testing.
- Geo presets (national US, Florida, Canada) seeded via cookies; no upstream exclusions (Visa/Aulani) — downstream segmentation handles eligibility.
- Environment variables verified via Supabase secrets.
- Next: Kit email integration (v0.3).

## Kit Integration Overview

- **Authentication:** Prefer API key via `X-Kit-Api-Key` header for server-to-server jobs. OAuth token flow available if we later expose user-facing actions.
- **Core endpoints:**
  - Subscribers: `POST/PUT /v4/subscribers`, `POST /v4/bulk/subscribers`, `GET /v4/subscribers/{id}`, `POST /v4/subscribers/{id}/unsubscribe`.
  - Tags: `POST /v4/tags`, `GET /v4/tags`, `POST /v4/bulk/tags/subscribers`, `POST /v4/tags/{tag_id}/subscribers`, DELETE counterparts.
  - Broadcasts: `POST /v4/broadcasts`, `PUT /v4/broadcasts/{id}`, `GET /v4/broadcasts`, `GET /v4/broadcasts/stats`, `DELETE /v4/broadcasts/{id}`.
  - Email templates: `GET /v4/email_templates` (select template IDs for automation).
  - Webhooks: `POST /v4/webhooks` (`subscriber.unsubscribe`, `subscriber_activate`, etc.).
  - Custom fields: `POST /v4/custom_fields`, `GET /v4/custom_fields` for optional metadata.

## Subscriber Data Model

1. **Supabase as source of truth:**
   - `users` stores primary contact info, marketing consent, and the Kit subscriber ID (`kit_contact_id`).
   - `user_variant_preferences` captures multi-select locales (each preference maps to a Kit tag).
2. **Kit mirror:**
   - Core profile synced via bulk subscriber upserts (supports first name + custom fields).
   - Tags mirror the `scrape_variant` selections (one tag per locale: US national, Florida, Canada).
   - Optional custom fields (e.g., referral source, home state) can be mapped later.
3. **Status handling:**
   - `status` reflects current subscription state (`active`, `unsubscribed`, `bounced`...).
   - Webhook events from Kit update Supabase -> ensures we do not email unsubscribed contacts.

## Supabase ↔ Kit Sync Flow

1. **Nightly/batched sync (Edge Function):**
   - Query `users` where `updated_at > last_synced_to_kit`.
   - Chunk into ≤100 contacts and call `POST /v4/bulk/subscribers` with names + email; include custom fields as needed.
   - Write returned IDs into `kit_contact_id`, set `last_synced_to_kit = now()` and log failures.
   - For each variant preference change, compute tag add/remove operations and call `POST /v4/bulk/tags/subscribers` (or individual tag endpoints) using `kit_contact_id`.
2. **Immediate sync on sign-up (optional optimization):** call the same bulk endpoint with a single subscriber to avoid overnight delays.
3. **Webhook ingestion:**
   - Register Kit webhook for `subscriber.unsubscribe` (and optionally `subscriber.activate`).
   - Supabase Edge Function receives payload, looks up subscriber by Kit ID/email, updates `status`, clears preferences if needed, and records timestamp.
4. **Legacy import:** export existing Magic Trip Tools list, run one-time script to backfill `users`, `user_variant_preferences`, `kit_contact_id`, and `status`.

## Email Generation & Broadcast Workflow

1. **Scrape diffing:**
   - After each scrape run, collate offers where `last_changed` equals current run timestamp per variant.
   - If no changes for a variant, skip queueing.
2. **Queue entries:**
   - Insert into `email_queue` with `scrape_variant`, `offer_ids`, `status='pending'`.
3. **Content building:**
   - Generate HTML + plaintext from the offer diff (canonical list format).
   - Optional: call OpenAI to generate intro summary and store metadata (`summary_ai_model`).
4. **Broadcast creation:**
   - Select template ID (e.g., Text Only = 6) via `GET /v4/email_templates`.
   - Compose payload `POST /v4/broadcasts` with subject, preview text, body, `subscriber_filter` targeting the variant tag (`[{ "all": [{ "type": "tag", "ids": [tag_id] }]}]`).
   - Set `send_at` (null for immediate, or schedule in the future) and `published_at` if required by Kit.
   - Record response ID in `email_messages` and mark queue row `sent`.
5. **Monitoring:**
   - Poll `GET /v4/broadcasts/stats` or `GET /v4/broadcasts/{id}` to capture delivery metrics for dashboards.
6. **Error handling:**
   - If broadcast creation fails, leave queue row in `error` state with message for manual follow-up.

## Tag & Custom Field Setup

- Tags required:
  - `Deals – US` → variant `us`
  - `Deals – Florida` → variant `us-florida`
  - `Deals – Canada` → variant `ca`
- Optional future tags (e.g., resort categories, AP-only).
- Custom fields to consider:
  - `home_region`, `planning_window`, `referral_source`. Create via `POST /v4/custom_fields` and update using subscriber payload `fields` object.
- Maintain mapping table (`kit_config`) in Supabase storing tag IDs + custom field keys to avoid hardcoding in code.

## Frontend Guidance (for Bolt/Next.js partner)

- **Sign-up form:** Collect first name (optional), last name, email, and a multi-select for deal variants (US national, Florida-only, Canada). Submit to a Supabase Edge handler or directly via Supabase client to insert into `users` and `user_variant_preferences`.
- **Confirmation state:** After submission, show a success message and optionally trigger a double opt-in email via Kit (set `state='active'` by default unless double opt-in required).
- **Preference center:** Provide a page that fetches the user’s current preferences/authenticated session, allowing toggles for each locale. Update Supabase; the nightly sync will push changes to Kit tags.
- **Offer feed (public):** Use Supabase client (server-side or client-side) to query `offers` filtered by `scrape_variant` for landing page previews.
- **Admin dashboard (optional):** Display `scrape_log`, `email_queue`, and latest broadcast IDs for quick monitoring.

## Implementation Roadmap

1. **Schema migrations:** add/alter tables listed above; ensure Supabase Row Level Security adjusted for new tables if needed.
2. **Import existing subscribers:** write script to ingest the 600 KIT contacts into Supabase, mapping current tags to `user_variant_preferences`.
3. **Tag bootstrap:** create Kit tags for each variant and store IDs in Supabase config.
4. **Subscriber sync function:** implement Edge Function that batches unsynced users, upserts into Kit, and applies tags.
5. **Webhook endpoint:** add Supabase function to receive Kit unsubscribe events and update Supabase.
6. **Email queue processor:** extend scraper (or follow-up function) to populate `email_queue`, generate content, create broadcasts, and log results.
7. **Frontend:** build Bolt-generated Next.js site (landing page + preference center) wired to Supabase.
8. **Automation:** enable Supabase schedule (04:00 ET) once pipeline is stable; add GitHub Actions for automated deploys.

## 🔜 What's next
- Create daily scheduled run configuration for the Supabase Edge Function once email pipeline is ready.
- Implement Supabase ↔ Kit sync + deal broadcast automation (sections above).
- Build landing page (name, email, region selector) + wire to Supabase ¹
- Future: Multi-park support, integration with Disney Parks Blog RSS (filtered to WDW) ¹; deal calendar using `offer_versions`.
