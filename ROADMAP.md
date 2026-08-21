# Roadmap

Where Polaris is going, and in what order. See `CLAUDE.md` for the objective
and what enterprise scale demands of every change.

This is a sequencing document, not a schedule. What it says is **what unlocks
what**, so the fastest path to production is taken and nothing is built in an
order that forces it to be rebuilt.

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

**Why third:** it is the least coupled to what exists, and it benefits most from
the patterns already proven in policy — the state machine, the append-only
history, the authority guard. Building it after those are settled means building
it once.

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

## Later, and deliberately not now

In scope for the product, sequenced behind the three pillars. Listed so nobody
mistakes their absence for a decision against them.

- **Configuration user interface, rules engine, workflow designer.** How a
  carrier configures products without an engineer. Significant competitive
  ground, and the thing that turns each new customer from a project into a
  setup. Comes once the configuration model itself is proven by a second
  product.
- **Broker and policyholder portals.** Real demand, and the natural surface
  expansion once the core is complete.
- **Reinsurance, catastrophe exposure, actuarial reserving.** Adjacent systems
  a carrier needs. Integrate before building.
- **Real filed rates.** Never ours to supply. We build the engine; the carrier
  loads their programme. See `DECISIONS.md` D-001.
