# Disney World Offers Alert — Mini PRD

_Last updated: 2025-10-21._

## ✅ Quick Progress Checklist
- [x] Create GitHub repo + connect to Vercel (repo: `/web` for frontend, `/supabase/functions` for scraper) — 2025-10-21 ¹
- [x] Initialize Supabase project (DB + Edge Functions) — 2025-10-21 ¹
- [x] Create tables: `offers`, `users`, `scrape_log` (schema below) ¹
- [ ] Add Supabase Scheduled Edge Function (daily scrape) ¹
- [x] Implement scraper logic + hashing + diff detection (Playwright or Cheerio; skip Aulani/Visa offers) ¹
- [x] Store & hash offer data; detect new/changed deals ¹
- [x] Verify Supabase Edge Function (`offers-scraper`) deploy and run (with debug seed)
- [x] Confirm Supabase insert/update/versioning works
- [x] Basic local + Supabase tests passed
- [ ] Connect Supabase → Kit API to trigger segmented emails ¹
- [ ] Build landing page (name, email, region selector) + wire to Supabase ¹
- [ ] E2E test: cron → new offer → email ¹
- [ ] GitHub Actions for Supabase deploy (Edge Functions) ¹
- [ ] (Optional) OpenAI: auto-summarize deal copy ¹
- [ ] Polish Kit email templates + add analytics/unsubscribe audit ¹
- [ ] Production deploy + domain ¹

¹ From the original PRD.  

## 🧭 Product Summary
**Goal:** Alert fans when new or updated offers appear, filtered by eligibility/region. ¹  
**Users:** Disney planners, APs, bloggers.  
**MVP Flow:** Daily scrape → compare hash → store/trigger email → link to official site. ¹

## 🗂️ Database Schema (Supabase)
- `offers(id, title, text, link, category, hash, created_at)` ¹  
- `users(id, name, email, region_tag, created_at)` ¹  
- `scrape_log(id, run_time, offers_found, offers_new, offers_changed)` ¹

## 🔄 Workflow (Vercel / Supabase / GitHub)
- Web: GitHub → Vercel auto-deploy on push to `main`. ¹
- Functions: GitHub Action deploys Edge Functions on push to `main`. ¹
- Scheduled job: runs scraper daily; calls Kit API; logs to `scrape_log`. ¹
- Env vars in Vercel & Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIT_API_KEY`, `OPENAI_API_KEY`. ¹

## v0.2 Milestone Summary
- Scraper deployed and verified end-to-end.
- Hashing + diff detection implemented.
- `offer_versions` table tracks historical changes.
- Debug seed mode added for offline testing.
- Environment variables verified via Supabase secrets.
- Next: Kit email integration (v0.3).

## 🔜 What's next
- Create daily scheduled run configuration for the Supabase Edge Function.
- Connect Supabase → Kit API to trigger segmented emails ¹
- Build landing page (name, email, region selector) + wire to Supabase ¹
- Future: Multi-park support, Integration with Disney Parks Blog RSS (filtered to WDW) ¹
