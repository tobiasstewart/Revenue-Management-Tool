# Hartmann Planning Revenue Management Tool

Revenue management tool for Hartmann Planning. Same stack as the cashflow modelling tool: Next.js 15 (App Router, React 19) + Supabase (hosted, Sydney) + Tailwind 3, deployed on Vercel (`syd1`). Firm-scoped via RLS.

## Architecture

```
src/
  app/(app)/          # Authenticated pages (layout renders Sidebar; dashboard)
  app/(auth)/         # Login
  app/api/auth/       # login (POST, server-side sign-in) + logout
  app/auth/confirm/   # Supabase email callback (OTP + PKCE)
  components/layout/  # Sidebar.tsx
  lib/supabase.ts     # createClient (browser), createServerSupabaseClient (server), createAdminClient (service role)
  lib/csp.ts          # buildCsp / makeNonce (pure, tested)
  middleware.ts       # session gate + per-request CSP nonce
supabase/migrations/  # SQL migrations (applied to prod by .github/workflows/migrate-prod.yml)
```

## Auth + security

- Middleware: `getUser()` (never `getSession()`) on every non-public request; unauthenticated → `/login?next=…`. Public: `/login`, `/auth/confirm`; `/api/auth/*` is passthrough.
- Password sign-in goes through `POST /api/auth/login`, never `signInWithPassword` in the browser, so a server-side throttle and MFA step can be added there.
- CSP: strict nonce policy built in `lib/csp.ts`; the root layout is `force-dynamic` so every page gets a nonce. Adding an external script/CDN/font means editing `buildCsp()`.
- `app/auth/confirm/route.ts` logs flow + outcome ONLY — never the URL, token_hash/code or email.
- NOT YET PORTED from the cashflow tool: TOTP MFA (aal2 gate + `require_mfa_aal2` RLS), login throttle, account deactivation flow, admin user management.

## Database

- `firms` + `users` (migration 001). `get_my_firm_id()` returns NULL for inactive users. `users`/`firms` are written ONLY by the service role.
- Every new business table carries `firm_id` (directly or via a parent) and an RLS policy on `get_my_firm_id()`.
- `createAdminClient()` bypasses RLS — firm scoping on it is MANUAL.
- Migrations reach prod via the `migrate-prod.yml` Action (needs the `PROD_SUPABASE_DB_URL` secret). Vercel deploys code independently of that Action, so always confirm a migration landed after pushing.

## Testing

- `npm run typecheck`, `npm test` (vitest), and `npm run build` when adding/changing a route file (`page.tsx`/`route.ts`/`layout.tsx` — a stray named export from a page is valid TS but fails `next build`).
- Next 15: `params`/`searchParams` and route-handler context params are Promises — `await` them.

## Colour scheme

Primary teal `#0D8585`, blue accent `#2E75B6`, light grey rows `#F5F7FA`, light teal sections `#E0F2F1`, negative `#DC2626`.
