# Hartmann Planning Revenue Management Tool

Revenue tracking for Hartmann Planning's advice business. Same stack as the cashflow modelling tool: Next.js 15 (App Router, React 19) + Supabase (hosted, Sydney, project `sjgsoxgukazywswuynvb` "revenue-management-tool") + Tailwind 3, deployed on Vercel (`syd1`). Firm-scoped via RLS.

## The business rules (why the tool exists)

- Revenue arrives as (1) clients depositing straight into the bank (mostly upfront fees), (2) Ezidebit direct debits with a per-client report, (3) platforms / annuity / investment-bond providers (client fees from product cash accounts — one monthly deposit + an Excel statement) and insurers (commission, often weekly statements; upfront weekly, renewals monthly/yearly).
- Each statement line is matched to a client HOUSEHOLD → its ADVISER, and classified UPFRONT / ONGOING / ONE-OFF.
- ADVISER SPLIT: the adviser keeps 60% (firm default, `firm_settings.upfront_adviser_pct`; per-adviser override `advisers.upfront_split_pct`) of UPFRONT revenue; ONE-OFF uses `firm_settings.one_off_adviser_pct` (default 60 — unconfirmed business rule); ONGOING (ongoing fees, renewal/trail commission) is 0% — all to the business, which is reported by SHAREHOLDING (`shareholders`, dated; each month uses holdings in effect on its last day). Splits apply to the EX-GST amount.
- TWO REPORTING BASES on every report/dashboard: RECEIVED (`revenue_lines.received_date` — the day dollars hit the bank; advisers/shareholders are paid on this basis at the start of the following month) and GENERATED (`revenue_lines.generation_month` — the month the revenue was earned; tax/audit basis). Platform money received in September for August fees: received = Sep, generated = Aug. `providers.generation_offset_months` (platform/annuity/bond default −1, others 0) sets a statement's default revenue month; a mapped period column overrides per line.

## Data model (migrations 001–005)

```
firms ─ users (auth-linked, service-role writes) ─ user_invites (002: trigger creates the users row when an auth user with an invited email is CONFIRMED)
firm_settings (split %s; auto-created per firm)
advisers, shareholders            — writes ADMIN-ONLY (is_firm_admin())
households (adviser_id)           — client groups
providers (type, offset, import_mapping jsonb = saved column layout + learnt fee wording)
client_references                 — learnt matching keys: kind reference (account/policy no.) | name; NORMALISED (lib/matching.ts); provider_id NULL = any provider
statements                        — one per statement/deposit: received_date, generation_month (1st of month), deposit_amount_cents (incl GST, for reconciliation), storage_path ({firm_id}/{statement_id}/{file} in the private `statements` bucket)
revenue_lines                     — one per fee row: amount_cents EX GST + gst_cents, fee_type (NULL = needs review), household_id, adviser_id + adviser_split_pct SNAPSHOTS
statement_summaries               — security_invoker view of per-statement totals
adviser_references                — (005) learnt provider adviser codes/names → adviser (kind code | name, normalised, provider_id NULL = any)
revenue_lines.raw_adviser_code/raw_adviser_name/adviser_source — the adviser the STATEMENT names wins: source 'statement' (import), 'household' (filled by trigger), 'manual' (set by a person)
```

The `revenue_lines_before_write` TRIGGER is the source of truth for line derivations — don't duplicate it in app code: provider_id/received_date always copied from the statement; generation_month truncated to the 1st; adviser comes from the statement when it names one (`adviser_source='statement'`); the household fills it only when the source is NULL/'household' — re-matching or unmatching a household never overrides a statement or manual adviser; match_status forced to unmatched without a household; `adviser_split_pct` recomputed only when fee_type or adviser changes (ongoing → 0, upfront → adviser override ?? firm, one_off → firm). So a household changing adviser or a split change never re-attributes revenue already matched. `statements_after_update` pushes received_date to all lines and generation_month to lines still on the OLD month. `assert_in_firm()` guards every cross-table reference (FK checks bypass RLS). Firm_id columns DEFAULT to `get_my_firm_id()` — app inserts omit firm_id.

Money is integer CENTS everywhere; dollars only at parse/format edges (`lib/money.ts`). Dates are ISO strings, never Date objects (`lib/periods.ts`; FY = Jul–Jun named by ending year, label "FY2026–27"; "today" is Sydney time).

## Code map

```
src/lib/                 PURE + unit-tested (src/lib/__tests__): money, periods, fee-type (classifier: one_off → upfront → ongoing keywords, conservative, provider mapping wins), matching (auto = learnt reference / learnt name / unique exact household name; partial token match is only a SUGGESTION), reports (totals, upfrontsOwed, shareholderDistribution), import/{csv,cells,mapping} (header detection, column guessing by header TEXT, GST handling, total-row skipping), csv-export
src/lib/data.ts          browser loaders — fetchAll pages past PostgREST's 1000-row cap; loadLinesForPeriod(basis, period)
src/lib/line-actions.ts  updateLines (reads back trigger-derived fields), rememberMatch (learns a client_reference), rememberFeeType (learns provider wording), createHousehold
src/app/api/statements/parse  POST multipart → {sheets: [{name, rows}]} (exceljs for .xlsx, CSV parser; .xls refused with a save-as hint). Stores NOTHING — the browser saves under the user's session (RLS).
src/app/(app)/           dashboard (month + basis in the URL; default = last month, received), statements (list / new = upload wizard / manual / [id] = editor + reconciliation), review (all unmatched/unclassified lines), reports (month/FY/custom × basis × group-by + CSV exports), households(/[id]), providers, advisers, settings
src/components/revenue/  LinesTable (the line editor: matching, fee type, adviser override, revenue month, bulk actions; matching with "remember" learns the key AND matches the same client's other lines in view), HouseholdPicker (search + inline create), PeriodControls, ReportTables (shared by dashboard + reports so figures can't drift)
```

STATEMENT FORMATS: insurers (e.g. Acenda CSV) carry Adviser number + Adviser name, split Client first/last name, "Commission paid excluding GST" + GST + Total, Statement date, a "Balance brought forward" footer (no ex-GST amount → skipped). `guessColumns` has per-field HEADER_EXCLUDE patterns (e.g. "Commission type" is never the amount, "Benefit Start Date" never the period, "Company name" never the client) — add a test in `__tests__/acenda-statement.test.ts`-style (synthetic rows, real headers — NEVER commit real client data) for each new provider format. Clawbacks arrive as negative upfront lines and reduce the adviser's share.

Upload flow: details → parse → map columns (pre-filled from the provider's saved mapping when its headers still exist, else guessed) → "Advisers on this statement" table (auto by learnt code/name or exact adviser name; choices saved to adviser_references) → fee-type value table → preview with matches + reconciliation + duplicate (same provider + received date) warning → import = insert statement, upload original file, insert lines in 500s, save mapping; any failure deletes the statement + file.

## Auth + security

- Middleware: `getUser()` (never `getSession()`) on every non-public request; unauthenticated → `/login?next=…`. Public: `/login`, `/auth/confirm`; `/api/auth/*` passthrough. The `(app)` layout shows "Account not set up" for a session with no `users` row (never invited / inactive).
- Accounts are INVITE-ONLY: insert a `user_invites` row (service role / SQL), then create the auth user (Supabase dashboard → Authentication → Add user, auto-confirm) — the trigger links it. No in-app user management yet.
- Password sign-in goes through `POST /api/auth/login` (server-side) so a throttle/MFA step can be added there.
- CSP: strict nonce policy (`lib/csp.ts`); root layout `force-dynamic`. File downloads use Supabase signed URLs (navigation, not fetch).
- NOT YET PORTED from the cashflow tool: TOTP MFA (aal2 + restrictive `require_mfa_aal2` RLS), login throttle, deactivation flow, admin user management. MFA should land before wide use — this data names clients and their fees.
- `npm audit --omit=dev`: one accepted MODERATE (minimatch ReDoS under exceljs → archiver; only reachable via glob patterns when WRITING zips — we only read workbooks). `uuid` and `postcss` are pinned via `overrides`; `npm audit fix` trips an npm "edgesOut" bug here — edit versions instead. vitest is pinned to 4.1.4 for the same npm bug.

## Deployment (Vercel)

- Team `hartmann-planning`, project `revenue-management-tool` (`prj_eSkXcF2qiq36C9UbmCjLt8GIxnRP`), production = `main` → https://revenue-management-tool-two.vercel.app (functions in `syd1`, Node 22.x). The project was created before the repo had code, so its framework preset had to be set to Next.js by hand — a build that ends "No Output Directory named 'public'" means the preset was lost.
- Env vars (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key). They are inlined at BUILD time — changing one needs a redeploy.
- Vercel Authentication protects preview and per-deployment URLs (team members only); the production domain is public and relies on the app's own login.

## Database workflow

- Single Supabase project (no separate dev DB yet). Migrations in `supabase/migrations/NNN_name.sql`; `migrate-prod.yml` runs `supabase db push` on pushes to main touching migrations (needs the `PROD_SUPABASE_DB_URL` secret).
- When applying a migration by hand via MCP `apply_migration`, re-file its history row to the file's version (`update supabase_migrations.schema_migrations set version = 'NNN', created_by = null where name = '...'`) or `db push` refuses to run. 001–004 are filed that way.
- A migration that creates a public table must enable RLS with firm-scoped policies.

## Testing

- `npm run typecheck`, `npm test` (vitest), and `npm run build` when adding/changing a route file.
- Next 15: page `params` are Promises (client pages use `useParams()`); pages using `useSearchParams()` need a `<Suspense>` wrapper.
- E2E was verified with Playwright against the live project using a throwaway firm + invited test user (created via SQL into auth.users/auth.identities), then deleted. Delete statements through the app (or Storage API) — storage.objects rows can't be deleted with SQL.

## Colour scheme

Tailwind `brand` (#0D8585 teal; `brand-light` #E0F2F1), `accent` #2E75B6, `row` #F5F7FA, `negative` #DC2626, `page` #EEF2F7.
