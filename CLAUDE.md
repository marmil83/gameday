@AGENTS.md

# GameDay

Sports game recommendation engine — "The easiest way to decide if a game is worth going to."

## Tech Stack
- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (PostgreSQL + Auth)
- Anthropic Claude API (enrichment)
- SeatGeek API (events + pricing)

## Key Architecture
- **Automation-first**: Pipeline runs automatically (events → pricing → promos → AI enrichment → scoring → ranking)
- **Admin is a fallback**, not the primary workflow
- **Deal Score** is rules-based and deterministic (see `src/lib/scoring/deal-score.ts`)
- **AI enriches** but does not fabricate — used for promo extraction, vibe tags, verdicts, insights

## Project Structure
- `src/app/` — Next.js pages and API routes
- `src/lib/pipeline/` — Ingestion orchestrator (events, promotions, enrichment)
- `src/lib/scoring/` — Deal Score calculator
- `src/lib/ai/` — Claude API integration
- `src/lib/supabase/` — DB client (browser, server, service role)
- `src/types/` — TypeScript types matching Supabase schema
- `supabase/migrations/` — SQL schema
- `supabase/seed/` — Seed data (cities + teams)

## Commands
- `npm run dev` — development server
- `npx tsc --noEmit` — type check

## MVP Cities
Detroit MI, Portland OR
