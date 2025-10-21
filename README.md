# Disney World Offers Alert

Get notified when new or updated Walt Disney World offers go live on the official site.

## Quick start

### Web (Next.js on Vercel)
- `cd web && npm i && npm run dev` to run locally.
- Connect this repo to Vercel; pushes to `main` auto-deploy.

### Supabase (DB + Edge Functions)
- `supabase login` and `supabase link --project-ref <PROJECT_REF>`
- `supabase db push` to apply migrations.
- `supabase functions deploy offers-scraper`
- Create a **Scheduled** job in Supabase to run `offers-scraper` daily.
- The Edge Function seeds Akamai geo cookies to capture every visible offer; no filters (Visa/Aulani) are applied upstream anymore. Offers store both `source` (site family: `us` or `ca`) and `scrape_variant` (`us`, `us-florida`, `ca`) for downstream segmentation.

### Environment
Copy `.env.example` to your local/hosting envs and fill in:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KIT_API_KEY`, `OPENAI_API_KEY`.

### Architecture
Daily Edge Function scrapes WDW offer pages, hashes content, compares to last snapshot, writes to `offers`, logs in `scrape_log`, and triggers Kit segmented emails when new/changed offers are found. (Flow per PRD.)

## Development
- Deploy the scraper with `supabase functions deploy offers-scraper --project-ref esuzczidystwsubdapzp`.
- Set `SCRAPER_DEBUG_SEED=1` for deterministic local/debug runs.
- Quick curl checks while serving locally (`supabase functions serve offers-scraper`):
  ```bash
  # Deterministic seed — first run returns new=2, changed=0, same=0
  curl -s \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    http://localhost:54321/functions/v1/offers-scraper | jq

  # Variant toggle — simulates a changed + newly added offer
  curl -s \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    "http://localhost:54321/functions/v1/offers-scraper?_variant=1" | jq

  # Repeat baseline — should now report same=2 with deterministic seed
  curl -s \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    http://localhost:54321/functions/v1/offers-scraper | jq
  ```

### Locale presets
- `source=us` (default) scrapes the national catalog plus the Florida-only catalog by replaying the required geo cookies.
- `source=us-only` limits the run to the national catalog.
- `source=us-florida` limits to the Florida preset.
- `source=ca` scrapes the Canadian catalog (forces `en_CA` locale cookies).
- `source=all` runs every preset (`us`, `us-florida`, `ca`).

Each preset is inserted independently into Supabase with its own `source` key, so downstream tooling can filter or merge regions as needed.

## Monorepo notes
- `AGENTS.md` explains build/test commands, code style, security, and PR rules.
- `docs/PRD.md` is the living product doc with checklist and schema.
