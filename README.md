# Polaris PAS

A core insurance system for small and mid-sized Canadian property and casualty insurers:
policy administration, billing and claims. Policy administration is substantially built,
billing is a working slice, claims has not been started. See [ROADMAP.md](ROADMAP.md).

First product: **Ontario personal auto**, with a working web client.

> ⚠️ All rates, factors and underwriting rules in this repository are **illustrative samples**,
> not filed rates. Coverage codes and OPCF endorsement numbers follow public Ontario
> regulatory structure; the numbers attached to them do not.

## Requirements

**Node 24 or newer.** Not optional: the API uses `node:sqlite` and runs
TypeScript directly through Node's type stripping, neither of which exists in
Node 20. There is an `.nvmrc`, so `nvm use` picks the right version. Nothing
else is needed — no database server, no Docker, no global tooling.

The browser test (`npm run test:e2e`) additionally needs Google Chrome
installed; nothing else does.

## Running it

Two ways. **One process, as you would deploy it:**

```bash
npm ci
npm run build                # builds the web client
npm start                    # everything on http://localhost:3000
```

The server hosts the API under `/api` and the built client on every other
path, so there is nothing else to run and no CORS to configure.

**Two processes, for development** (Vite gives you hot reload):

```bash
npm ci
npm run dev:api              # terminal 1 — API on :3000
npm run dev:web              # terminal 2 — UI on :5173
```

On its very first start against an empty database, the server creates your
carrier and one sign-in per role, prints them to the console, and stops there:
**the book of business starts empty**. Everything in it is entered by a person
and saved permanently in `polaris.db` — delete that file to start over.

| Role | Username | Password |
|---|---|---|
| CSR | `csr` | `polaris` |
| Underwriter | `underwriter` | `polaris` |
| Adjuster | `adjuster` | `polaris` |
| Claims supervisor | `supervisor` | `polaris` |
| Admin | `admin` | `polaris` |

The referral queue belongs to the underwriter; a CSR can quote and bind but cannot accept a
referred risk; claim payments above an adjuster's authority wait for the supervisor. The
admin's **Team** screen creates further sign-ins and resets passwords. Setting
`POLARIS_DEMO=1` prints the default credentials under the sign-in form; without it the form
advertises nothing.

| Command | What it does |
|---|---|
| `npm test` | 246 unit and integration tests |
| `npm run test:e2e` | two browser tests (policy path, claims path) on scratch databases |
| `npm run typecheck` | both TypeScript projects |
| `npm run build:web` | production build of the client |

### Configuration

Every setting has a working default; see [.env.example](.env.example).

| Variable | Default | What it does |
|---|---|---|
| `POLARIS_DB` | `polaris.db` | SQLite file. Created on first start. |
| `POLARIS_CARRIER_NAME` | `Polaris Insurance` | Carrier created on first start. |
| `POLARIS_CARRIER_PREFIX` | `POL` | Policy/claim number prefix for that carrier. |
| `PORT` | `3000` | Port the server listens on. |
| `POLARIS_DEMO` | unset | `1` prints the demo logins on the sign-in screen. Leave unset in a real deployment. |
| `POLARIS_WEB_DIR` | `apps/web/dist` | Where the built client lives. |
| `POLARIS_SERVE_WEB` | `1` | `0` runs API-only, for when something else serves the client. |
| `POLARIS_API` | `http://localhost:3000` | Dev only: what the Vite dev server proxies `/api` to. |

### Deploying elsewhere

The whole app is one Node process and one file on disk:

```bash
git clone <this repo> && cd polaris-pas
npm ci && npm run build
PORT=8080 npm start
```

Behind a reverse proxy, forward everything to that port; the app needs no path
rewriting. To persist data across deploys, point `POLARIS_DB` at a file on a
mounted volume. There is no migration path between schema versions yet, so a
schema change means reseeding.

## First start

The product ships **empty**. On the first run against a fresh database the
server creates one carrier (name and prefix configurable, see above) and the
five default sign-ins, and nothing else — no accounts, no policies, no claims.
The invented book of business that earlier versions seeded now exists only
inside the automated tests, which build it on throwaway scratch databases.

To reset everything: stop the server, delete `polaris.db` (and its `-shm` /
`-wal` companions), and start again.

## Layout

```
packages/domain    Pure domain logic — no I/O, no framework
  product.ts         Ontario auto product definition (configuration as data)
  rating.ts          (product, risk) → quote
  uwRules.ts         Data-driven underwriting referral rules
  stateMachine.ts    Uniform job lifecycle with role and referral guards
  proration.ts       Term, mid-term delta and cancellation refund maths
  billing.ts         Installment schedules and premium re-spreading
  claims/            Coverage-in-force, claim financials, claim state machines,
                     payment authority, fraud rules

apps/api           HTTP API — node:http + node:sqlite, zero runtime dependencies
  db.ts              Schema, versioning and transactions
  repo/              Tenant-scoped data access, split by aggregate
  accounts.ts        Customers of record and their rollups
  jobs.ts            Job creation, quoting and workflow actions
  issue.ts           Issuance: policy version + transaction + billing, atomically
  billing.ts         Schedule generation, reconciliation, payments
  worklist.ts        The underwriter's queue
  claims/            FNOL, claim lifecycle, reserves, payments, recovery, diary,
                     the claims worklist
  routes/            Router, DTOs and error mapping

apps/web           React + Vite client, hand-written CSS
  styles/            Design tokens and components (see DESIGN.md)
  routes/            Worklist, accounts, account file, wizard, job, policy,
                     claims worklist, claim file, FNOL wizard
  e2e/               Browser tests: the policy path and the claims path
                     (their book of test data comes from apps/api/tests/e2eSeed.ts)
```

Project context lives in four files, and they are meant to be read before changing
anything:

| File | Answers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The objective, the invariants, conventions, what to ask before doing |
| [ROADMAP.md](ROADMAP.md) | Where this is going: policy, billing, claims, and in what order |
| [DECISIONS.md](DECISIONS.md) | Why it is shaped this way, and what was rejected |
| [PRODUCT.md](PRODUCT.md) | Who it is for and the principles behind it |
| [DESIGN.md](DESIGN.md) | The visual system |

## Core model

An **account** is the customer of record. Policies and billing hang off it, and a
submission always starts from one, so the insured is never retyped.

A **job** is the unit of work: `Submission`, `PolicyChange`, `Renewal` or `Cancellation`.
All four share one state machine:

```
Draft ──quote──▶ Quoted ──bind──▶ Bound ──issue──▶ Issued
  ▲                │  │
  └───editData─────┘  └──uwDecline──▶ Declined
        (Draft/Quoted/Bound) ──withdraw──▶ Withdrawn
```

Guards: a job whose quote carries underwriting referrals cannot be bound until an
underwriter or admin accepts it, and re-quoting invalidates a prior acceptance.

Issuing appends an immutable `policy_versions` snapshot, records a `transactions` row and
updates billing:

| Job type | Version | Transaction | Amount |
|---|---|---|---|
| Submission | v1, term 1 | NewBusiness | prorated annual premium |
| PolicyChange | v+1, same term | Endorsement | prorated delta (may be negative) |
| Renewal | v+1, term +1 | Renewal | new annual premium |
| Cancellation | v+1, same term | Cancellation | negative pro-rata refund |

Money is integer cents everywhere. Dates are ISO `YYYY-MM-DD`.

## Billing

New business and renewals lay down an installment schedule (pay in full, monthly, or
quarterly). Endorsements and cancellations move the transaction total, and reconciliation
pulls the schedule back onto it: additional premium spreads across installments nobody has
paid yet, return premium comes off the latest ones first, and anything that cannot be
absorbed becomes a credit the insurer owes.

One invariant holds for every policy, and is asserted in the tests:

```
sum(non-void invoice amounts) === sum(transaction amounts)
```

Payments are recorded against the **account**, not a policy, because one payment can settle
invoices across several. They apply to the oldest due invoice first; an overpayment is kept
as account credit rather than refused.

## Multi-tenancy

Every business row carries `tenant_id`. Tenant identity comes **only** from the caller's
API key (`Authorization: Bearer <key>` or `X-Api-Key`), never from a request body, and every
repository read is scoped by it. Account and policy number sequences are per tenant
(`ACME-A0001`, `ACME-000001`).

## API

Every path below is served under the `/api` prefix, e.g. `GET /api/worklist`.
The client owns every other path.

| Method | Path | Notes |
|---|---|---|
| GET | `/health`, `/products`, `/products/:code` | public |
| POST | `/auth/login` | `{username, password}` → `{token, user}` |
| GET | `/me` | resolves the calling user |
| GET | `/worklist` | referral queue, ready-to-bind, counts |
| GET | `/accounts?q=` | search by name, number, city or email |
| POST | `/accounts` | → 201 |
| GET | `/accounts/:id` | account, rollup, policies, jobs |
| PUT | `/accounts/:id` | |
| POST | `/accounts/:id/submissions` | new submission → 201 |
| GET | `/accounts/:id/billing` | invoices and payments across the account |
| POST | `/accounts/:id/payments` | records and applies a payment → 201 |
| GET | `/jobs?status=&accountId=` | |
| GET | `/jobs/:id` | job plus audit trail |
| PUT | `/jobs/:id/risk` | returns the job to Draft, clears the quote |
| POST | `/jobs/:id/quote` | rates and returns the quote |
| POST | `/jobs/:id/underwrite` | `{decision, note?}`, underwriter or admin only |
| POST | `/jobs/:id/bind`, `/issue`, `/withdraw` | |
| GET | `/policies?accountId=`, `/policies/:id`, `/policies/:id/billing` | |
| POST | `/policies/:id/changes`, `/renewal`, `/cancellation` | → 201 |
| GET | `/claims?status=&policyId=&accountId=&adjuster=` | with financials per claim |
| GET | `/claims/queues` | approvals, my claims, unassigned, diary, flagged |
| GET | `/claims/:id` | the whole claim file |
| POST | `/claims` | first notice of loss → 201; refused if no coverage in force |
| POST | `/claims/:id/assign`, `/close`, `/reopen`, `/notes` | claims roles |
| POST | `/claims/:id/exposures`, `/exposures/:eid/close`, `/reopen`, `/reserves` | |
| POST | `/claims/:id/payments`, `/payments/:pid/approve`, `/reject`, `/issue`, `/void` | authority-gated |
| POST | `/claims/:id/recoveries`, `/recoveries/:rid/receive`, `/close` | |
| POST | `/claims/:id/tasks`, `/tasks/:tid/complete` | diary |
| GET | `/policies/:id/coverage-at?date=` | drives the FNOL coverage step |
| GET | `/claims-users` | assignable claims staff with authority limits |
| GET | `/users` | the team, admin only |
| POST | `/users` | create a sign-in, admin only → 201 |
| POST | `/users/:id/password` | reset a password, admin only |
| GET | `/demo/credentials` | only when `POLARIS_DEMO=1` |

Errors are `{ "error": { "code", "message" } }` with `400` validation or rating, `401` auth,
`403` role, `404` not found (including cross-tenant), `409` invalid transition.

## Known gaps

Honest list of what a production system has that this does not: no product versioning by
effective date, no document generation, no delinquency or non-payment cancellation, no
external data (VIN decode, MVR, CLEAR), territory is the first letter of the postal code,
`Expired` is never set because nothing runs on a schedule, and no pagination. In claims:
no litigation tracking, no catastrophe coding, no reinsurance recovery, no claim
documents, fraud indicators are simple comparisons rather than scoring, and coverage
limits are shown but not enforced against cumulative payments.

**Authentication is a demo, not a security boundary.** Passwords are stored as scrypt
hashes with a per-user salt and the failure message does not reveal whether the username
exists, but the token handed back is the user's long-lived API key rather than an expiring
session, there is no rate limiting or lockout, no password change or reset, and the
credentials are printed on the screen. Treat it as a role switcher with a lock on it.
