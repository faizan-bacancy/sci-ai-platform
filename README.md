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
where email = 'you@company.com';
```

