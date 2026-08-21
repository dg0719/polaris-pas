# Working on Polaris PAS

Read this before touching anything. Then read `ROADMAP.md` (where this is
going), `DECISIONS.md` (why it is the way it is), `README.md` (how to run it),
`PRODUCT.md` (who it is for) and `DESIGN.md` (the visual system).

## The objective

**Build a production-ready core insurance system for small and mid-sized
Canadian property and casualty insurers.**

Not a demo, not a portfolio piece. The target is software a real carrier could
run their business on. Three pillars, all of which are in scope:

| Pillar | What it means | Where it stands today |
|---|---|---|
| **Policy administration** | Accounts, products, rating, underwriting, quote to issue, mid-term changes, renewals, cancellations | Substantially built for one product |
| **Billing** | Installment schedules, invoicing, payments, delinquency, commissions, accounting | A thin slice: schedules, invoices, payments |
| **Claims** | First notice of loss, reserves, adjuster workflow, claim payments, recovery | **Not started** |

The reference point is Guidewire InsuranceSuite: PolicyCenter, BillingCenter
and ClaimCenter. The stated aim is parity with all three.

**Read the next section before acting on that.**

## Being honest about the scale of that aim

Literal parity with Guidewire is not achievable, and a session that pretends
otherwise will make bad sequencing decisions. Guidewire is two decades of work
by a large engineering organisation, and a typical implementation at a carrier
takes one to three years and costs millions before anyone issues a policy.

What *is* achievable, and is a real gap in the market, is this: **the eighty
per cent of the capability that a small or mid-sized carrier actually uses, at
a fraction of the implementation cost and time.** Small Canadian insurers are
mostly priced out of the enterprise suites and run legacy or in-house systems.
That is the opening.

So treat "parity" as a direction of travel, not a specification. When
sequencing work, ask which capability a small carrier cannot operate without,
not which capability Guidewire has.

## Who must be convinced

All three groups, and they judge differently. Work should not systematically
favour one.

- **Insurance people** (underwriters, product managers, operations) judge
  domain realism: correct terminology, coverage structure that matches the
  policy contract, workflows that match how the job is actually done. They ask
  early where the declaration page is, and whether it handles non-payment
  cancellation.
- **Technical evaluators** (engineers, architects) judge the data model, the
  test coverage, whether it survives real scale, and whether the product
  configuration is genuinely data-driven rather than hard-coded.
- **Business decision makers** judge the story and the polish: does it look
  like a product, does the demonstration run end to end without dead ends.

## Pace

The intent is to move fast. Fast means sequencing by what unlocks the most,
de-risking the architecture early, and not gold-plating. It does **not** mean
skipping tests or shipping something that quietly loses money, because in this
domain that is what destroys credibility with all three audiences at once.

## Canadian context that shapes the product

Facts a session must not get wrong:

- **Insurance is regulated provincially.** Rates and policy wordings are filed
  with and approved by a provincial regulator before use. Ontario's is FSRA;
  Quebec's is the AMF; Alberta has a separate rate board for automobile.
- **Automobile insurance is not a single national market.** British Columbia,
  Saskatchewan and Manitoba have public insurers providing basic automobile
  coverage, so private carriers there sell only optional or excess cover.
  Quebec splits it: bodily injury is public, property damage is private.
  Ontario, Alberta and the Atlantic provinces are private. Any multi-province
  plan must account for this rather than assuming Ontario's shape repeats.
- **The product model must express any carrier's filed rates**, not carry our
  own. We do not need real rate tables; we need a rating engine configurable
  enough that a carrier can load theirs, versioned by effective date.

## What the ambition changes about existing decisions

Several early decisions were correct for a demonstration and are now
provisional. They are recorded in `DECISIONS.md`; these are the ones with a
countdown on them:

- **No database migrations** (D-013). Fine with no real data. Becomes
  unacceptable the moment a carrier has data, and that transition is sudden.
- **Demonstration-grade sign-in** (D-014). Needs real sessions, expiry,
  password management, and eventually federated login and multi-factor.
- **Zero runtime dependencies and SQLite** (D-003). A pleasant property, not a
  goal worth protecting. A real deployment likely needs PostgreSQL. Do not
  contort the design to preserve the dependency count.
- **Illustrative rate tables** (D-001). The tables themselves are throwaway.
  What matters is that the rating engine grows expressive enough to hold a real
  filed rate program.

## What this is today

One product, Ontario personal automobile, covering the path from a customer
account through quoting and underwriting referral to an issued policy with a
billing schedule, and then mid-term changes, renewals and cancellations.

It is not yet licensed, filed, or in production anywhere.

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
