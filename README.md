# SupplyIQ (Phase 1)

Next.js + Supabase foundation for a B2B Supply Chain Intelligence Platform.

## Prerequisites
- Node.js (recommended: latest LTS)
- A Supabase project (Postgres + Auth enabled)

## Setup
1. Install dependencies:
   - `npm install`
2. Create `.env.local` from `.env.example` and fill in values.
3. Start dev server:
   - `npm run dev`

Open `http://localhost:3000`.

## Environment variables
See `.env.example`.

## Supabase migrations
SQL migrations live in `supabase/migrations`.

1. Install Supabase CLI (if needed):
   - `npm i -g supabase`
2. Login and link project:
   - `supabase login`
   - `supabase link --project-ref <your-project-ref>`
3. Apply pending migrations to remote:
   - `supabase db push`

For local DB workflow:
- Start local stack: `supabase start`
- Apply migrations locally: `supabase migration up`

## Routes
- Public:
  - `/login`
  - `/signup`
- Protected (requires auth via middleware):
  - `/dashboard`
  - `/inventory`
  - `/suppliers`
  - `/forecasting`
  - `/alerts`
  - `/settings`

## Admin bootstrap
New signups default to `viewer`. To promote a user to `admin`, run a one-time SQL update in Supabase:

```sql
update public.profiles
set role = 'admin'
where lower(email) = lower('you@company.com');
```

Note: `enforce_profile_update()` now allows trusted backend/admin sessions (`service_role`, `postgres`, `supabase_admin`) to update protected profile fields without disabling triggers.
