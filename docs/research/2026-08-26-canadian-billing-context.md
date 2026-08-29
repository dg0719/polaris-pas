# Canadian P&C billing — regulatory, tax and payments context

Gathered 2026-08-26 for the Polaris billing design. Verified against the
cited primary sources where they could be read; items marked
**[unverified]** could not be confirmed from a primary source and must be
checked before they are written into product configuration.

## 1 · Cancellation for non-payment

### Ontario automobile — OAP 1 s.1.7, O. Reg. 777/93

Ontario auto has its own, longer non-payment regime.

| Delivery | Notice | Clock starts |
|---|---|---|
| Registered mail | **30 days** | second day after mailing |
| Personal delivery | **10 days** | delivery |
| Prepaid courier | **10 days** | delivery |
| Electronic (with recorded consent) | **10 days** | sending |

- **Cure right.** The notice must say the insured may pay the arrears
  **plus an administration fee** until **noon on the business day before
  the last day** of the period; otherwise the policy cancels at 12:01 a.m.
  on the last day. Paying in time keeps the policy in force uninterrupted.
- **Repeat non-payment.** Once **two** non-payment notices have been given
  in the term, a further non-payment allows cancellation on **15 days by
  registered mail / 5 days personal** with no obligation to accept late
  payment or reinstate. Model as a per-term notice counter.
- Other insurer cancellations: 15 days registered (clock: day after receipt
  at the post office) / 5 days personal. Courts put the burden of proving
  delivery on the insurer; an unclaimed registered letter does not defeat
  the insured — store mailing date, method, computed effective date and
  tracking evidence on every notice.
- **Refund:** insurer cancels (including non-payment) → **pro rata**;
  insured cancels → **short rate** (the insurer's filed table, roughly 1–8%
  of premium). Non-payment cancellation usually leaves a **balance owing**
  (earned > paid), a receivable to collect, not a refund.
- **Renewal / non-renewal notice:** at least 30 days before expiry
  (Insurance Act s.236); some secondary sources say 45 **[unverified]**.
- Electronic delivery of notices requires per-insured consent.

### Ontario property and most provinces — Statutory Condition 5

Insurer: 15 days registered mail (day after receipt at the post office) or
5 days personal; insured: any time. Insurer terminates → pro rata; insured
terminates → short rate. No special non-payment regime and no statutory cure
right (most carriers offer one contractually).

### Other provinces

| Province | Auto | Property |
|---|---|---|
| Alberta | SPF 1 (2021): 15 days by "recorded mail" (any tracked mail) or 5 days personal, from delivery to the insured's address; pro rata / short rate | Stat. Cond. 5 |
| Quebec | Civil Code art. 2477: 15 days after **receipt**; after the first 60 days only for non-payment or material change, effective 30 days after receipt; non-renewal 30 days; art. 2479 refund day-by-day (insurer) or short-term rate (insured). AMF 2025 notice content **[unverified]** | Art. 2477 |
| British Columbia | Private carriers sell only optional/excess cover | Stat. Cond. 5, clock from delivery to the address |
| Nova Scotia | Auto: **30 days registered** (second day after mailing), 5 days personal or electronic | Stat. Cond. 5 |
| NB, PEI, NL | Stat. Cond. 5; whether auto forms carry a 30-day non-payment period **[unverified]** | Stat. Cond. 5 |
| Manitoba, Saskatchewan | Public basic auto; private extension cover only | Stat. Cond. 5 |

Design conclusion: cancellation = `{ reason, deliveryMethod, sentDate,
receiptOrPresumedDate, noticeDays, effectiveDate, refundBasis, cureDeadline,
adminFee }`, with notice days, clock rule (mailing+2 / post-office receipt+1
/ delivery / receipt) and refund basis as product configuration.

## 2 · Premium taxes on the invoice

Two layers, never confused: **insurer-paid premium tax** (2–5% of gross
premium, an insurer expense, never an invoice line) and **retail sales tax
on premiums** charged to the insured:

| Province | Rate | Auto | Home | Commercial / liability |
|---|---|---|---|---|
| Ontario | 8% RST | **Exempt** | Taxable | Taxable |
| Quebec | 9% → **9.975% from 1 Jan 2027**, by payment date | Taxable | Taxable | Taxable |
| Manitoba | 7% RST | Exempt | Possibly exempt after Bulletin 061 (2020) **[unverified]** | Liability taxable |
| Saskatchewan | 6% PST | Taxable | Taxable | Taxable |
| Newfoundland & Labrador | 15% RST | Exempt | Exempt (2022) | Taxable |
| BC, AB, NB, NS, PEI, territories | none | | | |

GST/HST never applies to premiums. Rules for the engine (Ontario is the most
explicit): tax is due when the premium is paid and applies to each
installment, not to a reasonably priced, separately shown installment
charge; late, NSF and financing fees are not taxable; tax refunds
proportionally with premium; NL requires a separate line (treat as the
norm); multi-jurisdiction policies are taxed on the in-province portion, so
tax is computed per line by risk location; Quebec's rate table must be
effective-dated by payment date.

## 3 · Payments

### Pre-authorized debit — Payments Canada Rule H1

- The PAD agreement must contain: date and authorization, account to debit,
  category (personal for individuals), amount or how it is determined,
  timing, cancellation procedure, payee contact, recourse statement. Store
  the agreement, date, channel and masked account.
- **Pre-notification:** 10 calendar days before the first PAD and before any
  change of amount or date; waivable with prominent agreement wording; if
  waived for the first PAD, confirmation within 5 days after it. Fixed
  recurring PADs need no further notice; a differing first/last installment
  or an endorsement change triggers a new notification unless waived.
- **NSF re-presentment:** once, within 30 days, for the exact same amount.
- **Return codes** (confirm against Rule H1 Appendix II **[unverified]**):
  901 NSF, 902 account not found/closed, 903 stopped/recalled, 905 closed,
  907 no debit allowed, 908 funds not cleared, 910 payor deceased, 912 not
  per agreement, 914 incorrect payor name, 915–922 disputes.
- **Disputes:** personal PADs reversible by the FI within 90 calendar days
  (10 business days for business PADs).
- Cancelling the PAD does not cancel the debt or the policy. Funds are
  provisional until the return window passes; a "paid" installment must be
  reversible.

### Cards, e-Transfer, cheque, EFT

- Credit-card surcharging (outside Quebec) up to the lesser of cost or 2.4%,
  registered 30 days ahead, disclosed; debit/prepaid cannot be surcharged;
  **Quebec prohibits it**. Most carriers do not surcharge. Store processor
  tokens only; chargebacks up to 120 days.
- Interac e-Transfer: per-FI send limits, no receive limit; used for one-off
  payments and refunds.
- Cheques hold 4–5 business days (up to 7–8 over $1,500); an NSF cheque
  returns after that.
- EFT/direct deposit for refunds and producer payments.

### NSF fees

Bank NSF fees are capped at $10 from 12 Mar 2026 (federal deposit accounts)
— this does **not** restrict biller fees. Insurer returned-payment fees are
contractual, typically $25–$50; Ontario auto fees must be filed with FSRA.

## 4 · Brokers, commission, trust accounting

- Independent brokers dominate Canadian P&C. Regulators: RIBO (Ontario), AIC
  (Alberta), Insurance Council (BC), AMF/ChAD (Quebec).
- **Direct bill** is the norm for personal lines. **Agency bill** (broker
  invoices, holds premium in trust, remits net of commission on a monthly
  statement) is common in commercial lines; remittance 30–60 days after
  month end; exact Canadian norm **[unverified]**.
- **RIBO trust rules** (Reg. 991 s.16): premiums are trust money in a
  designated trust account; no cross-client use; commission withdrawn only
  when earned; annual Form 1 position report; financed premiums outstanding
  beyond 90 days deducted. Failure to refund monies owed **including
  premium sales tax** is misconduct — the insurer's statement must show tax
  separately.
- **Commission rates:** personal auto 10–12.5% (statistical average 7.85%
  in 2022), personal property 15–20% (average 11.4%), commercial property
  20–25%, commercial liability 10–25%. Rates are broker-contract
  configuration with effective dates, new versus renewal, and proportional
  reversal on cancellation.
- **Contingent profit commission:** an annual bonus by loss ratio, growth,
  retention and volume, computed from aggregates and disclosed — a
  downstream report, not the per-policy stream.
- **Premium financing** (FIRST Insurance Funding, IFS, CAFO): the finance
  company pays the insurer the full premium, collects from the insured with
  interest, holds a power of attorney to cancel on default (10 days'
  notice in practice), takes an assignment of unearned premium that must be
  notified to the insurer, and receives any return premium. Billing needs a
  finance-company payer, assignment on file, return premium routed to the
  assignee, finance-company-originated cancellation, and notices to both.

## 5 · Other invoice components

| Fee | Ontario auto | Elsewhere |
|---|---|---|
| Installment charge | **Capped at 1.3% of premium** for 12-month terms (0.65% for 6–12, 0.22% under 6), blended principal and interest (Reg. 664; section number **[unverified]**) | Unregulated; ~3% typical |
| Returned-payment fee | Permitted if filed; $25–$50 | Contractual |
| Late fee | Not customary; acceptability of a filed late fee **[unverified]** | Rare |
| Reinstatement / non-payment admin fee | Contemplated by OAP 1; amount filed | Contractual |
| Cancellation fee | Only via short rate; some insurers file an admin fee | Short rate |
| Policy fee | Not outside the filed rate | Common in commercial |

Every consumer-facing fee in Ontario auto must exist in configuration with a
filing reference; the system should refuse an unfiled fee code on an auto
policy. Fees are outside premium: not taxable, not commissionable, not in
written premium.

## 6 · Accounting and reporting

- Written premium booked at issue; earned daily pro rata; unearned is a
  liability. IFRS 17 (from 2023) under the premium allocation approach wants
  the liability for remaining coverage based on **premiums received**, net
  of commission — finance needs written/earned by transaction *and* cash by
  contract with dates.
- OSFI P&C-1 wants direct written premium by province and class (page
  93.30) and receivables from agents and brokers with large counterparties
  listed (page 50.20); provincially incorporated carriers file the same.
- Receivables ageing 0–30 / 31–60 / 61–90 / 90+ by payer type; balances
  over 90 days are treated as non-admitted for capital **[unverified]**.
- Agency bill creates broker balances ("premium in transit") that must stay
  separate from policyholder receivables and reconcile to statements.
- Retail sales tax collected is a liability remitted monthly (Ontario: on
  premium paid), not revenue.
- Ledger requirement: append-only journal with sub-ledgers for premium
  receivable, unearned premium, commission payable, tax payable, cash
  clearing by method and unapplied cash; balanced entries per transaction;
  reversals with reasons.

## 7 · Customer-facing norms

A personal-lines bill shows policy number, term, named insured, broker,
premium by vehicle/coverage or location, provincial tax as a separate line
where applicable, installment charge separately, total, payment schedule,
payment method on file and notice text; Quebec bills are French-first. The
dominant plan is 12 monthly PADs; new business often takes two months down
and ten installments; renewals roll 1/12. Renewal offers go out 45–60 days
before expiry (30 statutory). Endorsement changes re-spread over remaining
installments and trigger PAD pre-notification unless waived. Refunds in 2–4
weeks to the original method, or to the finance company. Collections start
only after cancellation leaves a balance, typically 30–60 days then agency.

## 8 · Glossary

Pro rata · Short rate (Quebec: short-term rate) · Minimum retained premium ·
Statutory conditions · OAP 1 · SPF No. 1 / Q.P.F. No. 1 · Registered /
recorded mail notice · Cure period and arrears · PAD (PAC) · Pre-notification
· NSF · RST / PST / IPT / QST · RIBO and Form 1 · FSRA · AMF · OSFI · Direct
bill / agency bill · Statement of account · Contingent profit commission ·
Premium finance agreement · Written / earned / unearned premium · PAA ·
P&C-1.

## Sources

FSRA (OAP 1, standard filing and rating guidance, consumer pages); O. Reg.
777/93 and R.R.O. 1990 Reg. 664 on CanLII; Ontario Insurance Act s.148 and
s.236; Ontario Retail Sales Tax — Insurance and Benefits Plans; Revenu Québec
tax on insurance premiums and the 2026 harmonization notice; Manitoba
Finance Bulletin 061; Saskatchewan PST-73; NL RST FAQ; Civil Code of Québec
arts. 2477–2479; ChAD; Alberta SPF 1 (2021); BC Insurance Act; Nova Scotia
mandatory conditions; TD Insurance statutory conditions wording; Payments
Canada Rule H1 and PAD guides; McMillan and McCarthy commentary on H1;
Mastercard/Visa/CFIB surcharge rules; CRA GI-200; FCAC cheque-hold rules;
Torys and Canada Gazette SOR/2025-96 on NSF fee caps; RIBO Reg. 991,
position-report guidelines and premium-financing guidance; Insurance
Business and Insurance Institute commission surveys; Smythe brokerage
report; FIRST Insurance Funding, IFS, CAFO; McMillan on assignment of
unearned premium; CIA and CAS IFRS 17 notes; OSFI P&C-1 instructions.
