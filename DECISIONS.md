# Decisions

Why the project is shaped the way it is. Each entry records what was chosen,
what was rejected, and the reasoning, so a later session does not quietly undo
a deliberate choice.

Add an entry whenever a decision would be expensive or confusing to reverse.
Keep entries short. Never delete one: if a decision is reversed, add a new
entry that supersedes it.

---

## D-016 · The objective is a production system, not a demonstration

**2026-08-20**

Stated by Dave when asked directly: build a production-ready core insurance
system for small and mid-sized Canadian property and casualty insurers,
covering policy administration, billing **and claims**, aiming at parity with
Guidewire InsuranceSuite, moving fast.

**Recorded because** the first session inferred a far smaller goal and built to
it. `PRODUCT.md`
had carried an invented purpose statement — that the system replaced "a
mainframe screen and a spreadsheet" — which no one had ever said. It was
written to give the interface design a point of view, and it went unchallenged
for a day. It has been replaced with the real objective. **Do not invent
rationale and leave it in a file where a later session will read it as fact.**

**Consequences:**

- Claims is a third pillar in scope and has not been started.
- Billing is roughly a tenth of what a carrier needs.
- The product model must express *any* carrier's filed rates, versioned by
  effective date. One hard-coded product is the main obstacle to a second
  customer.
- D-013 (no migrations), D-014 (demonstration sign-in) and D-003 (zero runtime
  dependencies, SQLite) are now provisional. Each has a moment where it becomes
  unacceptable, listed in `ROADMAP.md`.
- The benchmark is Guidewire InsuranceSuite, matching its capability where it
  matters and beating it where it counts. Small and mid-sized Canadian carriers
  are the beachhead, not the ceiling.

**Audience:** insurance people, technical evaluators and business buyers all
have to be convinced. None of the three can be systematically neglected.

---

## D-001 · The rate tables are invented, not actuarial

**2026-08-20**

The base rates and every factor (territory, driver class, driving record,
vehicle rate group, limit, deductible) are plausible-looking numbers chosen by
hand. They are not derived from loss experience and no filing stands behind
them.

**Why it matters:** Ontario automobile rates must be filed with and approved by
the provincial regulator before use. Presenting invented numbers as real would
be a serious misrepresentation. The `sample: true` flag, the disclaimer in
`product.ts`, the README warning and the line on the sign-in screen exist for
that reason and must stay.

**What is real:** the coverage structure (the standard Ontario policy coverages
and the OPCF endorsement numbers) and the shape of the calculation. What is
invented is the magnitude of every factor.

**Revisit when:** someone wants a credible demonstration for an insurance
audience. The next honest step is structural fidelity — separate vehicle rate
groups per coverage, finer territories, driver age, discounts — with the
numbers still labelled illustrative.

**Superseded in part by D-016.** Under the production objective we never supply
real rates at all: the carrier supplies theirs. What must grow is the *engine's*
ability to express a real filed programme.

---

## D-002 · The domain package is pure

**2026-08-20**

Rating, underwriting rules, the job lifecycle, proration and billing schedules
live in `packages/domain` and touch nothing outside themselves: no database, no
network, no framework.

**Why:** the arithmetic is the part that must be right. Keeping it pure means it
can be tested exhaustively and quickly, and the tests are about insurance rather
than about plumbing. It is also why the rating engine could be demonstrated live
in a few lines during the first session.

**Consequence:** anything needing input or output belongs in `apps/api`, even
when it feels like domain logic.

---

## D-003 · The API has no runtime dependencies

**2026-08-20**

The server is built on Node's own `node:http` and `node:sqlite`. No web
framework, no database driver, no query builder.

**Instead of:** Express or Fastify with a database library, the conventional
choice.

**Why:** the surface needed is small — a router, JSON in and out, and SQL. The
supply chain stays trivially auditable, installation is fast, and there is no
framework upgrade treadmill. The router is about 120 lines.

**Cost, accepted:** no ecosystem of middleware. Things like rate limiting or
sessions would be hand-written.

**Provisional under D-016.** SQLite in particular will not survive a real
deployment with more than one process. Treat the dependency count as a pleasant
property, not a constraint worth distorting the design to preserve.

---

## D-004 · One state machine for all four job types

**2026-08-20**

Submissions, mid-term changes, renewals and cancellations share a single
lifecycle: Draft, Quoted, Bound, Issued, with Declined and Withdrawn as
endings.

**Why:** they genuinely are the same process applied to different starting
points. One state machine means the underwriting guard, the role checks and the
audit trail were written once and apply everywhere. Four parallel workflows
would have drifted apart.

---

## D-005 · Policy versions are immutable; the ledger is the truth

**2026-08-20**

Issuing any job appends a new policy version snapshot and a financial
transaction. Nothing existing is edited.

**Instead of:** a single policy record updated in place.

**Why:** insurance needs to answer "what did this policy say on a given date,
and why". An updated-in-place record cannot answer that. It also makes the
money auditable: written premium is the sum of the transactions, full stop.

---

## D-006 · Billing reconciles against the ledger

**2026-08-20**

New business and renewals lay down an installment schedule. Endorsements and
cancellations do not edit invoices; they change the transaction total, and a
single `reconcile()` function pulls the schedule back onto it.

**Instead of:** each job type adjusting invoices in its own way.

**Why:** it collapses four sets of edge cases into one rule, and produces a
single invariant that can be asserted in tests:
`sum(non-void invoices) === sum(transactions)`. Additional premium spreads
across unpaid installments, return premium comes off the latest first, and
anything that cannot be absorbed becomes a credit the insurer owes.

**Revisit when:** real billing rules arrive — down payments, installment fees,
non-payment cancellation. The reconciliation idea should survive; the spreading
rules will need to become configurable.

**Superseded by D-025.** The single reconciliation invariant became four —
ledger balance, charge coverage, receivable truth, no negative journal line —
once billing became a double-entry ledger.

---

## D-007 · Billing depth: schedules, invoices and payments

**2026-08-20**

Chosen from three options offered.

**Instead of:** a read-only billing summary derived from transactions, or a full
subsystem with delinquency, dunning, payment methods and non-payment
cancellation.

**Why:** the read-only version would have made the billing screen an obvious
stub. The full subsystem was a large amount of work for a demonstration. This
level is enough to show a real billing screen without inventing a payment
gateway.

**Superseded by D-025.** That schedule-and-invoice level was the arithmetic
core; the ledger, configurable plans and immutable items in D-025–D-027 are
the operational layer this entry left for later.

---

## D-008 · Accounts are the customer of record

**2026-08-20**

An account holds the named insured, their contact details and their producer.
Policies hang off it, submissions start from it, and payments are recorded
against it rather than against a policy.

**Why:** one customer can hold several policies, and one payment can settle
invoices across several of them. Attaching billing to a policy would have made
that impossible to express. Starting submissions from an account also means the
insured is never retyped.

---

## D-009 · A limit or deductible the product does not offer is refused

**2026-08-20**

The rating engine now rejects a limit or deductible that is not among the
product's options, and requires one where the coverage defines options.

**Why:** this fixed a real defect. Previously an unlisted value fell through to
a factor of 1.0, so a customer could request a five million dollar liability
limit and be charged the one million dollar rate. Silent underpricing is the
worst kind of bug: nothing fails, the money is just wrong.

---

## D-010 · Underwriter first, and "structural ink"

**2026-08-20**

The interface is optimised for an underwriter clearing a referral queue. The
visual direction is high-contrast near-black on white, strong rules, a strict
grid, and one saturated colour reserved for status and money.

**Instead of:** two other directions offered (a warm archival style, and a
quieter typographic one), and explicitly not the enterprise-insurance look.

**Why:** the referral queue is the screen where a real decision happens, so it
sets the priorities: reasons, risk and premium visible together. The visual
direction follows from `PRODUCT.md`: the record is the interface, and data gets
typographic hierarchy rather than containers. `DESIGN.md` holds the detail.

**Binding consequence:** no cards inside cards, and status is always a word, not
just a colour.

---

## D-011 · React and Vite with hand-written CSS

**2026-08-20**

**Instead of:** a utility-class framework such as Tailwind, or a component
library.

**Why:** the requested look was specifically not the generic AI-application
aesthetic, and utility-first styling pulls hard toward wrapping everything in
nested boxes. Hand-written CSS with a token layer keeps the design system
explicit and reviewable in one place.

**Also hand-written:** the router, about ninety lines, because the application
has nine routes and a routing library would have been more configuration than
code.

---

## D-012 · The API answers under `/api`, and one process serves everything

**2026-08-20**

The server hosts the API under `/api` and the built web client on every other
path. `npm run build && npm start` runs the whole application on one port.

**Why:** the original arrangement only worked inside the development server. The
built client called `/api`, but only a development-time proxy answered it, so a
deployed build would have failed on every request. The client's routes also
collided with the API's: `/accounts` was both a screen and an API resource. The
prefix resolves the collision, and development and production now use identical
addresses.

**Found by:** copying the uploaded project into an empty folder and trying to
run it as a stranger would. Worth repeating before any release.

---

## D-013 · Schema versions are checked, not migrated

**2026-08-20**

The database records a schema version. Opening a database from an older version
fails immediately with a message saying to delete it and reseed.

**Instead of:** writing migrations.

**Why:** there is no production data, and a wrong migration silently corrupting
money is far worse than an explicit refusal. Failing loudly is honest.

**Revisit when:** anyone has data they care about. That is the moment migrations
stop being premature.

**Under D-016 this has a countdown on it.** The transition from "no data worth
keeping" to "a carrier's book of business" happens once and cannot be undone.
Migrations must exist before the first real user, not after.

**Superseded by D-026.** Numbered, forward-only migrations now exist; the
countdown ran out and the transition is done.

---

## D-014 · Sign-in is a real form, but not a security boundary

**2026-08-20**

Username and password, one account per role: `underwriter`, `csr`, `admin`. The
demo passwords are printed under the form when the demo flag is set.

**Instead of:** the earlier screen, which let anyone sign in by clicking a name.

**Why:** clicking a name is not a login and made the demonstration feel unfinished.

**What it is not:** passwords are hashed with a salt and the failure message does
not reveal whether a username exists, but the token handed back is a long-lived
key rather than an expiring session, and there is no rate limiting, lockout,
password change or reset. Treat it as a role switcher with a lock on it. The
README says so too.

**Side effect:** the second tenant, Northstar Mutual, still exists with its own
book of business and its own logins, but those are suffixed and not advertised,
so nobody reaches it from the sign-in screen by accident.

**Provisional under D-016.** A production system needs real sessions with
expiry and revocation, password management, and eventually federated sign-in
and multi-factor. This is not a small task and should not be scoped as one.

---

## D-015 · The test runner was upgraded to reach `node:sqlite`

**2026-08-20**

Vitest 2 could not load `node:sqlite`: the bundler underneath it stripped the
`node:` prefix and then failed to resolve the name, because `sqlite` is only
listed as a built-in module with the prefix attached. Upgrading to Vitest 3
resolved it.

**Recorded because** the failure message ("Failed to load url sqlite") gives no
hint of the cause, and someone will otherwise lose an hour to it.

---

## D-017 · Claims money never touches the premium ledger

**2026-08-26**

Claim reserves, payments and recoveries live in their own tables
(`claim_reserve_movements`, `claim_payments`, `claim_recoveries`) and are
summed by pure domain arithmetic. The billing invariant —
`sum(non-void invoice amounts) === sum(transaction amounts)` — remains a
statement about premium only.

**Instead of:** writing claim payments into the premium ledger as negative
transactions or invoices.

**Why:** premium and losses are different books answering different questions.
A carrier's finance function reconciles written premium against receivables;
its claims function reconciles incurred against paid and recovered. Mixing
them makes both reconciliations wrong. Deductible recovery is a claim
recovery record, not an invoice.

**Superseded by D-025 (invariants 4a–4d), which remain a statement about
premium only.**

---

## D-018 · Reserves move by appending signed deltas, never by edit

**2026-08-26**

The current reserve on an exposure is the sum of its movement rows. There is
no "set the reserve" write anywhere; a correction is a new movement with a
reason, and closing an exposure appends the offsetting movement rather than
touching history.

**Instead of:** a mutable `reserve_cents` column updated in place.

**Why:** reserve history is what an auditor and an actuary both read — how the
estimate developed matters as much as where it ended. An overwrite destroys
exactly that. This mirrors the append-only policy versions decision (D-005).

---

## D-019 · Payment authority is a personal limit on the user record

**2026-08-26**

Every user carries `authority_limit_cents`. A claim payment within the
requester's own limit is authorized as it is requested; one above it waits in
`Requested` until a second person — whose own limit covers it — approves.
Nobody approves their own payment. Only `Approved` payments can be `Issued`.

**Instead of:** role-based approval (any supervisor approves anything) or no
gate at all.

**Why:** this is how carriers actually delegate: authority is granted per
adjuster, in dollars, and revised as they gain experience. The guard is the
same shape as the underwriting referral guard — the system never blocks the
request, only the money leaving without the right approval.

---

## D-020 · Loss causes and fraud indicators are product configuration

**2026-08-26**

Which causes of loss exist, which coverages respond to each, who can claim
under them, and which fraud indicators fire are all data on the product
definition (`lossCauses`, `fraudRules`), read by a claims engine that knows
nothing about automobiles.

**Instead of:** hard-coding "collision pays under COLL" in the claims service.

**Why:** invariant 9 — a second product must not require touching engine code.
A habitational product will bring water damage and fire with different
responding coverages; that must be a data change. Fraud rules follow the same
rule-as-data shape as underwriting referral rules.

---

## D-021 · Schema v4: claims tables, claims roles, one more reseed

**2026-08-26**

Eight claims tables, `claim_prefix`/`next_claim_seq` on tenants, two new
roles (`adjuster`, `claims_supervisor`) and `authority_limit_cents` on users.
Under D-013 there is no migration path: existing databases must be deleted
and reseeded, and anything typed into them is gone.

**Recorded because** it is the largest schema change so far and the kind of
change that stops being acceptable the moment a carrier loads real data. The
migrations countdown in D-013 is now shorter, not longer.

---

## D-022 · The product ships empty; demo data lives only in the tests

**2026-08-26**

There is no seed command. On its first start against an empty database the
server creates one carrier (name and prefix from `POLARIS_CARRIER_NAME` /
`POLARIS_CARRIER_PREFIX`) and one sign-in per role, prints the credentials
once, and stops there. The book of business begins empty; an existing
database is never touched, so everything entered through the screens persists
until someone deletes the file. Admins create further sign-ins from the Team
screen. The invented book — the fake customers, policies and claims — moved
to `apps/api/tests/e2eSeed.ts`, where only the browser tests build it, on
scratch databases.

**Instead of:** `npm run seed` being the assumed starting point, which meant
every fresh launch greeted its operator with invented policyholders.

**Why:** a system pitched at real carriers must not blur the line between
data someone entered and data a script invented. An empty first start makes
what persists obvious, and keeps the demo names where they now belong: in
test scaffolding that never touches a real database.

**Deliberate residue:** the invented names still exist inside the test tree.
Removing them from the tests too would be a large rewrite for no
user-visible gain.

---

## D-023 · Migrations run with foreign keys switched off, then prove nothing broke

**2026-08-28**

`migrate()` turns `PRAGMA foreign_keys` off for the length of a run and back
on afterwards, then fails the run if `PRAGMA foreign_key_check` reports a
single dangling row. Migration 003 needs it: SQLite cannot alter a CHECK
constraint in place, so widening the roles on `users` means rebuilding the
table, and nine tables hold a foreign key to `users(id)`.

**Instead of:** `PRAGMA defer_foreign_keys = ON` inside the migration, which
is the only foreign-key pragma that does anything inside a transaction. It
does not work here: dropping the parent table records one deferred violation
per child row, and renaming the replacement into place never clears them, so
the COMMIT fails. `PRAGMA writable_schema` — editing the stored CREATE
statement directly — is refused outright by `node:sqlite`.

**Why:** it is the procedure SQLite's own documentation prescribes for
rebuilding a table, and the `foreign_key_check` afterwards is a stronger
guarantee than per-statement enforcement would have given: it inspects every
row in the database rather than only the ones a statement touched.

**Deliberate residue:** a migration can now write a row whose foreign key
points at nothing and only find out at the end of the run. The check turns
that into a loud failure rather than silent corruption, but it arrives after
the fact.


---

## D-024 · A payment plan code is any code the carrier configured, not a union

**2026-08-29**

`billingPlan` arriving over HTTP is checked against
`listPaymentPlans(db, tenant, { productCode, province })` — the same filtered
catalogue the quote wizard asked for — instead of against a three-value
`'full' | 'monthly' | 'quarterly'` union compiled into the server. The row
types in `apps/api/src/repo/shared.ts` carry `PlanCode`, a string, for the
same reason. `/billing/plans` also lost its role list: it answers to any
authenticated role.

**Instead of:** widening the union each time a plan is added, which is what
the old `requireInstallmentPlan` forced. The quote wizard reads its choices
from the catalogue, so the server rejecting a plan the wizard had just
offered was a live defect the moment the fourth plan appeared: a CSR
selecting "Two months down, 10 monthly" got
`billingPlan must be one of full, monthly, quarterly`.

**Why:** invariant 9 — product configuration is data — is not true of payment
plans if adding one needs a type widened and a deploy. The catalogue is the
only thing that knows what a carrier sells, so it is the only thing that may
validate it. Filtering by product *and* province keeps the boundary as strict
as the screen: a plan filed for Ontario cannot be quoted on an Alberta
account.

**Deliberate residue, since resolved:** `InstallmentPlan` and the equal-split
helpers in `packages/domain/src/billing.ts` were left in place, unused by the
API, rather than deleted in a screens task. The file and its test were
deleted once the ledger work that replaced them (D-025) was complete.

---

## D-025 · Billing is a double-entry ledger with immutable invoice items

**2026-08-29**

Every billing event — a charge sliced from premium, tax or a fee; premium
earning; a payment received; a payment applied to an invoice — writes a
journal entry of at least two lines, debits equal to credits, to a fixed
chart of accounts (`packages/domain/src/billing/ledger.ts`). `postEntry`
refuses to write an entry that does not balance. A charge is sliced once,
at issue or endorsement time, into invoice items that are never edited
again; an invoice is just the items that share an invoice id, and every
balance — what an invoice is worth, what is outstanding, what an account
owes — is a sum over items or ledger postings, never a stored total kept in
step by hand.

**Instead of:** the single reconciliation invariant in D-006 —
`sum(non-void invoice amounts) === sum(transaction amounts)` — backed by a
mutable `invoices` table that `reconcile()` rewrote on every job.

**Why:** a mutable invoice cannot answer "what did the customer's bill say
on the day we sent it", and a single sum-equality invariant cannot catch a
posting that balances against the wrong account or a payment applied to an
invoice it never touched. Four invariants replace it, each checked in
`assertBillingInvariants` (`apps/api/src/billing/readModel.ts`) against a
real account's data, not against a mock:

1. **Ledger balance.** No journal entry's debits and credits differ.
2. **Charge coverage.** Every charge's items sum to exactly the charge amount.
3. **Receivable truth.** The premium-receivable ledger balance for an account
   equals what its live (non-void) invoice items still owe.
4. **No negative journal line.** No debit or credit is stored negative; a
   reversal swaps which account is debited and which is credited instead.

The rounding remainder on a sliced charge also moved from the first
installment to the last (`splitRemainderLast`, replacing D-006's
`splitEvenly`), so a customer's first payment — the one most likely to be
quoted back to them on a call — is never the odd cent out.

**Revisit when:** PR 2 adds payment instruments, requests, returns and
holds — none of that changes the ledger shape, but reversal events
(`postingsFor` currently has none) will need a posting rule of their own.

---

## D-026 · Numbered migrations replace reseeding

**2026-08-29**

`apps/api/src/migrations/` holds forward-only, numbered migrations, each
recorded in `schema_migrations` and run once inside its own transaction.
The v4 schema that used to be the whole database became migration 001
(baseline); a database written before the migration runner existed is
adopted by it rather than rejected. An existing database is converted in
place, not thrown away: migration 002 turns every non-void legacy invoice
into a charge, its items, and the postings behind them, then renames
`invoices` to `legacy_invoices` and `payment_applications` to
`legacy_payment_applications` — kept, not dropped, so nothing already on
disk is destroyed by the upgrade.

**Instead of:** D-013's rule — a schema-version mismatch fails outright and
tells the operator to delete the database and reseed.

**Why:** D-013 was right for a build with no data anyone cared about. This
branch is the moment that stops being true even inside the demo: the billing
tables change shape three times (charges and items, then billing runs, then
the widened `users` role check), and a carrier's first real book of business
is now close enough that "delete and start over" is no longer an acceptable
answer to a schema change. D-023 records how the migrations that rebuild a
table (SQLite cannot alter a CHECK constraint in place) get past foreign key
enforcement safely.

**Supersedes D-013**, which is marked superseded above rather than deleted.

---

## D-027 · Payment plans, charge patterns and tax rates are tenant configuration seeded from an illustrative catalogue

**2026-08-29**

`payment_plans`, `charge_patterns` and `tax_rates` are rows, not code,
seeded per tenant from `DEFAULT_PAYMENT_PLANS` / `DEFAULT_CHARGE_PATTERNS` /
`DEFAULT_TAX_RATES` (`packages/domain/src/billing/defaultPlans.ts`) when a
tenant is bootstrapped. A plan's `installments` count describes a 12-month
term (`monthly` means 12) and scales with the actual term length at slicing
time (`installments × termMonths / 12`, rounded, minimum one) rather than
being read literally. The Ontario auto installment fee is capped at 1.3% of
premium by `feeCapBps`, enforced where the fee is sliced, not where the plan
is defined, so a plan cannot be configured to exceed a cap that is itself
configuration. Every filing reference on a fee or tax pattern is the literal
placeholder `SAMPLE-FILING` or `null`, matching D-001's rule for rates.

**Instead of:** a three-value `'full' | 'monthly' | 'quarterly'` union
compiled into the server, which is what D-024 already retired for the API
boundary; this decision is that same principle applied to where the plans,
patterns and rates themselves live.

**Why:** invariant 9 — a second product or carrier must not require touching
engine code. A plan, a fee, or a tax rate is exactly the kind of fact that
differs carrier to carrier and changes on a filing date; hard-coding any of
it would mean a deploy every time a carrier's finance team files a new fee
schedule.

**Revisit when:** a carrier's real filed plans and tax rates replace the
sample catalogue — a deliberate, legally weighted act, same as D-001.

---

## D-028 · Cancellation and endorsement re-spreading rules

**2026-08-29**

When a job reduces premium — a return-premium cancellation or a reducing
endorsement — the reduction is applied against the invoices covering the
period from the change date on, latest first, and only against the
**premium** outstanding on each one. Spec §4's order is followed: the
invoices still planned give up their premium first, then the ones already
billed that are still unpaid, and only what neither can absorb becomes a
credit note. Additional premium is the other way round — it lands on planned
invoices alone, because adding to a bill already in the customer's hands
would ask for money the document they were sent does not mention. Emptying an
invoice's premium this way reverses its fee and tax with negative items on
those same charges and voids the invoice; a partial reduction reverses tax
on the amount actually reduced and leaves the fee untouched, because an
installment fee belongs to an installment that still happens. A pro-rata
cancellation on an advance-billed schedule was proven (Task 12 review) to
always empty whole invoices rather than partially reduce one — the partial
case only arises from a reducing endorsement. Tax on a reduction is priced
at the rate in force on the date of the change, not the date the original
premium was billed.

**Instead of:** reversing premium, fee and tax proportionally on every
touched invoice regardless of how much of it was emptied, or repricing tax
at the original billing date.

**Why:** installment fees are compensation for the installments still to be
collected; cancelling a future installment should not refund a fee for
service already rendered on the ones already billed. Latest-invoices-first
mirrors how the old spreading rule (D-006) treated return premium, so a
customer's next payment still drops before their last one does.

**The `'paid'` fallback is explicit in the code, not an omission.**
`taxBasis(rate)` in `packages/domain/src/billing/tax.ts` is the one place
that answers what date a rate is priced on; it returns `'billed'` for both
configured values and says why in a comment, and `taxItemsFor` calls it and
throws rather than silently dropping tax should that ever change. A domain
test pins that a rate configured `appliesOn: 'paid'` still produces items at
billing time, so the day PR 2 lands the test fails and has to be rewritten
deliberately.

**Revisit when:** PR 2 adds the `appliesOn: 'paid'` tax recompute. Until
then, a mid-term reduction on a policy whose province changed its tax rate
mid-term carries a small mis-rated credit — cents, not dollars, and only on
provinces with a rate change inside the term (Quebec's 2027-01-01 change is
the current example).

---

## D-029 · Earned premium is posted daily by the billing day

**2026-08-29**

One process, `runBillingDay` (`apps/api/src/billing/billingDay.ts`), bills
the invoices whose bill date has arrived and posts earned premium for every
in-force policy version, from `max(term_start, effective_date)` to
`term_end`, capped at cancellation. Earning is a delta against each
version's last-posted snapshot, so a version is never earned twice and a
day with nothing new to earn posts no journal line — a zero or negative
earning line is refused rather than written. The run is idempotent per
`(tenant, date)`: it is recorded before the work happens, and a second call
for a date already run does nothing. `POST /billing/run` refuses a date
earlier than the tenant's newest run or later than today; the same function
also runs on a server timer.

**Instead of:** earning every version from its own term start regardless of
when it took effect, which double-counts the part of an endorsed term that
an earlier version already earned.

**Why:** `max(term_start, effective_date)` is what makes an endorsement's
earning additive rather than double-counted — its transaction is already
the remaining-term delta, so it only earns the days from when it took
effect. Refusing a zero or negative line keeps invariant 4d (no negative
journal line) true by construction rather than by a check bolted on after
the fact, and the run-date guard stops an out-of-order run from corrupting
an earned balance that later runs build on.

**The run commits in batches, and resumes rather than skipping.**
`node:sqlite` is synchronous: the run blocks the process while it executes,
and one transaction around a carrier's whole book would hold every other
writer out for the length of it. So the work commits per batch — a page of
invoices to bill, a page of policies to earn — which bounds how long the
write lock is held but makes a crash mid-run possible. The run row is the
marker: it is inserted first and its `finished_at` written last, so a row
without `finished_at` is a run that stopped part-way and the next call for
that date re-runs the batches instead of skipping them. That is safe because
every batch is idempotent — billing an already-billed invoice is a no-op,
and earning posts the delta against the version's last snapshot. On start
the first run is deferred five seconds after `listen`, so the port opens
before the process takes the pause.

None of this makes the run concurrent, and it is not meant to: a scheduler
that owns the job, and PostgreSQL underneath it, are the production answer.
The batching is what keeps a single-process SQLite deployment usable in the
meantime.

**Deliberate residue:** a legitimate backfill — posting an earlier date
after a later one already ran — currently has no path except restoring a
backup. Acceptable for PR 1; a real backfill path is PR 2 or later.

---

## D-030 · Two billing roles, no default sign-ins

**2026-08-29**

`billing` and `finance` join the role set, gating `/billing/run` (finance or
admin) and the finance-facing screens, but neither gets a default sign-in
from `bootstrap.ts`. The product still ships empty with five sign-ins,
exactly as D-022 describes; an admin creates a `billing` or `finance`
sign-in from the Team screen the same way they create any other.

**Instead of:** adding two more default sign-ins alongside the existing
five.

**Why:** the empty-start bootstrap and its tests are pinned to five
usernames, and admin already satisfies every finance guard the new roles
exist to narrow, so nothing is blocked by their absence. Growing the
default sign-in list is also the wrong direction for D-022's principle: the
fewer accounts a fresh install invents, the clearer the line between what a
person entered and what the product assumed.
