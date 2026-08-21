# Roadmap

Where Polaris is going, and in what order. See `CLAUDE.md` for the objective
and an honest assessment of the ambition.

This is a sequencing document, not a schedule. It has no dates on it because
inventing dates would be fiction. What it does say is **what unlocks what**,
so work is not done in an order that has to be redone.

---

## The shape of the problem

Three pillars, and they are not independent. Billing depends on policy
transactions. Claims depends on knowing what coverage was in force on the loss
date, which depends on policy versioning. So the order is not negotiable at the
top level: policy first, then billing, then claims — with the caveat that each
pillar only needs to be *good enough* before the next one starts, not finished.

| | Policy administration | Billing | Claims |
|---|---|---|---|
| **Now** | One product, quote to issue, endorsements, renewals, cancellations, referrals | Schedules, invoices, payments, reconciliation | Nothing |
| **Needed for a first carrier** | Multi-product, effective-dated rates, documents, forms | Delinquency, non-payment cancellation, commissions | First notice of loss, reserves, claim payments |
| **Needed to compete** | Configuration without code, multi-province, portals | Agency bill, trust accounting, general ledger export | Adjuster workload, litigation, recovery, fraud flags |

---

## Stage 1 · Make the policy engine sellable to more than one carrier

The current product model can express exactly one product. That is the single
biggest thing standing between this and a real customer, because no two
carriers sell the same thing.

- **Effective-dated rate versions.** A carrier files a rate change; both the old
  and new rates must exist simultaneously and be selected by the policy's
  effective date. Today `version` and `effectiveDate` exist on the product
  definition and nothing uses them.
- **Rating expressiveness.** Separate rate groups per coverage, discounts and
  surcharges, minimum premium, rounding rules, and a defined order of
  calculation. The numbers stay illustrative; the *machinery* must be able to
  hold a real filed program. (Issues #2, #3, #4.)
- **A second product.** The proof that configuration is data rather than code.
  Habitational (home or tenant) is the natural second, because it exercises a
  different risk shape without a new regulator.
- **Documents.** Declaration page at minimum. This is the first question an
  insurance audience asks, and it currently has no answer. (Issue #10.)

**Why first:** everything else is built on the policy record. Getting the
product model wrong here means rebuilding billing and claims later.

---

## Stage 2 · Billing a carrier could actually operate

What exists is the arithmetic core, and it is sound. What is missing is
everything around it that makes billing an operational function.

- **Delinquency and non-payment cancellation.** An invoice goes unpaid, a notice
  is generated, a cancellation is scheduled, and the policy state machine acts
  on it. This is the loop that connects billing back to policy, and it is the
  most-asked-about gap.
- **Direct bill and agency bill.** Whether the carrier bills the insured or the
  broker collects and remits. Small carriers frequently need both.
- **Commissions.** Calculated, accrued, and payable to the producer.
- **Disbursements.** Refunds actually leaving, rather than sitting as a credit.
- **General ledger export.** Written premium, earned premium, receivables, in a
  form an accountant can reconcile.

**Why second:** it depends on policy transactions being correct and complete,
and it is what a carrier's finance function will interrogate hardest.

---

## Stage 3 · Claims

Untouched, and roughly the size of the policy pillar. The core model:

- **First notice of loss.** Intake against a policy, at a date, verified against
  the coverage in force *on that date* — which is exactly why immutable policy
  versions were built the way they were.
- **Claim, exposure, reserve.** A claim holds exposures (one per coverage per
  claimant); each exposure carries reserves that move over time. Reserve history
  is an audit trail, never an overwrite.
- **Payments and recovery.** Indemnity and expense payments, subrogation and
  salvage recovery.
- **Adjuster workflow.** Assignment, diary, status, and the equivalent of the
  referral guard for authority limits: an adjuster cannot pay above their limit.

**Why third:** it is the least coupled to what exists, so it is the safest thing
to defer, and it benefits most from the patterns already proven in policy — the
state machine, the append-only history, the authority guard.

---

## Running alongside: production readiness

Not a stage, because it cannot be left to the end. Each item becomes mandatory
at a specific moment, and the moment tends to arrive suddenly.

| Item | Mandatory when | Issue |
|---|---|---|
| Database migrations | Anyone has data they cannot lose | #8 |
| Real authentication and sessions | Anyone outside the team signs in | #7 |
| Pagination | Any list exceeds a few hundred rows | #6 |
| PostgreSQL instead of SQLite | More than one process needs the data | — |
| Audit of who changed what | A regulator or auditor asks | — |
| Browser test in automated checks | Now, honestly | #9 |

---

## What is deliberately not on this list

- **A rules engine, workflow designer, or configuration user interface.**
  Guidewire has these and they are enormous. Configuration as data files, edited
  by whoever implements the carrier, is sufficient for a long time.
- **Portals for brokers and policyholders.** Real demand, but they are additional
  surfaces on top of a core that is not finished.
- **Reinsurance, catastrophe modelling, actuarial reserving.** Adjacent systems,
  not core policy administration.
- **Real filed rates.** We supply the engine; the carrier supplies the rates.
  See `DECISIONS.md` D-001.
