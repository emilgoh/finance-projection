# Wealth Projection

A small, dependency-free website for tracking your finances today and projecting
your wealth into the future — built with a Singapore context (CPF, SGD) but
usable anywhere. Enter what you own, your income and spending, and a few
assumptions — it shows your projected net worth year by year, when you reach
financial independence, and whether your money lasts through retirement.

Everything runs in the browser; your data is saved to local storage and never
leaves your machine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="Wealth Projection: plan inputs, accounts, projected net worth at retirement, stat tiles, and a net-worth-over-time chart">
</picture>

## Running it

It's a static site — no build step, no dependencies. Serve the folder and open it:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Any static file server works; it also deploys as-is to GitHub Pages or similar.
A server is needed because the JavaScript uses ES modules, which browsers block
on `file://` URLs.)

## What it shows

- **Hero figure** — projected net worth at your retirement age, nominal and in
  today's money.
- **Stat tiles** — your financial-independence target (25× yearly retirement
  spending, the 4% rule), the age you reach it, peak net worth, and whether your
  money lasts to the end of the plan.
- **Interactive chart** — net worth over time, nominal and inflation-adjusted,
  with a retirement marker and a crosshair tooltip (mouse or arrow keys).
- **Light & dark mode** — follows your system by default; the sun/moon button
  in the top-right corner switches theme, and the choice is remembered.
- **Life events** — one-off big expenses (wedding, home down payment, kids'
  university) entered in today's money at a given age; each is inflated and
  spent from savings in the year it lands.
- **Import / export** — download all your data as a JSON file and load it back
  later or on another device (footer links). Old export shapes are migrated on
  import.
- **Table view** — the same projection as year-by-year figures: net worth,
  today's-money value, CPF balance, amount saved or withdrawn, and investment
  growth.

## The model

Annual steps, deliberately simple:

- Savings outside CPF compound at the stated investment return.
- Income is entered **gross** (before CPF and tax); the employee's age-banded
  CPF share and Singapore resident income tax are deducted automatically to
  get take-home pay (each can be toggled off).
- While working, yearly savings (take-home income − spending) are added; income
  grows at its own rate and spending rises with inflation.
- From retirement age on, that year's inflation-adjusted retirement spending is
  withdrawn instead (net of CPF LIFE payouts once they start). If liquid
  savings hit zero they stay there (no borrowing).
- "Today's money" divides nominal values by cumulative inflation.
- Life events are one-off outflows from liquid savings, inflated from today's
  money to the year they occur. A house purchase is modelled as the cash you
  part with (e.g. the down payment) — the property doesn't come back as an
  asset (see TODO).
- Financial independence is measured against assets *outside* CPF, since CPF is
  locked until the payout age.

### Income tax (Singapore)

Resident progressive rates (YA 2026 schedule, 0% on the first S$20,000 up to
24% above S$1M) are applied to employment income while working. Chargeable
income deducts the employee's CPF contributions and the S$1,000 earned income
relief; other reliefs aren't modelled. CPF LIFE payouts and investment gains
are untaxed, as in Singapore, so retirement years carry no tax. Brackets are
held constant in nominal terms.

### CPF (Singapore)

The optional CPF module models the Central Provident Fund with 2026 rules:

- **Contributions** — worked out automatically from your gross income: total
  (employer + employee) rates on pay up to the S$8,000/month Ordinary Wage
  ceiling are 37% up to age 55, then 34% (55–60), 25% (60–65), 16.5% (65–70),
  and 12.5% after 70, while you work. The employee's share of that (20%,
  stepping down to 5% by the same age bands) comes out of gross pay; the
  employer's share is on top.
- **Interest** — 2.5% on the Ordinary Account, 4% on Special Account and
  MediSave (the floor rates).
- **CPF LIFE** — at 65, OA+SA up to the Enhanced Retirement Sum (S$440,800) is
  annuitized into a lifelong monthly payout, estimated at ~9.7% of the
  annuitized sum per year (the Standard plan's FRS estimate: S$220,400 →
  ~S$1,780/month). Anything above the ERS becomes withdrawable. The unused
  premium counts toward net worth as it amortizes, mirroring the plan's
  bequest refund.

Simplifications, in the interest of staying understandable: 2026 ceilings and
retirement sums are held constant in nominal terms (they rise over time in
reality); contribution allocation uses the under-35 OA/SA/MA split at every
age; the extra 1% interest on the first S$60,000 and the MediSave cap (BHS)
are ignored.

This is a rough planning model, not financial advice — it also ignores
sequence-of-returns risk and asset allocation.

CPF parameters (in `js/projection.js`) are based on:
[CPF contribution rates from 1 Jan 2026](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay) ·
[2026 retirement sums and payout estimates](https://www.cpf.gov.sg/service/article/what-is-the-current-enhanced-retirement-sum) ·
[senior-worker rate changes](https://www.cpf.gov.sg/service/article/what-are-the-changes-to-the-cpf-contribution-rates-for-senior-workers-from-1-january-2026)

## TODO — what the model doesn't cover yet

Roughly in order of how much they'd change the numbers:

- [ ] **Housing as an asset, not just an expense** — a home purchase should add
  a property to net worth with a mortgage against it (repayments, interest,
  appreciation), and support using CPF OA for housing. Today a purchase is
  only the cash leaving your savings.
- [ ] **Per-account returns / asset allocation** — cash, brokerage, and SRS all
  compound at one blended rate; idle cash earning ~0% and equities earning
  more should diverge.
- [ ] **SRS modelling** — contributions should reduce chargeable income (tax
  relief), and withdrawals from 63 are 50% taxable; today SRS is just another
  account.
- [ ] **Windfalls / income events** — one-off inflows (inheritance, bonus,
  sale) as the positive twin of life events; recurring multi-year costs
  (children's education) too.
- [ ] **Scenario bands** — optimistic/pessimistic return spread around the
  projection, or Monte Carlo for sequence-of-returns risk; a single fixed
  return flatters retirement drawdown.
- [ ] **Parameter indexation** — CPF ceilings, retirement sums, BHS, and tax
  brackets are held at 2026 values; in reality they rise, which matters over
  a 60-year projection.
- [ ] **CPF fine detail** — extra 1% interest on the first S$60,000, MediSave
  cap (BHS) with overflow to SA, age-based allocation shifts, withdrawal of
  savings above the FRS at 55, and CPF LIFE plan choice
  (Standard/Escalating/Basic).
- [ ] **More tax reliefs** — spouse/child/parent reliefs, CPF top-up and SRS
  reliefs, and the S$80,000 relief cap; only earned-income and CPF reliefs
  count today.
- [ ] **Couples / joint planning** — two incomes, two CPF accounts, shared
  expenses and events.
- [ ] **Event markers on the chart** — label life events on the timeline so a
  dip is self-explanatory.

## Project layout

```
index.html            page structure
styles.css            theme (light/dark), layout, chart chrome
js/projection.js      pure projection engine (no DOM)
js/chart.js           interactive SVG chart renderer
js/app.js             state, persistence, inputs, tiles, table
tests/                engine tests
```

## Tests

```sh
node --test tests/projection.test.mjs
```
