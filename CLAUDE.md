# Working on Polaris PAS

Read this before touching anything. Then read `README.md` (how to run it),
`DECISIONS.md` (why it is the way it is), `PRODUCT.md` (who it is for) and
`DESIGN.md` (the visual system).

## What this is

A multi-tenant policy administration system for property and casualty
insurance. One product so far: Ontario personal automobile. It covers the whole
path from a customer account, through quoting and underwriting referral, to an
issued policy with a billing schedule, and then mid-term changes, renewals and
cancellations.

It is a working demonstration, not a licensed product. Nothing in it has been
filed with a regulator.

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
8. **Rates are illustrative, and must keep saying so.** The `sample: true` flag
   on the product, the disclaimer in `product.ts`, the note in the README and
   the line on the sign-in screen all stay. If the rating tables are ever
   replaced with real filed rates, that is a deliberate decision with legal
   weight, not a quiet edit.
9. **The API answers under `/api`.** The web client owns every other path. They
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
