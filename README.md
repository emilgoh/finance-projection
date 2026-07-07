# Wealth Projection

A small, dependency-free website for tracking your finances today and projecting
your wealth into the future. Enter what you own, your income and spending, and a
few assumptions — it shows your projected net worth year by year, when you reach
financial independence, and whether your money lasts through retirement.

Everything runs in the browser; your data is saved to local storage and never
leaves your machine.

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
  with a retirement marker, crosshair tooltip (mouse or arrow keys), and
  automatic light/dark theme.
- **Table view** — the same projection as year-by-year figures: net worth,
  today's-money value, amount saved or withdrawn, and investment growth.

## The model

Annual steps, deliberately simple:

- Your full net worth compounds at the stated investment return.
- While working, yearly savings (income − spending) are added; income grows at
  its own rate and spending rises with inflation.
- From retirement age on, that year's inflation-adjusted retirement spending is
  withdrawn instead. If the balance hits zero it stays there (no borrowing).
- "Today's money" divides nominal values by cumulative inflation.

This is a rough planning model, not financial advice — it ignores taxes,
sequence-of-returns risk, and asset allocation.

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
