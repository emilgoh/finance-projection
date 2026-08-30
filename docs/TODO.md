# TODO

Ranked by priority. The ranking weighs risk to real data and to correctness
above polish, and favours small changes with lasting payoff. Each item says why
it sits where it does.

## Now

**1. Extract state and persistence into a testable module.**
`js/app.js` is 938 lines and 47 functions covering state, persistence,
sanitising, three render trees, month navigation and file I/O. It is the only
untested file that touches saved data, and **every one of the nine bugs found in
the code review of the tracker work lived in it** — including one where an
imported backup could be persisted and then throw on every subsequent load.
That combination, highest bug density plus custody of the user's data plus zero
coverage, is what puts it first. The cut: a pure `js/state.js` holding
`DEFAULT_STATE`, `loadState`/`mergeSaved`/`saveState` and the three `sanitise*`
helpers, no DOM, tested the way `projection.js` and `expenses.js` already are.

**2. Add CI.**
There is no `.github/` at all, so nothing runs `node --test` on push. Roughly
fifteen lines of YAML — `actions/setup-node` plus `node --test` — and it then
guards every future change for free. Ranked this high purely on effort-to-payoff;
it is the cheapest item in the file. Worth doing right after item 1, so the new
tests it protects actually exist.

## Next

**3. Make backups harder to forget.**
*(Added while ranking — it was missing and it is the largest user-facing risk.)*
Everything lives in one browser's local storage. Clearing site data destroys
months of logging, and nothing prompts an export. The logging habit only just
started, so the exposure grows from here. The cheap version is a line in the
footer — "last backup: 3 months ago" — driven by a stored timestamp, not
automatic uploads or a sync backend.

**4. Per-month notes.**
"Why was June high?" is the obvious next question the log provokes and currently
cannot answer. One optional free-text field per month entry covers it. Ranked
above the other features because it is the one the tracker's own output leads
you to ask.

**5. Refresh `docs/screenshot-light.png` and `docs/screenshot-dark.png`.**
They predate the categories card, the monthly log and the backup controls, and
the README leads with them. Zero functional risk, which is why it sits below the
work above — but it is quick, and it is the first thing any reader sees.

## Later, or only on demand

**6. Bulk entry.**
Backfilling a year means twelve rounds of stepping and typing. A CSV paste or
import would fix that. Deliberately low: it only matters if someone actually
backfills, and nobody has yet. Promote it the moment that changes.

**7. A spend-history visual.**
Left out by design — the variance table answers "which category am I over on,
and by how much" better than a chart would, and a per-category breakdown needs
5–8 hues when only `--series-nominal` and `--series-real` exist. If wanted, the
cheap correct version is a single-series sparkline of the monthly total across
the last 12 logged months with a dashed budget reference line: one hue plus
`--baseline`, no new tokens.
Prerequisite: `bindViewToggle()` is hardcoded to two buttons and two panes and
must be generalised before a third tab can exist.

**8. A DOM test harness.**
`app.js` and `chart.js` have no automated coverage; both are verified by hand.
Last because it is the only item that would add a dependency (jsdom or a
headless runner) to a project that has deliberately had none — and because doing
item 1 first shrinks the untested surface enough that this may never be worth
it. Reassess only after the pure parts are extracted.

---

## Gotchas — resolved, don't regress

Not tasks. Traps already hit once, recorded so they are not reintroduced.

- **Serve with `./serve.py`, never `python3 -m http.server`.** The plain module
  sends no cache headers, so browsers fall back to heuristic caching and keep
  serving an edited `js/app.js` from disk for days without revalidating. The
  page then renders new markup against old JavaScript — indistinguishable from a
  broken feature, and a normal reload does not clear it (only
  <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> does). `serve.py` sends
  `no-store`.

- **The test command is bare `node --test`.** `node --test tests/` fails on Node
  24 — it resolves the directory as a module instead of globbing it. The README
  and `setup.sh` are correct; this note exists for anyone tempted to
  "helpfully" add the path back.

## Deliberate decisions — change only on purpose

These read like bugs and are not.

- **Category budgets are allowed to disagree with the plan's monthly spending
  figure.** The plan figure is the budget of record and the only one that
  reaches the projection; category budgets drive their own variance rows only.
  The mismatch surfaces as a quiet hint, never an error, and neither number
  auto-corrects the other.

- **Retirement spending is never driven by logged actuals.** It is a
  forward-looking choice about a different life phase, not something this
  month's groceries should move. The forecast hint says so explicitly.

- **The in-progress current month is excluded from the actuals average.**
  Otherwise logging S$200 on the 3rd would tank the forecast every time the app
  is opened early in a month.

- **Deleting a category with logged history archives it rather than removing
  it.** Past months keep their names and their totals never shift underneath the
  user. Amounts belonging to ids with no live category still count toward month
  totals and render as "Uncategorised".

- **`js/projection.js` is annual and has no month concept.** The tracker feeds it
  a single derived `annualExpenses` scalar. Making the engine monthly would mean
  re-deriving CPF bands, the OW ceiling, the tax schedule, interest crediting and
  the CPF LIFE conversion at monthly granularity — every rule in the file — for
  no accuracy gain, since those rules are annual anyway.

- **`STORAGE_KEY` stays at `wealth-projection-v3`.** The tracker's additions are
  purely additive, so old blobs merge cleanly over `DEFAULT_STATE`. If the shape
  ever breaks, bump the suffix and follow the existing legacy-transform pattern
  in `loadState()`.

## Pre-existing model simplifications

Documented in the README already, listed here so they are not mistaken for
oversights: CPF ceilings and retirement sums are held flat in nominal terms;
extra interest on the first S$60,000 and MediSave caps are ignored; income tax
counts only CPF and earned-income reliefs; CPF LIFE payouts and investment gains
are untaxed; sequence-of-returns risk and asset allocation are not modelled.
