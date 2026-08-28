# Polaris Billing — enterprise design

## Context

Polaris has the arithmetic core of billing (three hard-coded installment
plans, invoices reconciled against the premium ledger, account-level
payments) and nothing else. `DECISIONS.md` D-016 says it plainly: "billing is
roughly a tenth of what a carrier needs." `ROADMAP.md` Stage 2 names the gap:
delinquency and non-payment cancellation, direct and agency bill, commissions,
disbursements, general-ledger export.

Dave asked for in-depth research with Guidewire BillingCenter as the
reference, then an enterprise-grade design. Three research tracks ran
(BillingCenter's model from Guidewire's public Cloud API documentation and
glossary; Canadian regulatory, tax and payments rules from FSRA, provincial
statutes, Revenu Québec, Payments Canada and RIBO; and a line-by-line map of
the current Polaris billing code). This document is the design that came out
of them. Decisions Dave took on the way:

1. **Foundation: a double-entry ledger.** Every money event is a balanced
   posting. Invoices and balances are views over the ledger, never edited.
2. **Collection: real rails, stubbed bank.** Payment instruments, scheduled
   pre-authorized debits, the Canadian bank file, returns and reversals are
   modelled properly; the bank/card connection is a pluggable adapter with a
   simulated one for now. No new runtime dependency.
3. **Both direct bill and agency bill in the first pass**, with producers and
   commissions.
4. **Migrations.** This is the last destructive schema change; from here,
   numbered migrations keep data.

The benchmark is BillingCenter's capability. The distinguishing choices are
Canadian rules as configuration, an append-only ledger from day one, and no
per-carrier customization framework.

---

## 1 · What the research established

### From BillingCenter (the shape to match)

- A policy transaction arrives as a **billing instruction** carrying
  **charges** (premium, tax, fee). Each charge has a **charge pattern**
  (pro-rata premium / immediate fee / pass-through tax; category; single or
  spread invoicing; distribution priority). This is the configuration seam: a
  new fee or tax is a new pattern, not code.
- A **payment plan** slices a charge into **invoice items** (down payment +
  installments); an **invoice stream** (anchor date + periodicity) decides
  *when* invoices fall; a **billing plan** decides how far ahead an invoice
  is sent, due-day logic, fees, disbursement rules.
- Every payment lands in an **unapplied fund** first and is **distributed**
  to items by a **payment allocation plan** (eligibility + ordering).
  **Suspense** holds money that cannot yet be matched.
- Mid-term changes **re-slice** charges into new items; money already
  applied is un-distributed and re-applied. Negative charges follow a
  **return premium plan**. Nothing is edited; new items offset old ones.
- **Delinquency plans** map reasons (past due, not taken) to dated
  workflows (notice → fee → cancel → write-off → collection agency).
  **Holds** (trouble tickets) stop delinquency, invoicing or disbursement.
- **Direct bill** (insurer bills the insured, pays commission) versus
  **agency bill** (producer bills, remits net of commission on a statement
  per **cycle**; **payment mismatch** exceptions; **write-off** thresholds)
  versus **list bill** (a third party is billed for many policies).
- **Commission plans** with subplans (availability criteria, priority),
  rates by role (primary/secondary/referrer), earning basis (bound /
  billed / collected), reserves, clawback on cancellation, statements.
- A **double-entry T-account core** feeds the general ledger; written
  premium at effective date, earned pro-rata over time.
- Modern alternative (Socotra): installments are immutable per transaction,
  invoices are a *grouping* of uninvoiced installments. Polaris adopts this:
  it is the ledger-as-truth expression of the same idea.

### From Canada (the rules to encode as configuration)

| Rule | Ontario auto (OAP 1 / O. Reg. 777/93) | Ontario property & most provinces (Stat. Cond. 5) |
|---|---|---|
| Non-payment cancellation notice | **30 days registered mail** (clock: 2nd day after mailing) / **10 days** personal, courier or electronic (with consent) | 15 days registered mail (clock: day after receipt at post office) / 5 days personal |
| Cure right | Pay arrears **plus admin fee** by noon the business day before the last day; cancellation at 12:01 a.m. last day | Contractual, not statutory |
| Repeat non-payment | After **two** notices in a term, the next allows 15/5 with **no reinstatement right** | — |
| Refund basis | Insurer cancels (incl. non-payment): **pro rata**. Insured cancels: **short rate** (filed table) | Same |
| Installment fee | **Capped 1.3%** of premium (12-month term), blended | Unregulated; ~3% typical |
| Consumer fees | **Every fee must be filed with FSRA** — NSF, reinstatement, admin | Contractual |
| Renewal notice | ≥30 days before expiry | — |

Quebec: notice runs from **receipt**, refund day-by-day, tax on premiums 9%
(9.975% from 1 Jan 2027, **by payment date**). Nova Scotia auto: 30-day
registered like Ontario. Alberta: 15 days "recorded mail" from delivery.

**Retail sales tax on the invoice** (never confused with insurer-paid premium
tax): Ontario 8% RST on property, **auto exempt**; Quebec 9% all lines;
Manitoba 7% (auto exempt); Saskatchewan 6% all lines; Newfoundland 15%
commercial only. Tax applies per installment when paid, not to installment
or NSF fees, refunds proportionally with premium, and must be a separate
line.

**Payments:** PAD under Payments Canada Rule H1 — agreement with mandatory
contents, 10-calendar-day pre-notification of amount/date (waivable in the
agreement, then 5-day post-confirmation), one NSF re-presentment within 30
days for the same amount, 90-day dispute window, return reason codes (901
NSF, 902 not found, 903 stopped…). Cards: surcharge ≤2.4% outside Quebec,
store tokens only. Cheques hold 4–8 days; e-Transfer for refunds; EFT for
producers.

**Brokers:** independent brokers dominate; personal lines are **direct
bill** (auto commission ~7.5–12.5%, property ~15–20%); agency bill remits
net 30–60 days after month end; RIBO trust rules mean the statement must show
tax separately; premium finance companies take an assignment of unearned
premium and cancel under power of attorney — return premium goes to them.

**Accounting:** written / earned / unearned; IFRS 17 PAA wants cash received
by contract as well; OSFI P&C-1 wants written premium by province and class
and broker receivables; ageing 0–30/31–60/61–90/90+.

### From the current code (what changes)

Sound and kept: `packages/domain` purity, integer cents, `proration.ts`,
the idea that job types never edit invoices (D-006), accounts as the
customer of record (D-008), claims money separate (D-017).

Replaced: mutable `invoices` rows; `spreadDelta` as the only reshaping rule;
the hard-coded `InstallmentPlan` union; `payments` without status; unapplied
cash that is computed and discarded; `DAYS_UNTIL_DUE = 14`.

Absent and built here: fees, taxes, line items, down payments, plan
configuration, delinquency, notices, holds, instruments, payment requests,
returns, disbursements, producers, commissions, agency bill, ledger, GL
export, ageing, earned premium, a batch process, a billing audit trail,
billing roles.

---

## 2 · Architecture

```
packages/domain/src/billing/         pure: slicing, spreading, allocation, earning,
                                     delinquency dates, commission, tax, short-rate,
                                     the posting rules (event → balanced entries)
apps/api/src/billing/                services: instructions, invoicing, payments,
                                     delinquency, producers, agencyBill, ledger,
                                     disbursements, statements, billingDay (batch)
apps/api/src/repo/billing*.ts        tenant-scoped data access
apps/api/src/migrations/             numbered, forward-only
apps/api/src/routes/billing*.ts      /api/billing/**, /api/producers/**
apps/web/src/routes/billing/         screens
```

Three invariants replace today's billing invariant (4):

- **Ledger balance.** Every journal entry's debits equal its credits. The
  ledger is append-only; a correction is a reversing entry with a reason.
- **Charge coverage.** For every charge, `sum(invoice item amounts) ===
  charge amount`, and items are never edited; a re-slice writes offsetting
  items.
- **Receivable truth.** An account's balance is the receivable ledger
  balance, which equals `sum(item amount − item paid)` over its items. Both
  are computed; if they ever differ a test fails.

The policy pillar's `transactions` table stays as written premium of record.
Billing consumes it: issuing a job produces a **billing instruction** from
the transaction, exactly as PolicyCenter → BillingCenter.

A single **billing day** process (`runBillingDay(db, tenant, date)`) does
everything time-driven: bills planned invoices, creates payment requests,
writes the PAD file, advances delinquencies, recognises earned premium,
closes agency-bill cycles, accrues and pays commission, and queues
disbursements. It runs on a timer once a day and on demand
(`POST /api/billing/run`, admin/finance), is idempotent per date, and
records each run. Single-process today (SQLite); the run is written so a
database lock makes it multi-process safe later.

---

## 3 · Data model (schema v5, via migrations)

All tables carry `tenant_id`; money is integer cents; dates are ISO strings.

### Configuration (data, not code)

| Table | Holds |
|---|---|
| `charge_patterns` | code, name, kind `prorata\|immediate\|passthrough`, category `premium\|tax\|fee\|other`, invoicing `spread\|single`, priority, commissionable, taxable, `filing_reference` (Ontario auto fees must cite it) |
| `payment_plans` | code, name, down payment (percent or cents), installment count, periodicity `monthly\|quarterly\|annual\|custom`, first-installment rule, installment fee pattern + amount/percent (Ontario auto: capped at 1.3% — the plan carries the cap and a test enforces it), overrides by instruction type (e.g. renewal: no down payment), `products` and `provinces` it is offered for |
| `billing_plans` | invoice lead days, due-day logic (exact / next business day), payment-request lead days, PAD pre-notification days and whether waivable, low-balance carry-forward threshold, invoice fee, returned-payment fee pattern, disbursement rules (delay days, review threshold, auto-approve limit) |
| `delinquency_plans` | reason `pastDue\|notTaken\|returnedPayment` → ordered events: `{ event, basis, offsetDays, automatic, fee_pattern? }`; grace days; write-off threshold. The Ontario auto plan encodes 30/10-day notices, cure deadline, admin fee, the two-notice counter, 15/5 thereafter; the Stat. Cond. 5 plan encodes 15/5 |
| `commission_plans` / `commission_subplans` | effective dates, tier; subplan availability (products, provinces), priority; rates by role and by charge pattern; earning basis `bound\|billed\|collected`; new vs renewal rates; clawback on cancellation |
| `agency_bill_plans` | cycle close day, statement send lag, payment terms, dunning days, low-net suppression, auto-clear thresholds for gross and commission |
| `tax_rates` | province, line of business, rate (basis points), effective from/to, `applies_on` `paid\|billed` (Quebec is by payment date) |
| `short_rate_tables` | province/product, days elapsed → retained percent |
| `notice_rules` | province, product, reason, delivery method → notice days and clock rule (`mailing+2`, `postOfficeReceipt+1`, `delivery`, `receipt`) |
| `allocation_rules` | eligibility and ordering for distributing unapplied cash (defaults mirror BillingCenter's: billed-or-due, positive, targeted invoice/policy; order recapture → event date → pattern priority → bill date) |

Plans ship as tenant-scoped rows created by migration from a
`packages/domain/src/billing/defaultPlans.ts` catalogue (Ontario auto,
Ontario property, Quebec, generic Stat. Cond. 5). Product definitions gain
`billing: { chargePatterns, defaultPaymentPlan, taxLine, feeCodes }`.

### Ledger

| Table | Holds |
|---|---|
| `ledger_accounts` | chart: `1100 premium receivable`, `1150 producer receivable`, `1200 cash clearing` (by method), `2100 unapplied cash`, `2200 unearned premium`, `2300 tax payable` (by province), `2400 commission payable`, `2500 suspense`, `2600 disbursement payable`, `4100 earned premium`, `4200 fee income`, `5100 commission expense`, `5200 write-offs`. Seeded; a tenant may map codes to its own GL codes (`gl_code`) |
| `journal_entries` | id, tenant, `posted_at`, `effective_date`, event type, reference (charge / payment / disbursement / commission id), actor, reversal_of, reason |
| `journal_lines` | entry, account, `dimension` (policy, account, producer, province, payer), debit or credit cents |

Every service writes through one function, `post(db, ctx, entry)`, which
refuses an unbalanced entry. Balances are `SUM` over lines by account and
dimension, indexed.

### Billing records

| Table | Holds |
|---|---|
| `billing_accounts` | extends `accounts`: billing level `account\|policy`, billing plan, delinquency plan, default invoice stream, payer type, currency (CAD only for now), holds |
| `payers` | who pays: `policyholder\|producer\|financeCompany\|listBill\|collectionAgency`, name, assignment-of-unearned-premium flag, notice recipient |
| `billing_instructions` | from a policy transaction: type `newBusiness\|change\|cancellation\|reinstatement\|renewal\|audit\|adjustment`, policy version, transaction id, payment plan, billing method `direct\|agency`, producer codes/roles, status |
| `charges` | instruction, pattern, amount (signed), effective date, coverage/line, province (for tax), `commissionable_cents` |
| `invoice_items` | charge, kind `downPayment\|installment\|oneTime\|fee\|tax`, amount (signed), `event_date`, invoice (nullable until billed), paid cents (derived, cached), `offsets_item_id` for re-slices; **immutable** |
| `invoice_streams` | account, anchor day, periodicity, bill-date vs due-date basis |
| `invoices` | stream, number, bill date, due date, status `planned\|billed\|due\|pastDue\|paid\|void`, totals cached; lines are the items placed on it |
| `payment_instruments` | account or producer, type `pad\|card\|eft`, masked details, token/reference, PAD agreement date, channel, pre-notification waiver, status |
| `payment_requests` | instrument, invoice, amount, scheduled date, pre-notified at, status `scheduled\|sent\|settled\|returned\|cancelled`, bank file batch, return code |
| `payments` | receipt: payer, method, instrument, amount, received date, status `pending\|cleared\|returned\|reversed`, reference, batch, created_by |
| `payment_applications` | payment → item, amount, and `reversed_by` |
| `bank_files` | outbound PAD/EFT file: kind, created, records, control totals, content hash; inbound return files |
| `disbursements` | account or producer, amount, method, payee, status `requested\|approved\|issued\|voided`, requested_by, approved_by, reason |
| `write_offs` | account/item/producer, amount, reason, approved_by |
| `holds` | on account, policy or producer: kind `delinquency\|invoicing\|disbursement\|charge`, reason, from/until, created_by |
| `delinquencies` | account/policy, reason, plan, inception, status, phase, current event, next action date, notice counter for the term |
| `notices` | delinquency, kind, delivery method, sent date, presumed receipt, effective date, cure deadline, arrears + fee, `document_html`, tracking reference |
| `earning_snapshots` | per policy version per month: written, earned to date, unearned — the numbers the finance team wants without re-deriving |
| `billing_events` | audit trail of everything above — same shape as `job_events` |

### Producers and agency bill

| Table | Holds |
|---|---|
| `producers` | broker/agency: name, licence, province, contact, payment instrument, agency-bill plan, commission plan, status |
| `producer_codes` | code → producer, commission plan, active |
| `policy_producers` | policy version, producer code, role `primary\|secondary\|referrer`, commission override |
| `commission_entries` | producer, policy, charge, basis, rate, earned cents, status `reserved\|earned\|payable\|paid\|clawedBack`, statement |
| `agency_cycles` | producer, period, close date, statement sent, due date, status; **statement lines** = items gross / commission / net |
| `agency_remittances` | cycle, amount, received, applied; **mismatches** with resolution `carryForward\|writeOff\|overrideCommission\|awaitPayment` |
| `producer_statements` | direct-bill commission statements: period, lines, total, paid via disbursement |

### Policy pillar changes

- New job type **`Reinstatement`** (state machine + issuance): re-slices
  charges from the reinstatement date, applies the reinstatement fee pattern,
  gap in coverage recorded on the version.
- `Cancellation` gains `reason` values `nonPayment | insuredRequest |
  underwriting | financeCompany` and `refundBasis` `proRata | shortRate`
  computed from the reason via configuration. Delinquency creates the
  non-payment cancellation job automatically and issues it on the notice
  effective date unless cured.
- `users` gains roles `billing` and `finance`. Finance approves
  disbursements over the threshold, write-offs, and runs the GL export.

### Migrations

`apps/api/src/migrations/001_baseline.ts` records the current v4 schema;
`002_billing.ts` creates every table above and **converts existing data**
(each existing invoice → one premium charge + one item; each payment →
receipt + applications + ledger postings) so Dave's book survives.
`openDb` applies pending migrations inside a transaction and stamps
`schema_migrations`; the "delete the file" error goes away. Tested by
migrating a v4 database built by the e2e fixture and asserting the three
invariants hold afterwards.

---

## 4 · How money moves (the posting rules, in `packages/domain`)

| Event | Debit | Credit |
|---|---|---|
| Premium charge billed (written) | Premium receivable (or producer receivable on agency bill) | Unearned premium |
| Tax charge billed | Receivable | Tax payable (province) |
| Fee charge billed | Receivable | Fee income |
| Earning (billing day, daily pro rata) | Unearned premium | Earned premium |
| Payment received | Cash clearing (method) | Unapplied cash |
| Distribution to items | Unapplied cash | Receivable |
| Payment returned / reversed | Unapplied cash; Receivable | Cash clearing; Unapplied cash (mirror of the original, linked by `reversal_of`) + returned-payment fee charge |
| Disbursement approved / issued | Unapplied cash → Disbursement payable → Cash | |
| Commission earned | Commission expense | Commission payable |
| Commission clawback | Commission payable | Commission expense |
| Commission paid (direct bill) | Commission payable | Cash |
| Agency remittance (net) | Cash; Commission payable | Producer receivable (gross) |
| Write-off | Write-offs | Receivable |
| Suspense in / out | Cash → Suspense → Unapplied | |

Every row above is a pure function `postingsFor(event) → JournalEntry` with a
test per event asserting balance and account choice.

### Slicing and spreading

`sliceCharge(charge, plan, stream, instructionType)` → items with event
dates. Down payment first, installments on the stream's cadence, the
rounding remainder on the **last** installment (BillingCenter practice;
today it is on the first — a test pins the change). Fee items from the
plan; tax items per premium item at the province rate in force (Quebec:
recomputed at payment date, the difference posted as an adjustment item).

`respreadOnChange(existingItems, deltaCharge, mode)` with modes `planned
only` (default: billed/due untouched), `not fully paid`, `all`. Return
premium follows the return-premium rule on the plan: reduce planned first,
then billed unpaid, then credit to unapplied cash. Existing items are never
edited: offsetting items reference the originals.

`cancellationCharges(version, date, reason, config)` → pro rata or short
rate; non-payment yields the **earned-minus-paid balance** owing, which stays
receivable and enters collection rather than becoming a refund.

### Allocation

`allocate(unappliedCents, items, rules)` mirrors BillingCenter defaults and
supports a targeted invoice or policy. Overpayment stays in unapplied cash
(a real ledger balance now, visible on the account, auto-applied when the
next invoice bills, or disbursed).

---

## 5 · Delinquency and non-payment cancellation

State machine per delinquency: `open → noticed → cureWindow → cancelled |
cured → closed`, with `writtenOff` and `collections` terminal phases.

Billing day, for each past-due invoice without a hold:
1. Start a delinquency under the account's plan (reason `pastDue`, or
   `notTaken` if the down payment never arrived, or `returnedPayment`).
2. Advance events whose date has arrived. A **notice event** creates the
   `notices` row with province rules: delivery method, sent date, presumed
   receipt, effective date, cure deadline (Ontario auto: noon the business
   day before), arrears plus the filed admin fee; renders the notice HTML
   from a template; increments the term's notice counter. Third
   non-payment in the term (Ontario auto) selects the 15/5 no-reinstatement
   path.
3. A **cancel event** creates the `Cancellation` job (`reason: nonPayment`)
   effective at the notice's effective date; the job is issued automatically
   on that date unless the delinquency was cured (payment of arrears + fee
   before the deadline cures and closes it).
4. After cancellation, the remaining balance ages; a **write-off event**
   below the threshold writes it off, above it assigns a collection agency
   payer.

Reinstatement: a `Reinstatement` job within the plan's window; fee applied;
notice counter unchanged.

Notice delivery to a premium finance company or other interested payer is a
second `notices` row. Registered-mail tracking reference is stored because
the burden of proof is the insurer's.

---

## 6 · Collection: instruments, requests, the bank

- **Instruments:** PAD (bank transit/institution/account masked; agreement
  date, channel, category `personal`, pre-notification waiver flag), card
  (processor token, last four, expiry), EFT (outbound only). Never a full
  card number or unmasked account in the database.
- **Payment requests:** billing day creates one per due installment on an
  autopay instrument, `lead days` ahead, and sends a **pre-notification**
  (recorded) when the amount or date differs from the last one and the
  waiver is not in force.
- **Bank file:** requests on a given day are written into a Payments Canada
  AFT-format debit file (CPA-005 standard 1464-byte records) with control
  totals, stored in `bank_files`. The **bank adapter** interface is
  `submit(file) / fetchReturns(since)`; the shipped adapter is `simulated`
  (settles after N days, returns a request when the instrument is marked
  to fail, for tests and demos). A real adapter later is one class.
- **Settlement and returns:** settled requests become `payments` in status
  `cleared`; a return creates a reversal entry, un-applies, charges the
  returned-payment fee pattern, opens a `returnedPayment` delinquency, and
  schedules **one** re-presentment within 30 days for the same amount if the
  plan says so.
- **Cards:** same request/settlement shape through the adapter; surcharge
  configurable per province, off in Quebec.
- **Manual receipts:** cheque, cash, e-Transfer keyed by a person
  (`created_by` recorded), optionally targeted at an invoice or policy;
  cheques clear after the hold days on the billing plan.
- **Disbursements:** a credit balance can be refunded to the payer of
  record (finance company if assignment is on file): `requested` by
  billing, `approved` by finance above the threshold (auto-approved below),
  `issued` as an EFT record in the outbound file or a cheque record.

---

## 7 · Producers, commissions, agency bill

- **Producers and codes** replace the free-text `accounts.producer_code`.
  A policy version carries producer roles; commission is computed per
  charge from the applicable subplan.
- **Earning basis** is a plan attribute (`bound` / `billed` / `collected`).
  Entries move `reserved → earned → payable → paid`; a negative charge
  produces a clawback entry netted on the next statement.
- **Direct bill:** monthly producer statement on billing day (period lines,
  clawbacks, total), paid by disbursement to the producer's EFT instrument.
- **Agency bill:** billing method per policy. Items carry gross, commission
  and net; the receivable is on the producer. Billing day closes the
  **cycle** on the plan's day, generates the statement (with tax shown
  separately for RIBO trust purposes), tracks dunning dates; a
  **remittance** is matched item by item; mismatches are recorded with a
  resolution (carry forward, write off within auto-clear thresholds,
  override commission, await payment). Producer overpayment is an
  agency-bill disbursement.
- **List bill** is designed (a `listBill` payer with approved plans) and
  scheduled after agency bill; not built in the first pass.

---

## 8 · Finance outputs

- **Earned premium:** billing day posts daily earning; `earning_snapshots`
  per policy version per month give written / earned / unearned.
- **GL export:** `GET /api/billing/gl?from&to` returns journal lines with
  tenant GL codes as JSON and CSV, plus a trial balance; the export marks
  lines exported so re-runs are idempotent.
- **Receivables ageing:** 0–30 / 31–60 / 61–90 / 90+ by payer type
  (policyholder, producer, finance company).
- **Tax remittance:** tax payable by province by period, on the province's
  basis (paid or billed).
- **Regulatory feed:** written premium by province and class for the
  period, and producer balances — the inputs to OSFI P&C-1 pages 93.30 and
  50.20, as CSV.
- **Cash by contract** (IFRS 17 PAA): premiums received per policy version
  with dates, as CSV.

---

## 9 · API

All under `/api`, tenant-scoped through `authenticated(db)`; roles in
brackets.

```
Billing on accounts and policies
GET  /accounts/:id/billing                 statement view: balance, unapplied, ageing, invoices, items, payments, instruments, holds, delinquency
GET  /policies/:id/billing                 schedule, plan, earned/unearned, producer roles
POST /policies/:id/billing/plan            change payment plan mid-term (re-slice)        [csr, billing]
GET  /invoices/:id                         line items, postings
GET  /invoices/:id/document                printable HTML
Payments
POST /accounts/:id/payments                manual receipt (optionally targeted)          [csr, billing]
POST /payments/:id/reverse                 reversal with reason (NSF, error)             [billing, finance]
POST /accounts/:id/instruments             add PAD/card/EFT                              [csr, billing]
POST /instruments/:id/revoke
POST /accounts/:id/disbursements           request refund of credit                      [billing]
POST /disbursements/:id/approve|void                                                     [finance, admin]
POST /accounts/:id/holds, POST /holds/:id/release                                        [billing, finance]
Delinquency
GET  /billing/delinquencies                worklist                                       [billing, csr]
GET  /delinquencies/:id                    events, notices, cure deadline
POST /delinquencies/:id/cure|hold|writeOff|sendToCollections                              [billing, finance]
GET  /notices/:id/document
Producers
GET/POST /producers, /producers/:id, /producers/:id/codes                                 [billing, admin]
GET  /producers/:id/statements, /producers/:id/commission
GET  /agency-cycles, /agency-cycles/:id     statement lines, mismatches
POST /agency-cycles/:id/remittance          record and match a remittance                 [billing]
POST /agency-mismatches/:id/resolve                                                      [billing, finance]
Finance
POST /billing/run?date=                     run the billing day                           [finance, admin]
GET  /billing/runs                          history
GET  /billing/gl, /billing/ageing, /billing/tax, /billing/regulatory, /billing/cash-by-contract   [finance, admin]
GET  /billing/bank-files, /billing/bank-files/:id/content
POST /billing/bank-files/:id/returns        simulated adapter: post a return              [finance, admin]
Configuration (read now, edit later)
GET  /billing/plans                         every plan table for the tenant               [admin, finance]
```

Router note: literal segments (`/billing/run`) register before `/:id`
patterns, as with `/claims/queues`.

---

## 10 · Screens (`apps/web/src/routes/billing/`)

Following `DESIGN.md`: status carries a word, money in tabular figures, no
cards inside cards.

- **Account › Billing** (rebuilt): balance and unapplied credit, ageing
  strip, invoices with line items, payments with status, instruments,
  holds, delinquency banner with the cure deadline, actions (record payment,
  add instrument, request refund, place hold).
- **Policy › Billing** (rebuilt): schedule of items by invoice, plan with
  change action, earned/unearned, producer roles and commission.
- **Invoice**: line items, postings, printable view.
- **Delinquency worklist**: by next action date; notice preview.
- **Producers**: list, producer detail (codes, plan, statements, balance),
  agency-bill cycle detail with mismatch resolution.
- **Finance**: billing-day runs, GL export, ageing, tax, regulatory feed,
  bank files with a "simulate return" control.
- **Submission wizard**: payment-plan step reads plans from the API
  (down payment, fee, tax shown); PAD agreement capture with the Rule H1
  mandatory contents and the pre-notification waiver.

---

## 11 · Build order

Deliberately phased so each lands with green checks and something visible.
Recommended as **five pull requests** in this order (Dave chose one PR for
claims; this is at least three times larger, and a wrong turn in the ledger
must be caught before delinquency is built on it — flagged for his
decision):

1. **Ledger, migrations, charges and plans.** Migrations framework and the
   v4→v5 conversion; ledger, posting rules, charge patterns, payment plans
   with down payments, fees, taxes, immutable items, invoice streams, the
   rebuilt Account/Policy billing screens, billing day skeleton (invoice
   billing + earning). Existing tests updated to the new invariants.
2. **Collection.** Instruments, payment requests, bank file, simulated
   adapter, returns and reversals, unapplied cash, allocation rules,
   disbursements with approval, holds, billing roles.
3. **Delinquency.** Plans with the Ontario auto and Stat. Cond. 5
   workflows, notices with province clock rules, cure, automatic
   non-payment cancellation through the state machine, reinstatement job
   type, write-off and collections, worklist.
4. **Producers and agency bill.** Producers, codes, commission plans and
   entries, direct-bill statements and payment, agency-bill cycles,
   statements, remittance matching, mismatches, write-off thresholds.
5. **Finance.** GL export, ageing, tax remittance, regulatory and IFRS 17
   feeds, finance screens, documentation (DECISIONS, ROADMAP, README,
   CLAUDE invariants).

---

## 12 · Tests (the contract)

Domain, one file per module: posting rules balance for every event;
slicing sums to the charge with the remainder on the last installment and
the Ontario 1.3% cap enforced; re-spread never edits an item; short-rate
and pro-rata by reason; Quebec tax by payment date; allocation ordering;
delinquency dates for each province clock rule and the two-notice counter;
commission by basis and clawback; agency net = gross − commission.

API: the three invariants asserted after every scenario; migration of a
seeded v4 database; the full non-payment path (miss → notice → cure vs
cancel → reinstate); PAD request → file → settlement → return →
re-presentment; disbursement authority; agency cycle close → remittance →
mismatch resolution; GL export balances to a trial balance; every billing
route in `tenancy.test.ts`; role guards.

Browser: a third e2e, `billing.mjs`: a monthly PAD policy is issued, the
billing day is run, the bank file exists, a return is simulated, the
delinquency notice appears with the correct cure deadline, arrears are paid,
the delinquency clears; a broker's statement shows the commission.

---

## 13 · Verification

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e
```

By hand, against the empty-start database: issue a monthly policy and check
the schedule shows down payment, installment fee and (for a home policy) 8%
RST as separate lines; run the billing day and read the bank file; simulate
an NSF and read the notice; let the cure deadline pass and confirm the
policy cancels through the state machine; add a producer and read the
statement; export the GL and confirm debits equal credits. Screenshots of
every new screen at 375px and 1440px, read.

---

## 14 · Risks and the honest remainder

- **Size.** This is the largest pillar; five PRs over several sessions.
- **Ontario auto fee filing** is modelled (patterns carry a filing
  reference) but Polaris cannot verify a filing exists — the carrier must.
  The rate disclaimer extends to fees and taxes: illustrative until a
  carrier's filed values are loaded.
- **Unverified specifics** from the research: Reg. 664's section number
  for the 1.3% cap, Rule H1's full return-code table, Manitoba's home
  treatment, NB/PEI/NL auto notice periods, Quebec broker collector rules.
  Each is configuration, so a correction is a data change.
- **Not built in the first pass:** list bill; premium audits / pay-as-you-go;
  multi-currency; a card processor or bank connection; PDF rendering
  (notices and invoices are HTML); a configuration UI for plans (read-only
  view; editing follows the roadmap's configuration stage); real
  document delivery (email, registered mail integration).
- **Rounding remainder moves from the first to the last installment.**
  Deliberate and pinned by test; noted because it changes visible numbers.
- **The billing day is one process.** Idempotent per date and lockable, but
  PostgreSQL and a scheduler are the production answer (D-003).
