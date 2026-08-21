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
