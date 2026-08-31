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
./serve.py            # or: .venv/bin/python serve.py
# then open http://localhost:8000
```

(A server is needed because the JavaScript uses ES modules, which browsers block
on `file://` URLs. It also deploys as-is to GitHub Pages or similar.)

`serve.py` is `python3 -m http.server` with caching switched off. That matters:
the plain module sends no cache headers, so browsers fall back to *heuristic*
caching and keep serving an edited `js/app.js` from disk for days without ever
revalidating. The page then renders new markup against old JavaScript, which
looks exactly like a broken feature. If you have already been bitten, one hard
reload (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) clears the stale
entry.

To work on it you also need Node, for the tests. `setup.sh` provisions both
tools without touching anything outside the project — a Python virtual
environment in `.venv/`, and, only if the system Node is missing or older than
v20, a project-local Node in `.tools/node/`:

```sh
./setup.sh
```

It finishes by running the test suite. `rm -rf .venv .tools` undoes all of it.

## What it shows

The app has two pages, switched from the tabs under the title and addressed by
the URL hash — `#/projection` and `#/tracker`, so either can be bookmarked.

### Projection

- **Hero figure** — projected net worth at your retirement age, nominal and in
  today's money.
- **Stat tiles** — your financial-independence target (25× yearly retirement
  spending, the 4% rule), the age you reach it, peak net worth, and whether your
  money lasts to the end of the plan.
- **Interactive chart** — net worth over time, nominal and inflation-adjusted,
  with a retirement marker and a crosshair tooltip (mouse or arrow keys).
- **Table view** — the same projection as year-by-year figures: net worth,
  today's-money value, CPF balance, amount saved or withdrawn, and investment
  growth.

### Monthly tracker

- **Spending categories** — optionally split your spending, with a budget
  against each category. Leave it empty to log a single total each month.
- **Monthly spending log** — log what you actually spent each month, split by
  those categories, and see it against your budget. Overspend shows as `+`, an
  underspend as `−`.
- **Forecast from your actuals** — a checkbox swaps the projection's spending
  assumption from the figure in your plan to the average of every month you have
  logged. Until a completed month exists it falls back to the plan figure and
  says so. Retirement spending is a separate, forward-looking assumption and is
  never affected.

### On both pages

- **Light & dark mode** — follows your system by default; the sun/moon button
  in the top-right corner switches theme, and the choice is remembered.
- **Backups** — export everything to a JSON file and import it back, to move
  between browsers or keep a copy.

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
- One-off **life events** (wedding, home down payment, kids' university) are
  entered in today's money at a given age; each is inflated to that year and
  spent from liquid savings when it lands. A large enough one in retirement can
  deplete savings.
- "Today's money" divides nominal values by cumulative inflation.
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

## Project layout

```
index.html            page structure
styles.css            theme (light/dark), layout, chart chrome
js/projection.js      pure projection engine (no DOM)
js/expenses.js        pure month/variance/average helpers (no DOM)
js/state.js           state shape, persistence, sanitising (no DOM)
js/router.js          hash routing between the two pages (no DOM)
js/chart.js           interactive SVG chart renderer
js/app.js             inputs, spending log, tiles, table — the DOM layer
tests/                engine, spending-log, state and router tests
serve.py              dev server with caching disabled
setup.sh              provisions the local toolchain (venv + Node)
docs/TODO.md          known gaps, deferred work, and decisions made on purpose
```

## Tests

```sh
node --test                      # or .tools/node/bin/node --test after setup.sh
```
