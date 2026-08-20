# Product

## Register

product

## Users

**Primary: the underwriter.** They sit at a desk in an office under flat overhead light, with a queue of submissions that were referred to them by the rating engine. Their job on any given screen is a judgement call: accept this risk, price it differently, or decline it. To make that call they need three things visible at once, without navigating: why it referred, what the risk actually is, and what it costs. Most of their day is triage, so the queue matters as much as the detail view.

Secondary, served but not optimised for: CSRs entering submissions, and billing clerks chasing balances. They share the same screens rather than getting parallel ones.

The job to be done: **clear the referral queue without missing anything.** Success is an underwriter who trusts that what's on screen is the whole picture.

## Product Purpose

Polaris is a multi-tenant policy administration system for P&C insurers. Ontario personal auto is the first product. It holds the customer account, the submission-to-issue workflow, the policy record with its full version history, and the billing schedule that follows from it.

It exists because the workflow it replaces is a mainframe screen and a spreadsheet. Success looks like: an underwriter clears a referral in under a minute, and the money is right to the cent afterwards.

## Brand Personality

Exact, unhurried, plainspoken. It reads like a well-set legal document rather than like software: the information is the design. No reassurance, no celebration, no personality performed at the user. When it says a number, that number is correct and it doesn't decorate it.

Voice: state the fact, then the consequence. "Two at-fault claims in six years. Referred." Never "Oops! Looks like we need a second look."

## Anti-references

- **Guidewire PolicyCenter and the enterprise-insurance genre generally.** No corporate navy, no gradient chrome, no tabbed MDI shell, no 11px grey labels in a sea of fieldsets.
- **Vibe-coded AI app UI.** Specifically: cards nested inside cards inside a card, every region wrapped in its own rounded border and drop shadow, identical icon-heading-paragraph tiles in a three-up grid, a coloured stripe down the left edge of every alert.
- **Consumer fintech cheer.** No congratulatory illustrations, no big friendly hero metric, no green upward arrows.
- Dashboards that show charts because dashboards show charts. An underwriter needs a work queue, not a donut of premium by territory.

## Design Principles

1. **The record is the interface.** Data gets typographic hierarchy, not containers. If two things are related, put them near each other; don't draw a box around them.
2. **Referral reasons are first-class.** The rule that fired, the value that fired it, and the premium at stake belong on the same screen as the decision, above the fold, always.
3. **Money is exact and legible.** Currency in tabular figures, never abbreviated, signed when it can be negative. A refund reads as a refund.
4. **Every state is a designed state.** Empty queue, pending quote, declined job, cancelled policy, overdue invoice. The unhappy paths are most of the job.
5. **Density is a feature, not a compromise.** These users scan many rows. Compact is respectful of their time; airy is not automatically kind.

## Accessibility & Inclusion

WCAG 2.2 AA. Body text at 4.5:1 minimum against its surface, including placeholders and secondary labels. Status must never be conveyed by colour alone: every status carries a word. Full keyboard operation, visible focus on all interactive elements, and `prefers-reduced-motion` honoured with crossfades in place of movement.
