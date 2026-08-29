# Guidewire BillingCenter — research notes

Gathered 2026-08-26 as the reference for the Polaris billing design
(`docs/superpowers/specs/2026-08-26-billing-design.md`). Sources are
Guidewire's public Cloud API "Consumer Guide" pages, the Guidewire glossary,
product brochures and independent explainers. Where the public documentation
is silent the note says "not documented publicly"; nothing here is invented.

## 1 · Core data model

BillingCenter is an accounts-receivable subsystem. The policy system sends
**billing instructions**; BillingCenter turns them into **charges**, slices
charges into **invoice items**, places items on **invoices** in an **invoice
stream**, collects money into **unapplied funds**, and **distributes** it.
Every money movement is a **transaction** between **T-accounts**.

| Entity | What it is | Key attributes |
|---|---|---|
| Account | Groups policies under a person or company; the unit that is billed and owns money | Must have a billing plan; delinquency plan; payment instrument (Responsive = customer pays after invoice, otherwise automatic withdrawal); billing level account or policy; one or more invoice streams and unapplied funds. Account types include list-bill and collection-agency accounts |
| Policy / Policy Period | The period is the billable term | Effective/expiry, billing method (DirectBill default, AgencyBill), payment plan, payer account (may differ from owner), return premium plan, producer codes and roles, delinquency plan |
| Producer / Producer Code | Any third party bringing business; a code ties a producer to a commission plan | Roles on a policy: primary, secondary, referrer. Agency-bill producers carry an agency-bill plan, unapplied fund and payment instrument |
| Billing Instruction | The message describing a policy transaction and its charges | Types: issuance, policy change, cancellation, reinstatement, renewal, audit, plus general account/period instructions |
| Charge | A cost tracked as one unit — premium, tax or fee | Amount, charge pattern, owner (period or account). Cancellation charges are usually negative |
| Charge Pattern | Template deciding how a charge is invoiced | Subtype: ImmediateCharge (fee), PassThroughCharge (tax, never revenue), ProRataCharge (premium, earned over time). Category: Fee, General, Premium, Tax. InvoiceTreatment: spread or single. Priority for distribution |
| Invoice Item | All or part of a charge | Down payment, installment, one-time, fee. Amount, placement date, invoice, paid amount; agency bill: gross, commission, net |
| Invoice | A dated bill of items | planned → billed → due → past due. Agency bill uses a statement per cycle |
| Invoice Stream | Schedules invoices at a periodicity from an anchor date | Policy-level billing: one per policy; account-level: one per payment interval |
| Payment Plan | How a charge becomes items | Down payment %, installment count, periodicity, fees, overrides by instruction type |
| Billing Plan | Account-level invoice timing, fees, payment requests, disbursement rules | draft/payment-due intervals, due-day logic, lead time units, low-balance suppression, invoice and reversal fees, disbursement review thresholds |
| Delinquency Plan | Reasons → workflows | Events with trigger basis, offset days, automatic flag, order |
| Commission Plan | Commissionable items, rates by role, earning point | Subplans with availability criteria and priority |
| Return Premium Plan | How negative charges apply to unpaid items | Fields not documented publicly |
| Payment Allocation Plan | Which items a payment may pay and in what order | Eligibility and ordering criteria |
| T-Account / Transaction | Double-entry ledger accounts and postings | Transaction subtypes not documented publicly |
| Unapplied Fund | Where every payment lands before distribution | One per account (account-level) or per policy (policy-level); producers have their own |

**Transaction → items.** Instruction arrives → each charge classified by its
pattern → sliced by the payment plan into items whose amounts sum exactly to
the charge → items placed on invoices in the stream by placement date.
Cancellation: negative charges settle the unpaid amount; planned items move
to a final invoice; later invoices are deleted; cancellation type flat /
pro rata / short rate. Reinstatement: charges re-sliced onto new invoices;
reinstatement fee from the delinquency plan. Renewal: a new period; payment
plan overrides may drop the down payment. Audit: one-time positive or
negative adjustment after the term.

## 2 · Payment plans

Three shapes: down payment + periodic installments (down payment a percent
of the charge, may be out of sequence); out-of-sequence first installment;
periodic only. A plan cannot have both a down payment and an
out-of-sequence first installment. Installments are identical amounts "with
minor variations for rounding adjustments" — rounding lands in one
installment. Day of month comes from the invoice stream (anchor +
periodicity), lead time from the billing plan: the plan says how many
pieces, the stream says when, the billing plan says how far ahead.

Fees are charges with a Fee pattern; the billing plan can skip installment
fees and carries invoice-fee and payment-reversal-fee defaults. Overrides
make plans behave differently per instruction type. Equity (paid service
minus provided service) produces a warning when a change would leave
coverage unpaid. Newer API previews issuance and plan changes.

**Mid-term changes re-slice.** Scope options: all items; planned only
(billed and due unchanged); not fully paid. Applied money is undistributed
to the unapplied fund first, then redistributed or left there. Exact
spreading algorithm and return-premium options are not documented publicly.

## 3 · Billing methods

| Method | Invoiced | Pays the insurer | Commission |
|---|---|---|---|
| Direct bill | Policyholder | Policyholder (responsive or automatic) | Paid separately by statement |
| Agency bill | Producer | Producer, net of commission, against a statement | Netted at source |
| List bill | A third party for a list of policies | The list-bill account | As direct bill |

Agency-bill cycles: statement bill (insurer's statement is the bill) or
account current (producer submits its own). Agency-bill plan attributes:
cycle close day, days to send statement, payment terms, promise due days,
dunning days, low-net suppression threshold, auto-clear thresholds for
gross and commission. A **payment mismatch exception** records a difference
between expected and received per item; resolutions: provide payment,
carry forward, write off (gross, commission or both), override commission.
Unidentifiable money becomes agency-bill suspense; overpayment returns by
agency-bill disbursement.

## 4 · Delinquency

Starts automatically when an invoice is past due (after grace). A plan maps
reasons — past due, not taken (first payment never made) — to workflows of
events: name, trigger basis, offset days, automatic or approval-required,
order. Typical steps: notices → late fee → message to the policy system to
cancel → reconcile received against final due → write-off → collection
agency as payer. Process record carries status, phase, reason, plan,
inception, amounts.

Holds via trouble tickets: delinquency hold (halts the workflow), invoice
sending hold, disbursement hold, charge hold (no late fees during a
dispute). Reinstatement closes the delinquency, charges the fee, records a
coverage gap. Write-off removes what the insurer does not expect to collect.

## 5 · Commissions

Plan: effective dates, tier, suspend-when-delinquent flag. Subplans: a
non-deletable default plus conditional subplans with availability criteria
(policy types, accounts, jurisdictions) and priority — highest priority
available wins. Each subplan: commissionable items, rates by role
(primary/secondary/referrer), charge-pattern and section overrides,
incentives, earning criteria ("on binding", "on invoice billing"; earning on
payment is industry-standard, typelist not public). Per-policy commission
tracks earned-retained, settled, expense, reserve, paid, written-off,
positive and negative adjustment balances — negative charges produce
clawbacks netted on the next payment. Overrides replace the rate or set a
flat amount per policy. Direct-bill commission is paid by batch with
statements; agency-bill commission is netted.

## 6 · Money movement

Every payment lands in an unapplied fund. Allocation plan eligibility:
billed or due; targeted invoice; positive only; targeted period; next
planned; past due. Ordering: recapture charges, event date, charge-pattern
priority, bill date. Leftover money stays as credit and auto-distributes at
the next billing. Suspense payments (unknown account) versus suspense items
(known account, unknown target). Reversals mark payments Reversed (error or
bank dishonour), undistribute, may charge a reversal fee and re-trigger
delinquency. Disbursements: account, collateral, suspense, agency bill;
billing plan controls delay, review thresholds, approval. Negative charges
apply per the return premium plan; a negative invoice is a credit invoice
and excess flows to unapplied then disbursement. Corrections are offsetting
charges, not edits.

## 7 · Accounting

A self-balancing double-entry core that is the A/R sub-ledger, not the GL.
Pattern subtype drives recognition: pro-rata premium written now and earned
over time; immediate fees are revenue now; pass-through taxes are a
liability. Typical GL feed: at effective date Cr written premium / Dr
receivable; periodically Dr unearned / Cr earned; receipts Dr cash / Cr
receivable; commission liabilities to AP. The transaction type list and
chart are not documented publicly.

## 8 · Operational features

Invoice streams per account or policy; billing plan fields (draft interval,
payment due interval and day logic, lead-time units, request interval,
change deadline, aggregation, statement, low-balance suppression and
carry-forward, invoice fee, reversal fee, skip installment fees, western
method, currencies, disbursement settings); holds; account-level versus
policy-level billing with transition; fees, taxes and surcharges as charges;
multi-currency off by default; batch processes (invoice, payment request,
delinquency, disbursement, agency-bill statement, producer payment,
dunning); document generation; audit trail per T-account.

## 9 · Other systems

- **Duck Creek Billing**: same model; sells low-code configuration,
  event-driven reconciliation, "billing as the financial system of record",
  immutable transaction logs.
- **Majesco**: broadest method list — direct, customer account, agency
  statement, account current, wholesale, list/payroll deduction, deductible
  billing.
- **Socotra**: each transaction's installments are immutable and sum to its
  charges; invoicing *groups* uninvoiced installments across transactions;
  cancellation consolidates uninvoiced installments; holds are first-class
  objects with a lifecycle; a real posted ledger in its data lake.
- **Origami Risk**: commissions "based on written, invoiced, and collected
  premium"; equity billing; automated cancellation controls.
- **Modern ledgers** (Modern Treasury): append-only postings, derived
  balances, reversing entries for corrections, effective-dated postings,
  idempotent ingestion.

Takeaways adopted by Polaris: immutable items per transaction (Socotra),
signed postings between accounts for every movement (Guidewire), plans as
data with per-instruction overrides (Guidewire), holds as explicit objects
(Socotra), earning basis as a plan attribute (Origami wording).

## 10 · Glossary

Account · Account current · Agency bill · Anchor date · Billing instruction ·
Billing plan · Charge · Charge pattern · Collection agency · Commission plan
and subplan · Delinquency · Delinquency plan · Direct bill · Disbursement ·
Distribution · Down payment · Dunning · Equity · Flat / pro-rata / short-rate
cancellation · Installment · Invoice · Invoice item · Invoice stream · List
bill · Not taken · Paid-through date · Payment allocation plan · Payment plan
· Payment request · Producer and producer code · Promise · Reinstatement ·
Return premium plan · Statement bill · Suspense · T-account · Trouble ticket
· Unapplied fund · Unearned premium · Write-off.

## Sources

Guidewire glossary (docs.guidewire.com/glossary/business-terms.html); Cloud
API Consumer Guide pages for charges and charge patterns, payment plans,
billing plans, invoices and invoice streams, issuing/cancelling/reinstating
policies, delinquency plans and processes, agency bill plans and cycles,
payment mismatches, unapplied funds, payment allocation plans, suspense,
disbursements, commission plans/subplans/rates, policy commissions, producer
codes, plans and multicurrency, batch processes; Olos release highlights;
the BillingCenter brochure; a trouble-ticket hold excerpt from the
Application Guide; Syntra's Guidewire-to-Oracle GL mapping; Duck Creek,
Majesco, Origami and Socotra product documentation; Modern Treasury on
ledger immutability.

## Not covered

The full transaction-type list and chart of T-accounts, return premium plan
fields, the commission earning-criteria typelist, reversal reason codes and
the complete batch roster are behind Guidewire's login. List bill and premium
reporting are evidenced only as existing.
