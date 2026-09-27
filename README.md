# Ledgr: financial command center

Sales, profit, cash and stock for a Nigerian trading business, in one calm place.
*Complexity in the engine. Simplicity in the interface.*

**Status:** Phase 3 of 5 complete (core engine, data entry, full dashboard, statements, production, all 11 reports with PDF/Excel/CSV export, sales analytics, budgets). See `PLAN.md` for the roadmap and `DECISIONS.md` for every choice made along the way.

---

## Run it locally (about 5 minutes)

You need Node 20+ and PostgreSQL 15+ (Postgres 16 is used here).

```bash
npm install

# 1. Start Postgres on port 54322 (any Postgres works; this matches the defaults)
initdb -D ./.pgdata -U postgres --auth=trust
pg_ctl -D ./.pgdata -o "-p 54322" -l ./.pgdata/log.txt start

# 2. Create the database with 12 weeks of sample data (Tropic Press Juices, Abuja)
npm run seed

# 3. Start the app
npm run dev          # → http://localhost:3000
```

Sign in with **demo@ledgr.ng** / **ledgr-demo**, or create a new account to go through onboarding from scratch.

### Environment variables (`.env.local`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection the app uses (queries run as role `authenticated` with Row Level Security) |
| `AUTH_DATABASE_URL` | Local-dev sign-in only (reads `auth.users`). Replaced by Supabase Auth in production |
| `SESSION_SECRET` | Signs the local-dev session cookie. Use a long random string |

## Tests

```bash
npm test             # 54 unit + database tests: 18 golden financial tests (exact kobo), roles, invitations, alerts, stock adjustments
npm run test:e2e     # 8 Playwright flows (needs `npm run dev`): sign-up → onboarding → sale → dashboard; void; production; budgets; invitation; stock write-off; keyboard; labels
npm run check:seed   # weekly P&L of the sample data + stock/COGS reconciliation (must print ✓ MATCH)
npm run verify       # recomputes every dashboard figure from raw tables with independent SQL (must all match)
npm run verify:reports  # 39 cross-checks: reports vs each other, vs the dashboard, and vs their PDF/Excel/CSV files (needs npm run dev)
npm run verify:lists    # search, filters, date range, sort and paging on every list really filter and sort (needs npm run dev)
npm run audit           # accessibility (axe, WCAG AA), phone overflow, tap targets and speed on 32 screens × 4 modes (needs npm start on port 3001)
npm run verify:roles    # signs in as each role, opens every page: right access, right redirects, no errors, no cost leaks (needs npm run dev)
npm run export:all      # downloads every report in every format to /tmp/reports (needs npm run dev)
```

## Project structure

```
supabase/
  local/000_supabase_shim.sql   local only: the bits of Supabase we rely on (roles, auth.users, auth.uid())
  migrations/0001_schema.sql    tables, constraints, indexes
  migrations/0002_security.sql  Row Level Security, audit trail, no-delete and immutability triggers
  migrations/0003_posting.sql   the ONLY way money/stock changes: post_sale, post_purchase, post_production,
                                post_return, record_payment, create_expense, void_document … (FIFO lives here)
  migrations/0004_reports.sql   read functions: fin_pnl, fin_cash_accounts, fin_receivables, fin_inventory …
  migrations/0005–0006          statements, analytics, budgets
  migrations/0007_control.sql   team + invitations, cost-free sale view, stock adjustments, alerts storage
  migrations/0008_settings_alerts.sql  settings function, category archiving, alert privacy, audit viewer
  migrations/0009_polish.sql    indexes for the Phase 4 screens
src/lib/permissions.ts          what each role can do + which areas need which permission
src/lib/finance/alerts.ts       the alerts engine (pure, unit tested)
src/middleware.ts               passes the request path to the central permission check
src/lib/server/list.ts          shared list handling (search, filters, date range, sort, paging)
src/components/ui/skeleton.tsx  loading placeholders shaped like each page
QUALITY.md                      the final quality checklist, with the check that proves each item
src/lib/finance/                pure TypeScript engine: money (kobo), periods, P&L, comparisons, break-even, accruals
src/lib/server/                 session, database access, dashboard loader, list queries
src/app/actions/                server actions (thin: validate with Zod → call a posting function)
src/app/(app)/                  dashboard (+ sales-staff home), sales, inventory, expenses, money, reports, settings
src/app/invite/[token]/         accept an invitation
src/app/api/reports/[kind]/     report export: ?format=pdf|xlsx|csv|json
src/lib/reports/                report model + PDF / Excel / CSV renderers
src/lib/server/report-defs.ts   the 11 report definitions
src/app/onboarding/             5-step setup wizard
src/components/                 design system (tokens in globals.css), sheets, inputs, metric cards, charts
tests/                          Vitest: golden financial tests + engine unit tests
e2e/                            Playwright end-to-end flows
scripts/                        db-reset, seed, check-seed, screenshots
```

## Key financial formulas

| Figure | Formula (plain English) |
|---|---|
| Net revenue | Gross sales − discounts − returns. VAT is **never** revenue |
| Cost of goods sold | What the sold units cost, oldest stock first (FIFO), including transport, customs and packaging |
| Gross profit | Net revenue − COGS (sales with unknown cost are left out and flagged, never counted as 100% profit) |
| Operating expenses | One-time expenses + each recurring cost's daily share for the period |
| Net profit | Gross profit − operating expenses + other income − other expenses (e.g. loan interest) − income tax |
| Margins | Profit ÷ revenue. Shows "—" when there's no revenue |
| Cash | Opening balance + money in − money out, per account. Transfers, loans, capital and drawings move cash, not profit |
| Customers owe you | Invoice totals − returns − payments + refunds (calculated, never stored) |
| Break-even | Monthly fixed costs ÷ gross-margin ratio |
| Month-end estimate | (Gross profit so far ÷ days elapsed × days in month) − the whole month's operating expenses. Always labelled "Estimate" |

All money is stored as whole **kobo** (`bigint`). Every split uses cumulative-floor allocation, so the parts add up to the total exactly.

## Deploying (Supabase + Vercel)

1. Create a Supabase project (region: Frankfurt `eu-central-1`).
2. Run `supabase/migrations/*.sql` in order, 0001 → 0009 (SQL editor or `supabase db push`). **Don't** run `supabase/local/`.
3. Swap the auth adapter: replace `src/app/actions/auth.ts` and `src/lib/server/session.ts` with `@supabase/ssr` (planned for when Supabase is connected; see D-18). Nothing else changes: the app already talks to Postgres exactly the way Supabase's API does (role `authenticated` plus JWT claims).
4. On Vercel, set `DATABASE_URL` to Supabase's pooled connection string (transaction mode) and a long random `SESSION_SECRET`, then deploy.
5. Before inviting real users: turn on Supabase's daily backups, and run `npm run audit` and `npm run verify:roles` against the deployed URL (`BASE=https://…`).

## Test credentials

| Email | Password | What you'll see |
|---|---|---|
| demo@ledgr.ng | ledgr-demo | Owner of *Tropic Press Juices*: 12 weeks of data, one loss week, an overdue invoice, a partial payment, returns, a missing-cost product, prepaid rent, low stock, a stock write-off, live alerts |
| accountant@ledgr.ng | ledgr-demo | Accountant (Ngozi): everything except the Business and Team settings |
| sales@ledgr.ng | ledgr-demo | Sales (Amina): her own sales home, Sales only, no costs or profit anywhere |
| viewer@ledgr.ng | ledgr-demo | Viewer (Tunde): sees all figures and reports, can't change anything |

There is also a pending invitation for driver@tropicpress.ng (Settings → Team).

## Known limitations

- Sign-in is a local stand-in until Supabase Auth is connected (passwords are bcrypt-hashed; sessions are signed httpOnly cookies).
- Invitations are shared as a link; Ledgr doesn't send email yet (D-56).
- Alerts show inside the app only (bell + dashboard); no push, SMS or email notifications yet.
- A person who belongs to several businesses sees the first one; there's no business switcher in the interface yet.
- Offline sale entry is not supported (D-17).

## Next steps

All five phases are built. Recommended next steps, in order:
1. **Go live:** connect Supabase Auth and deploy (steps above), then use it with real data for two weeks before inviting staff.
2. **Email and WhatsApp:** send invitations and alerts (daily 7am summary) by email/WhatsApp — the alert engine already produces the messages.
3. **Business switcher:** for owners with more than one business (the data model already supports it).
4. **Bank / POS import:** match Moniepoint and bank statements to recorded payments.
5. **AI assistant:** answer "what was my biggest expense last week?" from the same report functions (the JSON export is already the interface).
