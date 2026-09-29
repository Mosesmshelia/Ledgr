# DECISIONS.md

Decisions not fixed by the brief, each with a one-line reason. Anything marked **(confirm)** is waiting for Moses.

| ID | Decision | Reason |
|---|---|---|
| D-01 | Posting (sales, purchases, returns, voids) is done in Postgres plpgsql functions, not in TypeScript | Supabase-js can't run multi-statement transactions; FIFO needs row locks and all-or-nothing writes |
| D-02 | Period maths and formulas live in `/lib/finance` (TS); period sums live in SQL read functions | Fast aggregates in the DB; pure, testable formulas in TS that the future AI can call |
| D-03 | Cumulative-floor allocation for every split (accruals, discounts, landed costs, unit costs) | Parts always add up to the exact total, with no drifting kobo |
| D-04 | No separate `payments` table: payments are `cash_transactions` plus `payment_allocations` | A single cash ledger means cash can never be double counted |
| D-05 | Returned stock creates a new cost layer at the original cost (dated on the return date) | Keeps layers immutable and simple; the COGS effect is identical |
| D-06 | Recurring accruals are computed on demand, not pre-generated as rows | Editing a rent amount or end date instantly corrects every report |
| D-07 | Partial first/last months of a recurring expense are prorated by day | Fair and consistent with the daily spreading rule |
| D-08 | Sales role hides costs via column-safe views, not RLS alone | RLS filters rows, not columns |
| D-09 | System font stack, no web font | SF Pro can't be self-hosted legally; native fonts load instantly on mobile data |
| D-10 | Invoice numbers use a per-business sequence `INV-000001` | Gap-free-ish, human readable; voided invoices keep their numbers |
| D-11 | Customer payments auto-allocate to the oldest open invoices (editable) | Matches how traders think about "what's owed" |
| D-12 | v1 one-time expenses are treated as paid on entry (cash-out created) | The simplest flow; "unpaid bill" can come in Phase 4 if needed |
| D-13 | A sale that exceeds stock is allowed with a warning; uncovered units use standard cost (`estimated`) or `missing` | The brief says warn, don't block; numbers stay honest |
| D-14 | Supabase region: eu-central-1 (Frankfurt), when connected | Lowest practical latency to Nigeria among Supabase regions |
| D-15 | VAT off by default; when switched on: 7.5%, prices exclude VAT (both settings) ✅ confirmed | Many small traders aren't VAT-registered |
| D-16 | Name "Ledgr", accent #0071E3 ✅ confirmed | Easy to change later via design tokens |
| D-17 | Offline sale entry is not in v1 (roadmap) | Needs a sync/conflict design; worth it later given network drops |
| D-18 | Build locally first ✅ confirmed: Postgres 16 in the workspace with a small `auth` shim (`auth.users`, `auth.uid()` read from `request.jwt.claims`, the same mechanism Supabase uses). The server connects with `pg` and sets the user's claims per request, so RLS is enforced exactly as on Supabase. A dev-only login stands in for Supabase Auth. | No Docker daemon here for the Supabase CLI; this keeps the migrations, RLS and posting functions 100% Supabase-compatible, so going live = run migrations on Supabase and switch the auth adapter |
| D-19 | Seed business: an Abuja fruit-juice maker/seller ✅ confirmed; it uses production batches (fruit, sugar, bottles, labour) and also resells bought-in items | Exercises both production costing and trading |

## Added during Phase 1

| ID | Decision | Reason |
|---|---|---|
| D-20 | Units sold before stock exists ("backorders") are settled automatically, oldest first, when stock next arrives. The earlier sale gets its real FIFO cost and switches from `estimated`/`missing` to `actual` | This keeps the stock count and cost honest without the owner doing anything. Note: it can update the COGS of a past period to its true value |
| D-21 | A return marked "damaged/expired" reverses the revenue but keeps the cost as COGS (a loss). A "back to stock" return reverses both and creates a new stock layer at the original cost | This is the standard treatment: goods you can't resell are a real cost |
| D-22 | FIFO pieces use `floor(take × remaining value ÷ remaining qty)`, and the last unit of a layer takes the exact remainder. Layers track `consumed_cost` | Stock value plus cost used always equals what was paid, to the kobo, even after voids. This is proven by the reconciliation test and the seed-data check |
| D-23 | Sales whose cost is unknown are left out of profit and margin, and the figure is flagged "Incomplete" with a link to fix it | This follows the brief's rule never to treat missing cost as ₦0, while the dashboard stays useful |
| D-24 | Money displays rounded to whole naira by default; kobo shows on invoices, reports and in "How was this calculated?" | Calmer to read; still exact where it matters |
| D-25 | "Money you have" compares closing balances like-for-like (end of this period vs end of the previous comparable period) | This is consistent with Rule 13 |
| D-26 | A credit or part-paid sale needs a named customer; walk-in sales must be paid in full | Otherwise nobody can be chased for the balance |
| D-27 | Keyboard shortcuts: **N** = new sale, **E** = add expense (ignored while typing) | Speed for desktop users |
| D-28 | The period is kept in the URL (`?period=this_week`) | Shareable, and the back button works |

## Added during Phase 2

| ID | Decision | Reason |
|---|---|---|
| D-29 | The plain-English summary is built from templates, not AI. Each sentence comes from one calculated figure and is left out if that figure is missing. It never states causes or gives advice | The brief says: "Do not invent financial insights" |
| D-30 | Summary amounts use ₦4.85m style for amounts of ₦1m and over, and full figures (₦620,000) below that | This matches the brief's own examples and reads naturally |
| D-31 | Trend charts share one range control (Daily 30 days / Weekly 12 weeks / Monthly). Empty periods before the business's first activity are hidden | One control for all charts (dataviz rule); no misleading flat zeros |
| D-32 | The net-profit trend includes "other items" (loan interest, other income, tax) per day, so it matches the P&L exactly | The trend and the P&L must agree |
| D-33 | Chart colours: blue = revenue / money in / gross profit; orange = costs / money out; aqua = net profit. All three were checked with the dataviz colour-blindness validator. Every chart has a table view | Colour is never the only way to read a chart |
| D-34 | Break-even = monthly recurring fixed costs ÷ gross margin over the last 30 days | Rule 14; a trailing window smooths out one-off weeks |
| D-35 | Customer and supplier statements are calculated from the same records as receivables and payables, so the statement's closing balance always equals "owes you now" | One source of truth |
| D-36 | Stock movements carry a sequence number, so same-day movements show in their true order | A readable, correct running balance |
| D-37 | P&L statements show negatives in brackets and exact kobo (accounting convention). Dashboards use a minus sign and whole naira | Each fits its audience |
| D-38 | Reports print cleanly with navigation hidden ("Print / save PDF"). Proper PDF, CSV and Excel export is Phase 3 | Useful now, without pulling Phase 3 forward |
| D-39 | `scripts/verify-dashboard.ts` recalculates every headline figure from the raw tables with separate SQL, without the engine or the fin_* functions, and must match to the kobo | This is the independent check for high-stakes numbers |

## Added during Phase 3

| ID | Decision | Reason |
|---|---|---|
| D-40 | Each report is one definition (`report-defs.ts`) that produces a single report object. The screen, PDF, Excel, CSV and JSON are all rendered from it | Every format shows identical numbers by construction |
| D-41 | The PDF embeds the Inter font (SIL Open Font License, `assets/fonts/`). Reports with more than 7 columns switch to landscape automatically | PDF's built-in fonts have no ₦ sign; wide tables stay readable |
| D-42 | Excel exports hold real numbers with ₦ formats (brackets for negatives on statements), one sheet per section, frozen and filterable headers, plus a Summary sheet | So owners and accountants can keep calculating with them |
| D-43 | CSV exports use plain naira with 2 decimals (no ₦ or commas), UTF-8 with BOM | This opens cleanly in Excel, Google Sheets and accounting tools |
| D-44 | A JSON export (`?format=json`, kobo integers) exists for automated checks and for the future AI assistant | One machine-readable source |
| D-45 | Analytics revenue is net of returns (a return is credited to the original product, customer and salesperson), so every breakdown adds up to P&L revenue | Breakdowns never disagree with the P&L |
| D-46 | "By payment method" shows invoice totals (incl. VAT, after returns) split by the account payments went into, plus "Not paid yet" | Answers "how do my customers pay?" honestly, including credit |
| D-47 | Margins in analytics are calculated on sales with known cost only, and labelled "(excl. sales missing cost)" | Consistent with D-23; still useful when one product has no cost |
| D-48 | Budget lines: revenue, cost of goods and each operating category, per month (unique per line: `NULLS NOT DISTINCT`, which needs Postgres 15+ and is supported by Supabase). For costs, over budget is flagged; for revenue, being behind is | The brief's list, with the correct "good/bad" direction per line |
| D-49 | Unit totals are left off where units differ (e.g. kg + pcs in raw materials); only values are totalled | Adding kilograms to pieces is meaningless |
| D-50 | The separate P&L and product-profitability pages from Phase 2 were replaced by the shared report screen | Less code, identical behaviour, and export for free |
| D-51 | `scripts/verify-reports.ts` checks 39 cross-report relationships and export contents against the running app | An independent check that reports, dashboard and files agree |
| D-52 | Roles are enforced in the database (posting functions and row-level security). The interface only hides what a role can't do, using one table in `src/lib/permissions.ts` | A hidden button is never the only protection |
| D-53 | Owner and Admin can do everything; only an Owner can change or remove an owner, and a business can never lose its last owner. Accountant can record, void and configure but not manage the team. Sales can record sales, customer payments and customers only. Viewer is read-only | Matches how Nigerian SMEs actually delegate |
| D-54 | Accountant and Viewer always see costs; the "can see costs" switch applies to Sales only (off by default). Sales staff read sale lines from `v_sale_items_public`, a view with no cost columns, and are refused all report functions and exports (403) | Protects margins from staff without complicating the other roles |
| D-55 | Team changes go through functions (`create_invite`, `accept_invite`, `set_member_role`, `remove_member`); direct writes to `business_members` are blocked, even for owners | Every team change is checked and audited |
| D-56 | Invitations are a single-use link (48-character random token) tied to one email, valid 14 days, revocable. There's no email sending yet — the owner copies the link to WhatsApp/SMS/email | Works today with no email provider; Supabase's invite email can replace it later |
| D-57 | Business settings are changed only through `update_business_settings` (direct updates to `businesses` are revoked) | Stops invoice numbering being tampered with; every change is audited with a reason |
| D-58 | Categories are archived, never deleted | History keeps its labels |
| D-59 | Targets are never overwritten: a change adds a new row with a start date | Past periods are judged against the target that applied then |
| D-60 | Stock adjustments (breakage, spoilage, recount) are their own document. Stock lost is valued at FIFO cost and added to cost of goods sold; stock found needs a unit cost and lowers COGS. They can be voided (unless the found stock was already sold) | Keeps "opening + purchases − closing = COGS" true, and makes shrinkage visible |
| D-61 | Alerts are evaluated by pure TypeScript (`evaluateAlerts`, unit tested) from figures the server already computes, then stored with a stable key: one row per situation, auto-resolved when it clears, and a dismissed alert reappears only if the problem clears and comes back | No duplicate or stale alerts |
| D-62 | Alerts refresh at most every 3 minutes per business and immediately after anything is recorded. Only Owner/Admin/Accountant can refresh them (so nobody can plant a fake alert); alerts based on costs or profit are hidden from people who can't see costs | Fast pages, honest alerts, no cost leaks |
| D-63 | Default alert levels: cash below ₦200,000; any overdue invoice or bill; a category 25% above its 8-week average (and at least ₦10,000); weekly sales more than 10% behind target pace (from day 2); any budget line over; a loss last week; low stock; gross margin down 3+ points vs the previous 4 weeks; sales missing costs. All adjustable or switchable in Settings → Alerts | Sensible for a small trading business; the owner tunes them |
| D-64 | Permission checks for whole areas run centrally in `requireCtx` (the request path is passed in by middleware), because in Next.js a page renders in parallel with its layout — a layout-only guard would still let the page's queries run | One rule list, checked before any query |
| D-65 | The activity log (Settings → Activity log) shows who did what and when, with field-by-field changes and the reason. It can't be edited or deleted by anyone. More tables are now audited: targets, alert settings, budgets, customers, suppliers and categories | The audit trail the brief asks for, readable by a non-accountant |
| D-66 | Void is available everywhere a record can be reversed: sales, returns, purchases, production, expenses, payments, cash movements, transfers (both sides together) and stock adjustments. A payment made as part of an expense, return or batch is voided with that document | One consistent rule; money never disappears silently |
| D-67 | Colours were re-tuned so every text/background pair passes WCAG AA (4.5:1) in light and dark. Accent used as TEXT is #0062C4 (light) / #4AA3FF (dark); buttons keep the brand blue #0071E3 in both themes, so white button text passes. Greys and greens are one step darker | Readable in Abuja sunlight on a phone; the brand fill is unchanged |
| D-68 | Every list is driven by the URL (search, filters, date range, sort, page), with sort keys whitelisted on the server | Filtered lists can be bookmarked or shared, work before JavaScript loads, and can't be used for SQL injection |
| D-69 | Products are filtered and sorted in memory (all stock is loaded for the totals anyway); history lists (sales, purchases, expenses, money, production) are filtered in the database, 30 per page | Fast at any size |
| D-70 | Charts load as a separate download after the numbers | Halves the dashboard's JavaScript, which matters on mobile data |
| D-71 | Alerts are re-checked after a page is sent (on the dashboard: before, so the card is current); concurrent checks share one run | No page ever waits for alerts |
| D-72 | A new business gets no alerts until it records its first sale, and gets a "Get set up" checklist instead of empty charts | "Cash is low" on day one is noise; the checklist teaches the next step |
| D-73 | Page entrance animations leave no transform behind | A leftover transform silently broke fixed elements such as the sale form's total bar |
| D-74 | `cn()` resolves conflicting Tailwind classes (tailwind-merge), with Ledgr's custom text sizes registered | A "hidden" passed to a button now beats its built-in "inline-flex" |
| D-75 | Private use (`LEDGR_ACCESS=invite`): the first account on an empty database becomes the owner; after that, only people with a valid invitation can sign up or sign in to an empty account. Local development and tests default to open sign-up | A business's books are never open to the public |
| D-76 | Sign-in is refused for 15 minutes after 8 wrong passwords for the same email (tracked in `login_failures`, invisible to the API) | Stops password guessing without extra services |
| D-77 | The live site (utobyviya.vercel.app) runs the app with its own restricted database login (`ledgr_app`) that can only act as a signed-in user or call the four sign-in functions; the demo data and nightly date job were removed when it became Uto by Viya's real books | Least privilege; real data never mixes with demo data |
