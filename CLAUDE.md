# Working on Polaris PAS

Read this before touching anything. Then read `ROADMAP.md` (where this is
going), `DECISIONS.md` (why it is the way it is), `README.md` (how to run it),
`PRODUCT.md` (who it is for) and `DESIGN.md` (the visual system).

## The objective

**Build Polaris into an enterprise-scale core insurance system for the property
and casualty market, and put it in production at Canadian carriers.**

Not a prototype. Not a demonstration that gestures at a product. The target is
the system a carrier runs their entire business on: every policy they write,
every dollar they bill and collect, every claim they pay. Three pillars, all in
scope, all going to production:

| Pillar | What it owns | Where it stands |
|---|---|---|
| **Policy administration** | Accounts, product configuration, rating, underwriting, quote to issue, endorsements, renewals, cancellations | Substantially built for one product |
| **Billing** | Installment schedules, invoicing, payments, delinquency, cancellation for non-payment, commissions, accounting | Arithmetic core built; operational layer to come |
| **Claims** | First notice of loss, reserves, adjuster workflow, indemnity and expense payments, recovery | Next major build |

The benchmark is Guidewire InsuranceSuite — PolicyCenter, BillingCenter and
ClaimCenter — and the aim is to match its capability where it matters and beat
it where it counts.

**Initial market:** small and mid-sized Canadian carriers, who are largely
priced out of the enterprise suites and running legacy or in-house systems.
That is the beachhead, not the ceiling.

## Why this is winnable

Build with the confidence that it is, because the position is genuinely strong:

- **A greenfield system does not carry the incumbent's burden.** Two decades of
  on-premise deployment, bespoke per-carrier customisation frameworks, and deep
  backward compatibility account for an enormous share of what makes the
  established suites large and slow to change. None of that weight is ours.
- **The domain is well understood, not research.** Policy, billing and claims
  have known shapes. There is nothing here to invent from first principles;
  there is a great deal to build correctly.
- **The market gap is real and underserved.** A carrier writing a few hundred
  million in premium cannot justify an enterprise-suite implementation, and
  their alternatives are genuinely poor. They are the customers most motivated
  to switch.
- **Scope discipline is an advantage, not a limitation.** Serving one segment
  extremely well beats serving every segment adequately, and it is how every
  successful core system started.

Sequence work by what a carrier cannot operate without. That is a strategy for
getting to production fastest, not a smaller ambition.

## What "enterprise-scale" demands of every change

Ambition raises the engineering bar rather than lowering it. Build as if a
carrier's book depends on it, because the intent is that one day it will:

- **Configuration over code.** A new product, coverage, province or rate change
  must be data. If it requires touching the rating engine, the design is wrong.
  This is the single most important property of the whole system: it is what
  makes the second customer cost a fraction of the first.
- **Multi-tenancy is non-negotiable and already correct.** Keep it that way.
- **Everything financial is auditable.** Immutable versions, an append-only
  ledger, and the ability to answer "what did this say on that date, and who
  changed it" for any record.
- **Correctness before speed of delivery, always.** In this domain a silent
  rounding error is worse than a missing feature, because it destroys trust
  with every audience at once.
- **Nothing that cannot survive real volume.** Unbounded queries, missing
  pagination and single-process assumptions are defects, not deferrals.
- **Assume real data from now on.** Migrations, real authentication and
  operational tooling stop being optional the moment the first carrier loads a
  book, and that moment arrives without warning.

## Who must be convinced

All three groups, and they judge differently. Work should not systematically
favour one.

- **Insurance people** (underwriters, product managers, operations) judge
  domain realism: correct terminology, coverage structure that matches the
  policy contract, workflows that match how the job is actually done. They ask
  early where the declaration page is, and whether it handles non-payment
  cancellation.
- **Technical evaluators** (engineers, architects) judge the data model, the
  test coverage, whether it survives real scale, and whether product
  configuration is genuinely data-driven rather than hard-coded.
- **Business decision makers** judge the story and the polish: does it look
  like a product, does the demonstration run end to end without dead ends.

## Pace

Move fast, and define fast correctly: sequence by what unlocks the most, settle
the architecture early so it is not rebuilt, and do not gold-plate. Speed comes
from choosing the right next thing, not from cutting corners on the thing
chosen.

## Canadian context that shapes the product

Domain facts. Getting these wrong produces confident, wasted work.

- **Insurance is regulated provincially.** Rates and policy wordings are filed
  with and approved by a provincial regulator before use. Ontario's is FSRA;
  Quebec's is the AMF; Alberta has a separate rate board for automobile.
- **Automobile insurance is not a single national market.** British Columbia,
  Saskatchewan and Manitoba have public insurers providing basic automobile
  coverage, so private carriers there sell only optional or excess cover.
  Quebec splits it: bodily injury is public, property damage is private.
  Ontario, Alberta and the Atlantic provinces are private. Any multi-province
  plan must account for this rather than assuming Ontario's shape repeats.
- **The product model holds the carrier's filed rates, never ours.** We supply
  an engine expressive enough to express any filed programme, versioned by
  effective date. The rate tables currently in the repository are placeholders
  for that engine, nothing more.

## What the ambition changes about existing decisions

Several early decisions were right for a first build and are now on a clock.
They are recorded in `DECISIONS.md`; these are the ones to revisit:

- **No database migrations** (D-013). Must exist before the first carrier loads
  real data. That transition happens once and cannot be undone.
- **Demonstration-grade sign-in** (D-014). Needs real sessions, expiry,
  revocation, password management, and eventually federated login and
  multi-factor. Not a small task; do not scope it as one.
- **Zero runtime dependencies and SQLite** (D-003). A pleasant property, not a
  goal. Production needs PostgreSQL. Do not distort the design to preserve the
  dependency count.
- **Placeholder rate tables** (D-001). Throwaway by design. What matters is the
  engine's expressiveness.

## Where the build has reached

One product, Ontario personal automobile: customer accounts, quoting,
underwriting referral with an approval guard, issue, endorsements, renewals,
cancellations, an installment billing schedule with payments, full policy
version history, and a working web client. Multi-tenant throughout, with 143
tests and a browser test covering the whole path.

Next: making the product model configurable enough for a second product and a
second carrier. See `ROADMAP.md`.

## Who you are working with

Dave is not a programmer and has said so plainly. This shapes how you
communicate, not what you build:

- **No unexplained jargon or acronyms.** If a term is unavoidable, define it in
  one short sentence the first time it appears. "Pull request", "dependency",
  "schema" and "type checking" all need explaining.
- **Demonstrate rather than assert.** When asked whether something works, run
  it and show the output. Twice in the first session, "let me prove that"
  found real problems that confident reassurance would have hidden.
- **Say what you did not do.** Every report ends with the honest remainder:
  what was skipped, what is still weak, what you are unsure about.
- **Do not narrate the obvious or pad the summary.** Short and specific.

## Invariants: do not break these

These are load-bearing. Most are protected by tests; if you find one that is
not, add the test rather than relying on care.

1. **Money is always integer cents.** Never a decimal, never a float. Rounding
   happens once per coverage line, never mid-calculation.
2. **Dates are ISO strings, `YYYY-MM-DD`.** No `Date` objects in stored data.
3. **Tenant isolation.** Every business row carries `tenant_id`. Tenant identity
   comes only from the caller's credentials, never from a request body or query
   parameter. All scoping happens in `apps/api/src/repo/` and nowhere else. A
   query in a service or route that is not tenant-scoped is a security defect.
4. **The billing invariant.** For any policy,
   `sum(non-void invoice amounts) === sum(transaction amounts)`.
   Job types never edit invoices directly; they move the transaction total and
   `reconcile()` pulls the schedule back onto it.
5. **Policy versions are append-only.** Issuing a job writes a new immutable
   snapshot. Never edit or delete an existing version.
6. **`packages/domain` is pure.** No file access, no network, no database, no
   framework. It takes data and returns data. This is what makes the rating and
   billing arithmetic testable and trustworthy.
7. **Status changes go through the state machine.** `transition()` in
   `packages/domain/src/stateMachine.ts` is the only path. Do not set a job
   status directly.
8. **Rates are illustrative until a carrier's filed rates replace them, and
   must keep saying so.** The `sample: true` flag on the product, the
   disclaimer in `product.ts`, the note in the README and the line on the
   sign-in screen all stay while the numbers are ours. Loading a carrier's real
   filed rates is a deliberate act with legal weight, never a quiet edit.
9. **Product configuration is data, not code.** Coverages, options, factors and
   rules live in product definitions. A new product or province must never
   require changing the rating engine. This is what makes the system sellable
   to more than one carrier.
10. **The API answers under `/api`.** The web client owns every other path. They
   collide otherwise: `/accounts` is both an API resource and a screen.

## Conventions

- **Node 24 or newer.** The API uses `node:sqlite` and runs TypeScript directly
  through Node's type stripping. Neither exists in older versions.
- **The API has zero runtime dependencies.** `node:http` and `node:sqlite` only.
  Adding a runtime dependency needs a reason and Dave's agreement.
- **The web client is React and Vite with hand-written CSS.** No utility-class
  framework, no component library. `DESIGN.md` is the design system and it is
  binding: no cards inside cards, status always carries a word rather than
  relying on colour, money in tabular figures.
- **Many small files.** 200 to 400 lines is normal, 800 is the ceiling. When a
  file passes it, split it by responsibility.
- **Tests are the contract.** Every new behaviour gets a test that would fail
  without it. If you cannot describe the failing case, the test is decorative.
- **Comments explain why, not what.** The code says what.

## Before saying anything is finished

Run all of these and report the actual results:

```bash
npm run typecheck     # both projects
npm test              # unit and integration
npm run build         # the web client compiles
npm run test:e2e      # a real browser drives the whole path (needs Chrome)
```

For any user interface change, take screenshots and **look at them**. A
screenshot you generated but did not read does not count. Check at least a
narrow phone width and a normal desktop width.

## Ask before you do these

- Changing the database structure. There is no upgrade path between schema
  versions; a change means everyone reseeds and loses their data.
- Adding any dependency, runtime or development.
- Committing to `main`. Work on a branch and open a pull request.
- Anything that weakens tenant isolation, authentication or the rate
  disclaimers.
- Large refactors that were not asked for. In the first session `repo.ts` was
  split into six files and the test runner was upgraded. Both were defensible;
  neither was requested. Flag first.

## How work should flow

1. **Branch per piece of work.** `git checkout -b feat/short-name`.
2. **Plan before building** anything bigger than a small fix. Describe the
   approach, wait for agreement, then write code.
3. **One conversation, one outcome.** If the work is growing into several
   things, say so and suggest splitting it.
4. **Pull request, checks green, then merge.** The automated checks run on every
   pull request: type checking, the full test suite, and the web build.
5. **Record the reasoning.** Any decision a future session could accidentally
   undo goes in `DECISIONS.md` as a short entry.

## Where things live

```
packages/domain     Pure arithmetic and rules. Rating, underwriting referral
                    rules, the job state machine, proration, billing schedules.
apps/api            HTTP server. Database, tenant-scoped data access, job
                    workflow, issuance, billing, routes.
apps/web            The interface. Screens, design tokens, a small router.
apps/web/e2e        The browser test that drives the whole path.
```

Run `npm run seed` to build a demo book of business: referrals waiting on an
underwriter, an endorsed policy, an overdue account, a cancellation with a
refund. It is curated deliberately, so keep it that way when changing it.
