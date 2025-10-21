# AGENTS.md

## Project overview
Disney World Offers Alert monitors official WDW offer pages and emails subscribers when offers are added or changed.

## Build & test
- **Web**: `cd web && npm i && npm run dev`
- **Type check / lint**: `npm run lint` (root), `cd web && npm run lint`
- **Supabase**: `supabase db push` (apply migrations), `supabase functions serve offers-scraper`

## Code style
- Prettier + ESLint. Run `npm run format` before commits.

## Testing instructions
- Unit tests (web): `npm test` (add Vitest/Jest as needed)
- Function dry-run: `supabase functions serve offers-scraper` then hit the local endpoint. Default execution scrapes both the national (`source=us`) and Florida-only (`source=us-florida`) catalogs; pass `?source=us-only`, `?source=us-florida`, `?source=ca`, or `?source=all` to target specific presets. Rows now store the preset on `scrape_variant`.

## Security considerations
- Never commit secrets. Use Vercel/Supabase dashboards for env vars.
- The scraper uses only official WDW pages; respect robots and avoid aggressive rates.

## Commit / PR guidelines
- Conventional commits (`feat:`, `fix:`, `chore:`).
- Include context links to related PRD checklist items.
- CI must pass (lint + function deploy).

## Deployment
- Web auto-deploys via Vercel on `main`.
- Edge Functions auto-deploy via GitHub Actions (see `.github/workflows`).

## Large monorepo guidance
- Add nested `AGENTS.md` to `/web` and to each function for overrides if complexity grows.
