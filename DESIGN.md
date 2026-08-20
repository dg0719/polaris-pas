# Design

Visual system for Polaris PAS. Direction: **Structural ink** — high-contrast near-black on off-white, strong rules, a strict grid, and one saturated signal colour reserved for status and money.

## Theme

Light only. The scene that decides it: an underwriter at a desk under flat overhead office light, reading dense text for six hours. Light ground, maximum text contrast, no glare from large saturated fields. A dark theme is deliberately not shipped rather than half-shipped.

## Colour

Strategy: **Restrained.** Neutrals do the structural work; the signal colour never exceeds roughly 5% of any screen and only ever means something.

OKLCH throughout. Pure-neutral greys (chroma 0) so the chartreuse signal is the only chromatic event on the page.

```css
--bg:          oklch(1 0 0);          /* pure white, no hidden warmth */
--bg-sunken:   oklch(0.975 0 0);      /* table zebra, inset panels */
--bg-raised:   oklch(0.985 0 0);      /* sticky headers, toolbars */

--ink:         oklch(0.17 0 0);       /* primary text, 16.9:1 on bg */
--ink-2:       oklch(0.44 0 0);       /* secondary text, 5.4:1 */
--ink-3:       oklch(0.47 0 0);       /* labels, placeholders, 4.9:1 */
--ink-inverse: oklch(0.99 0 0);

--rule:        oklch(0.90 0 0);       /* hairlines */
--rule-strong: oklch(0.72 0 0);       /* section dividers, table head */

--signal:      oklch(0.797 0.166 113.1);  /* chartreuse-olive: fills only */
--signal-deep: oklch(0.47 0.098 113.1);   /* text/icon on white, 4.8:1 */
--signal-wash: oklch(0.965 0.038 113.1);  /* selected row, active nav */

--negative:      oklch(0.50 0.170 27);    /* declined, overdue, refund */
--negative-wash: oklch(0.968 0.020 27);
```

**Signal usage rule.** `--signal` is a *fill*, never a text colour: near-black type sits on it at ~9:1. It marks exactly three things — the referral flag, the current selection, and the focus ring. `--signal-deep` is the text-safe variant for links and small icons. Anything else uses ink.

**Status is never colour alone.** Every status renders as a word; colour is redundant reinforcement. Statuses map to ink weight by default (`Draft`, `Quoted`, `Bound`, `Issued` are typographic), with `--signal` reserved for *Referred* and `--negative` for *Declined*, *Cancelled*, and *Overdue*.

## Typography

Two families plus figures. Contrast axis is grotesque against monospace, not two competing sans.

- **UI / prose:** Inter (`'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`), variable, weights 400/500/700.
- **Numerals, identifiers, money:** JetBrains Mono (`'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace`), weights 400/500. Every currency amount, policy number, VIN, and date in a table uses it, so columns align on the digit.

Fixed rem scale, ratio ~1.2 (product register: no fluid clamp headings).

```
--text-2xs: 0.6875rem   /* 11px — table micro-labels only, uppercase, tracked */
--text-xs:  0.75rem     /* 12px — field labels, metadata */
--text-sm:  0.8125rem   /* 13px — table body, dense UI */
--text-base:0.9375rem   /* 15px — body, form inputs */
--text-lg:  1.125rem    /* 18px — section headings */
--text-xl:  1.375rem    /* 22px — page heading */
--text-2xl: 1.75rem     /* 28px — the one number that matters (annual premium) */
```

Headings: weight 700, letter-spacing -0.015em (never below -0.04em). Micro-labels: 500, uppercase, +0.06em tracking, `--ink-3`. Prose measure capped at 68ch. `text-wrap: balance` on headings.

Money: `font-variant-numeric: tabular-nums`, always two decimals, always signed when it can go negative.

## Layout

- **App shell:** fixed left rail (`208px`, `--bg-raised`, collapses to icons below 1100px and to a top sheet below 780px), single scrolling content column. No nested scroll regions.
- **Grid:** 12 columns, `--gutter: 20px`, content max-width 1280px. Detail screens use a 8/4 split — record on the left, decision context on the right.
- **The no-cards rule.** Regions are separated by whitespace and a single hairline `--rule`, not by bordered rounded containers. A bordered surface is permitted only when the thing genuinely floats: dropdown, popover, dialog, toast. **Nested bordered surfaces are prohibited without exception.**
- Spacing scale (px): 2, 4, 8, 12, 16, 24, 32, 48, 64. Vary it; do not apply one gap everywhere.
- Radius: `--r-sm: 3px` (inputs, buttons), `--r-md: 6px` (floating surfaces). Nothing is a pill. Nothing is a 16px blob.
- Shadow: exactly one, for floating surfaces only — `0 8px 24px -8px oklch(0.17 0 0 / 0.18)`. Resting elements have no shadow.
- z-index scale: `--z-sticky: 10`, `--z-dropdown: 20`, `--z-backdrop: 30`, `--z-modal: 40`, `--z-toast: 50`.

## Components

Consistent vocabulary; every interactive element ships default / hover / focus-visible / active / disabled / loading.

- **Buttons:** three variants only — `primary` (ink fill, inverse text), `secondary` (hairline border, transparent), `ghost` (text). One height (32px), one radius. Destructive is `secondary` with `--negative` text.
- **Tables** are the workhorse. Sticky header on `--bg-raised`, hairline row rules, zebra off by default, row hover `--bg-sunken`, selected row `--signal-wash`. Numeric columns right-aligned and monospaced. Row is a link target; no separate "view" button column.
- **Definition lists**, not cards, for record detail: label in `--text-xs`/`--ink-3` above value in `--text-base`/`--ink`, laid out on the grid.
- **Wizard:** a horizontal step rail with numbered steps, completed steps clickable, current step marked by a `--signal` underline plus the accessible-name suffix "current step". Never a modal.
- **Status pill:** text only, `--text-2xs` uppercase tracked, with a 6px square `--signal`/`--negative` dot where the status is exceptional. No background fill except for *Referred* and *Overdue*.
- **Empty states** teach: one sentence naming what will appear here, plus the action that creates the first one.
- **Loading:** skeleton rows matching final row height. No centred spinners.

## Motion

150–200ms, `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart). Motion reports state and nothing else: wizard step advance (12px slide + fade), row expand, toast entry, focus ring. No page-load choreography, no scroll reveals, no bounce.

`@media (prefers-reduced-motion: reduce)`: all transforms removed, duration to 1ms for movement, opacity crossfades retained at 100ms.
