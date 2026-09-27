# Branch Pulse

Multi-branch shop management system: a mobile-first PWA for branch managers (daily closing in minutes, offline-capable) and a dashboard for the owner. Built from the HLD and LLD (v1.0).

- `apps/api` - NestJS modular monolith, Prisma, PostgreSQL 16 with row-level security
- `apps/web` - Next.js 15 PWA (Tailwind, Dexie offline outbox, English + Tamil)
- `infra/` - local Postgres bootstrap (creates the non-owner `app_rw` role)

## Run locally

```bash
npm install
npm run db:up                                   # Postgres 16 + Redis (Docker)
cp apps/api/.env.example apps/api/.env
npm run db:migrate                              # applies 3 migrations
npm -w apps/api run db:seed -- --demo           # masters, roles, users + 30 days of history
npm run dev:api                                 # http://localhost:4000/api/v1
npm run dev:web                                 # http://localhost:3000
```

Seed users (password `ChangeMe@123`, dev only): `owner`, `accountant`, `stockmgr`, `manager1`..`manager6` (one per branch).

## Deploy

Production runs in Docker behind Caddy (automatic HTTPS). Step-by-step Ubuntu VPS guide: [DEPLOY.md](DEPLOY.md). Files: `docker-compose.prod.yml`, `apps/*/Dockerfile`, `infra/{Caddyfile,deploy.sh,backup.sh,postgres-init-prod.sh}`, `.env.prod.example`.

## Tests

```bash
npm test                                        # 38 unit tests (business rules, no DB)
# e2e runs against a separate DB so dev data is untouched:
docker exec <postgres-container> psql -U postgres -c "CREATE DATABASE branch_pulse_test"
docker exec <postgres-container> psql -U postgres -c "GRANT CONNECT ON DATABASE branch_pulse_test TO app_rw"
#   then run `prisma migrate deploy` and the seed with DATABASE_URL/DIRECT_URL pointing at branch_pulse_test
npm -w apps/api run test:e2e                    # 34 end-to-end tests
```

## What is implemented (HLD phases 0-1)

| Area | Status |
|---|---|
| Auth: Argon2id, lockout after 5 fails, rotating refresh cookie with replay detection, session revoke | done |
| RBAC as data + approval limits; location scope in 4 layers (guard, scoped queries, RLS, tests) | done |
| Audit log in the same transaction as every change; append-only for the app role | done |
| Locations, users, expense categories, settings, approval limits | done |
| Daily sales (split check, unusual-sales warning), cash reconciliation, denominations | done |
| Expenses: receipts (presigned, magic-byte checked), auto-approval by limit, approve/reject/cancel/reverse | done |
| Daily closing: state machine, pre-checks, locking (app + DB trigger), reopen, event log | done |
| Owner dashboard, live exception feed, closing board/detail, approvals inbox | done |
| **Daily cash reconciliation**: Opening + cash sales + other receipts − cash expenses − withdrawals = expected; count vs expected shows **Cash surplus / Cash shortage**; a difference needs a reason + manager explanation (≥10 chars) + optional photos (max 3) and goes DRAFT → *sent for approval* → approved/rejected. Managers add/update/send for their own branch (`/b/cash`, step 1 of the closing); the owner sees all branches (`/cash`), approves/rejects, and opens the **Cash variance report** with CSV | done (`/cash/overview`, `/cash/variance-report`, `/cash/reconciliation/*`, `/cash/transactions/*`) |
| **Inventory / stock management**: item list (milk, tea, coffee, sugar, ginger, cardamom, oil, snacks, cups, glasses, packaging, bottles, other raw materials; owner adds more), **daily reconciliation per item = opening + purchases + transfers in - transfers out - consumption - wastage = expected closing**, consumption entry, physical count with **shortage / excess** (reason + explanation for significant differences, owner approval, books corrected on approval), wastage with approval (stock reduced on entry, given back if rejected), stock transfers (request, approve, send, receive with lost-in-transit), stock variance report with CSV; owner **Inventory** menu and manager **Stock** tab (offline wastage) | done (`/stock/reconciliation`, `/stock/consumption`, `/stock/counts`, `/stock/variance-report`, `/wastage`, `/transfers`, `/items`) |
| **Supplier management**: profile (name, contact number, address, payment terms, GSTIN, **items supplied**, opening balance) with **total purchases, total paid and outstanding** (opening + purchases - paid = outstanding); items supplied are also learned from approved purchases; **reports**: supplier outstanding, due payments (overdue / 7 days / later / on account, per supplier and per purchase), supplier-wise purchases, purchase history, payment history, all with CSV; owner **Purchases > Suppliers / Supplier reports** and a profile page per supplier | done (`/suppliers`, `/suppliers/:id`, `/suppliers/dues`, `/suppliers/payments`) |
| **Purchase management** (no billing): purchase date, branch / central warehouse, supplier, items with quantity / unit / rate, total, payment mode, paid amount, credit amount, due date, invoice photo, remarks; cash, credit and part-payment purchases; **stock is updated on approval** (weighted-average cost, other charges and discount spread into cost); supplier ledger with **outstanding balance**, overdue / due-soon, statement, part and full payments (oldest dues first), reversals; owner **Purchases** menu (overview, ledger, suppliers, stock) and manager **Stock** tab, offline-capable | done (`/purchases`, `/suppliers`, `/stock`) |
| **Expense management**: configurable categories + sub-categories (owner: Expenses > Categories; the 17 default categories are seeded), entry with date, branch, category, sub-category, amount, payment mode, supplier/payee, description, receipt photo, entered by, approved by, approval status; owner **Expenses** menu with Overview (daily / weekly / monthly, branch-wise, category-wise incl. sub-categories, trend, payment modes, vs previous period), full ledger with filters, approve/reject, receipt view and CSV | done (`/expenses`, `/expenses/summary`, `/expense-categories`) |
| Branch management (owner menu **Branches**): add/edit, unique immutable branch IDs (configurable prefix), activate/deactivate, assign/move manager (or create one), opening cash, rent, owner-entered branch expenses, per-branch history, per-branch report with CSV | done (`/locations/*`, `/locations/:id/report`) |
| Dashboard charts (8): daily sales trend, branch sales, expense categories, monthly sales/expenses, branch profitability, stock consumption, wastage trend; period filter, table view, light/dark | done (`GET /dashboard/charts/:code`); stock consumption and wastage fill in once those modules exist (demo data via `db:seed -- --demo`) |
| Offline: outbox, exactly-once `/sync/batch`, conflicts, master bootstrap, service worker | done |
| Full LLD schema (all ~60 tables, FKs, checks, RLS, triggers) | done |

## Not yet built (schema exists, no services/UI)

Purchases and suppliers, inventory/stock ledger, transfers, stock counts, wastage, recipes, employees/attendance/salary/advances, P&L snapshots and comparison, reports + Excel/PDF export, persisted notifications with WhatsApp/email/push channels, OTP 2FA for owner/accountant, Redis/BullMQ workers (the nightly closing job uses `@nestjs/schedule`), S3 storage provider (local signed-URL provider is in place), OpenAPI generation, `Idempotency-Key` header (offline uses `clientUuid`).

## Decisions worth knowing

- Cash leaves the till when spent, so cash expenses post a `cash_transactions` row at entry (cancelled if rejected). Expected closing cash is computed from that one source, so nothing is double counted.
- A branch user cannot edit a day once it is SUBMITTED (answers the HLD open question conservatively; owner can reject to reopen editing).
- Approving a closing is refused if sales or expected cash changed after submission (`CLOSING_FIGURES_CHANGED`), and while expenses/purchases/wastage are still pending.
- Approval limits default to the LLD values (branch manager auto-approves expenses up to 500).
- Prisma cannot express generated columns or partitioned tables; those totals are computed server-side and `inventory_transactions`/`audit_logs` are not yet partitioned (HLD: only needed beyond ~10M rows).
- Tamil strings need review by a native speaker.
