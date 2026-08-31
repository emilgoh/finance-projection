import { project, CPF, TAX } from "./projection.js";
import { renderChart } from "./chart.js";
import {
  OTHER_ID, monthKey, addMonths, formatMonth,
  activeCategories, categoryBudgetTotal,
  isLogged, loggedMonths, monthVariance, effectiveExpenses,
} from "./expenses.js";
import { PAGES, pageFromHash, startRouter } from "./router.js";
import {
  DEFAULT_STATE, ACCOUNT_TYPES,
  loadState, writeState, clearState, mergeSaved, newId, backupHint, sanitiseTimestamp,
} from "./state.js";

let state = loadState(localStorage);
let disposeChart = () => {};
// Which month the log is showing. Deliberately not persisted: opening the app in
// December should show December, not wherever you last browsed to.
let selectedMonth = monthKey(new Date());
// Which of the two pages is on screen. The hash is the source of truth; this
// mirrors it so recompute() knows whether the chart can be measured.
let currentPage = pageFromHash(location.hash);
// Set when a projection input changes while the projection page is hidden.
let resultsStale = false;

/* ---------- persistence ---------- */
function saveState() {
  writeState(localStorage, state);
}

/* ---------- formatting ---------- */
function fmtCompact(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const cur = state.currency;
  if (abs >= 1e9) return `${sign}${cur}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${cur}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${cur}${trim(abs / 1e3)}K`;
  return `${sign}${cur}${Math.round(abs)}`;
}
const trim = (n) => (n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)).toString().replace(/\.0+$/, "");

function fmtFull(v) {
  const sign = v < 0 ? "−" : "";
  return `${sign}${state.currency}${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

/* ---------- plan inputs ---------- */
const PLAN_FIELDS = [
  "currentAge", "retirementAge", "endAge", "monthlyGrossIncome", "monthlyExpenses",
  "monthlyRetirementSpend", "returnRate", "inflationRate", "incomeGrowthRate",
];

function bindPlanInputs() {
  for (const key of PLAN_FIELDS) {
    const input = document.getElementById(`in-${key}`);
    input.value = state[key];
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) {
        state[key] = v;
        saveState();
        recompute();
      }
    });
  }
  const taxCheck = document.getElementById("in-includeTax");
  taxCheck.checked = state.includeTax;
  taxCheck.addEventListener("change", () => {
    state.includeTax = taxCheck.checked;
    saveState();
    recompute();
  });
  const actualsCheck = document.getElementById("in-useActualsForForecast");
  actualsCheck.checked = state.useActualsForForecast;
  actualsCheck.addEventListener("change", () => {
    state.useActualsForForecast = actualsCheck.checked;
    saveState();
    recompute();
  });
  const currency = document.getElementById("in-currency");
  currency.value = state.currency;
  if (currency.value !== state.currency) currency.value = "S$"; // unknown saved symbol
  currency.addEventListener("change", () => {
    state.currency = currency.value;
    saveState();
    recompute();
    renderAccounts();
    renderBudget();
    renderLog();
  });
}

/* ---------- CPF ---------- */
const CPF_FIELDS = [
  ["in-cpfOa", "oa"],
  ["in-cpfSa", "sa"],
  ["in-cpfMa", "ma"],
];

function bindCpfInputs() {
  const enabled = document.getElementById("in-cpfEnabled");
  enabled.checked = state.cpf.enabled;
  enabled.addEventListener("change", () => {
    state.cpf.enabled = enabled.checked;
    saveState();
    syncCpfUI();
    updateAccountsTotal();
    recompute();
  });
  for (const [id, key] of CPF_FIELDS) {
    const input = document.getElementById(id);
    input.value = state.cpf[key];
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      state.cpf[key] = Number.isFinite(v) ? v : 0;
      saveState();
      updateAccountsTotal();
      recompute();
    });
  }
  syncCpfUI();
}

function syncCpfUI() {
  const on = state.cpf.enabled;
  document.getElementById("cpf-fields").classList.toggle("cpf-disabled", !on);
  for (const [id] of CPF_FIELDS) document.getElementById(id).disabled = !on;
  document.getElementById("cpf-total-line").hidden = !on;
  updateCpfTotal();
}

function cpfTotalToday() {
  const { oa, sa, ma } = state.cpf;
  return (oa || 0) + (sa || 0) + (ma || 0);
}

function updateCpfTotal() {
  document.getElementById("cpf-total-value").textContent = fmtFull(cpfTotalToday());
}

/* ---------- accounts ---------- */
function renderAccounts() {
  const list = document.getElementById("accounts-list");
  list.textContent = "";
  state.accounts.forEach((acct, i) => {
    const row = document.createElement("div");
    row.className = "account-row";

    const name = document.createElement("input");
    name.type = "text";
    name.value = acct.name;
    name.placeholder = "Account name";
    name.setAttribute("aria-label", "Account name");
    name.addEventListener("input", () => {
      acct.name = name.value;
      saveState();
    });

    const type = document.createElement("select");
    type.setAttribute("aria-label", "Account type");
    for (const t of ACCOUNT_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      type.append(opt);
    }
    type.value = ACCOUNT_TYPES.includes(acct.type) ? acct.type : "other";
    type.addEventListener("change", () => {
      acct.type = type.value;
      saveState();
    });

    const value = document.createElement("input");
    value.type = "number";
    value.step = "100";
    value.value = acct.value;
    value.setAttribute("aria-label", `Value in ${state.currency}`);
    value.addEventListener("input", () => {
      const v = parseFloat(value.value);
      acct.value = Number.isFinite(v) ? v : 0;
      saveState();
      updateAccountsTotal();
      recompute();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${acct.name || "account"}`);
    remove.addEventListener("click", () => {
      state.accounts.splice(i, 1);
      saveState();
      renderAccounts();
      recompute();
    });

    row.append(name, type, value, remove);
    list.append(row);
  });
  updateAccountsTotal();
}

function accountsTotal() {
  return state.accounts.reduce((sum, a) => sum + (Number.isFinite(a.value) ? a.value : 0), 0);
}

function netWorthToday() {
  return accountsTotal() + (state.cpf.enabled ? cpfTotalToday() : 0);
}

function updateAccountsTotal() {
  document.getElementById("accounts-total-value").textContent = fmtFull(netWorthToday());
  updateCpfTotal();
}


/* ---------- spending categories ---------- */
function renderBudget() {
  const list = document.getElementById("budget-list");
  list.textContent = "";
  for (const cat of activeCategories(state.spendCategories)) {
    const row = document.createElement("div");
    row.className = "budget-row";

    const name = document.createElement("input");
    name.type = "text";
    name.value = cat.name;
    name.placeholder = "Category name";
    name.setAttribute("aria-label", "Category name");
    name.addEventListener("input", () => {
      cat.name = name.value;
      saveState();
      renderLog(); // the log labels rows by category name; keep them in step
    });

    const budget = document.createElement("input");
    budget.type = "number";
    budget.min = "0";
    budget.step = "50";
    budget.value = Number.isFinite(cat.budget) ? cat.budget : "";
    budget.placeholder = "Budget";
    budget.setAttribute("aria-label", `Monthly budget in ${state.currency}`);
    budget.addEventListener("input", () => {
      const v = parseFloat(budget.value);
      if (Number.isFinite(v)) cat.budget = v;
      else delete cat.budget;
      saveState();
      updateBudgetTotal();
      renderLog();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${cat.name || "category"}`);
    remove.addEventListener("click", () => removeCategory(cat));

    row.append(name, budget, remove);
    list.append(row);
  }
  updateBudgetTotal();
}

/**
 * Categories with logged history are archived rather than deleted, so past
 * months keep their names and their totals never shift under the user.
 */
function removeCategory(cat) {
  const logged = Object.values(state.spendLog).some((e) => Number.isFinite(e.byCategory?.[cat.id]));
  if (logged) {
    const label = cat.name || "this category";
    if (!confirm(`${label} has spending logged against it. Remove it from the list but keep that history?`)) return;
    cat.archived = true;
  } else {
    const i = state.spendCategories.indexOf(cat);
    if (i >= 0) state.spendCategories.splice(i, 1);
  }
  saveState();
  renderBudget();
  renderLog();
}

function updateBudgetTotal() {
  const line = document.getElementById("budget-total-line");
  const cats = activeCategories(state.spendCategories);
  if (cats.length === 0) {
    line.textContent = "";
    return;
  }
  const total = categoryBudgetTotal(state.spendCategories);
  let text = `Categories add up to ${fmtFull(total)} / month`;
  // The two figures are allowed to disagree — the plan figure is what forecasts.
  if (Math.abs(total - state.monthlyExpenses) >= 1) text += ` · your plan says ${fmtFull(state.monthlyExpenses)}`;
  line.textContent = text;
}

/* ---------- life events ---------- */

/**
 * One-off big expenses in today's money. The engine inflates each to the year
 * the age is reached, so what is typed here stays comparable to the plan
 * figures above it.
 */
function renderEvents() {
  const list = document.getElementById("events-list");
  list.textContent = "";
  for (const event of state.events) {
    const row = document.createElement("div");
    row.className = "event-row";

    const name = document.createElement("input");
    name.type = "text";
    name.value = event.name;
    name.placeholder = "Event (e.g. home down payment)";
    name.setAttribute("aria-label", "Event name");
    name.addEventListener("input", () => {
      event.name = name.value;
      remove.setAttribute("aria-label", `Remove ${event.name || "event"}`);
      saveState();
    });

    const age = document.createElement("input");
    age.type = "number";
    age.step = "1";
    age.min = "16";
    age.max = "120";
    age.value = event.age ?? "";
    age.setAttribute("aria-label", "At age");
    age.title = "At age";
    age.addEventListener("input", () => {
      // Cleared, or mid-typing garbage: null keeps the row editable and the
      // engine skips it, rather than silently spending in year zero.
      event.age = num(age.value, null);
      saveState();
      recompute();
    });

    const amount = document.createElement("input");
    amount.type = "number";
    amount.step = "1000";
    amount.min = "0";
    amount.value = event.amount;
    amount.setAttribute("aria-label", `Amount in today's ${state.currency}`);
    amount.addEventListener("input", () => {
      event.amount = Math.max(0, num(amount.value, 0));
      saveState();
      recompute();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove ${event.name || "event"}`);
    remove.addEventListener("click", () => {
      const i = state.events.indexOf(event);
      if (i >= 0) state.events.splice(i, 1);
      saveState();
      renderEvents();
      recompute();
    });

    row.append(name, age, amount, remove);
    list.append(row);
  }
}

/* ---------- monthly spending log ---------- */
function entryFor(key) {
  if (!state.spendLog[key]) state.spendLog[key] = { byCategory: {} };
  const entry = state.spendLog[key];
  if (!entry.byCategory) entry.byCategory = {};
  return entry;
}

/** Drop a month once nothing is left in it, so "logged" stays honest. */
function pruneMonth(key) {
  if (!isLogged(state.spendLog, key)) delete state.spendLog[key];
}

/**
 * How far back the log can be browsed: three years, or further if an imported
 * backup holds older months — those still feed the average, so they must stay
 * reachable.
 */
function earliestMonth() {
  const floor = addMonths(monthKey(new Date()), -36);
  const oldest = loggedMonths(state.spendLog)[0];
  return oldest && oldest < floor ? oldest : floor;
}

// Variance cells are refreshed in place as amounts are typed, so the inputs keep
// their focus and caret instead of being rebuilt on every keystroke.
let logVarianceCells = new Map();

function renderLog() {
  const thisMonth = monthKey(new Date());
  document.getElementById("log-month-label").textContent = formatMonth(selectedMonth);
  document.getElementById("log-next").disabled = selectedMonth >= thisMonth;
  document.getElementById("log-prev").disabled = selectedMonth <= earliestMonth();
  document.getElementById("log-today").hidden = selectedMonth === thisMonth;

  const { rows } = monthVariance(state.spendLog, selectedMonth, state.spendCategories, state.monthlyExpenses);
  const soloOther = rows.length === 1 && rows[0].id === OTHER_ID;
  const list = document.getElementById("log-list");
  list.textContent = "";
  logVarianceCells = new Map();
  if (!soloOther) list.append(logHeadRow());

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "log-row";

    const name = document.createElement("span");
    name.className = "log-name";
    name.textContent = soloOther ? "Total spent" : r.name;
    if (r.archived) {
      const tag = document.createElement("small");
      tag.textContent = " (removed)";
      name.append(tag);
    }

    const budget = document.createElement("span");
    budget.className = "log-budget";
    budget.textContent = r.budget === null ? "—" : fmtFull(r.budget);

    const spent = document.createElement("input");
    spent.type = "number";
    spent.min = "0";
    spent.step = "10";
    spent.value = r.actual === null ? "" : r.actual;
    spent.placeholder = "0";
    spent.setAttribute(
      "aria-label",
      soloOther
        ? `Total spent in ${formatMonth(selectedMonth)}`
        : `Spent on ${r.name} in ${formatMonth(selectedMonth)}`,
    );
    spent.addEventListener("input", () => {
      const raw = parseFloat(spent.value);
      // Negatives are dropped on reload by sanitiseLog, so never accept one here
      // — otherwise the totals would quietly change on the next page load.
      const v = Number.isFinite(raw) && raw >= 0 ? raw : null;
      const entry = entryFor(selectedMonth);
      if (r.id === OTHER_ID) {
        if (v !== null) entry.other = v;
        else delete entry.other;
      } else if (v !== null) {
        entry.byCategory[r.id] = v;
      } else {
        delete entry.byCategory[r.id];
      }
      pruneMonth(selectedMonth);
      saveState();
      recompute(); // re-renders the summary, and the forecast if it is on actuals
    });

    const variance = document.createElement("span");
    applyVariance(variance, r.variance, r.budget);
    logVarianceCells.set(r.id, variance);

    if (soloOther) row.append(name, spent);
    else row.append(name, budget, spent, variance);
    row.classList.toggle("log-row-solo", soloOther);
    list.append(row);
  }
  renderLogSummary();
}

function refreshVariances(rows) {
  if (logVarianceCells.size === 0) return;
  for (const r of rows) {
    const cell = logVarianceCells.get(r.id);
    if (cell) applyVariance(cell, r.variance, r.budget);
  }
}

function logHeadRow() {
  const head = document.createElement("div");
  head.className = "log-row log-head";
  for (const label of ["Category", "Budget", `Spent in ${formatMonth(selectedMonth).split(" ")[0]}`, "vs budget"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.append(cell);
  }
  return head;
}

/** Sign carries the meaning, so colour is never the only channel. */
function applyVariance(el, variance, budget) {
  el.className = "log-variance";
  if (variance === null) {
    el.textContent = "—";
    return;
  }
  const tolerance = Math.max(1, Math.abs(num(budget, 0)) * 0.02);
  if (Math.abs(variance) < tolerance) {
    el.textContent = "on budget";
  } else if (variance > 0) {
    el.textContent = `+${fmtFull(variance)}`;
    el.classList.add("tile-critical");
  } else {
    el.textContent = `−${fmtFull(Math.abs(variance))}`;
    el.classList.add("tile-good");
  }
}

function renderLogSummary() {
  const el = document.getElementById("log-summary");
  const { rows, total, logged } =
    monthVariance(state.spendLog, selectedMonth, state.spendCategories, state.monthlyExpenses);
  refreshVariances(rows);
  if (!logged) {
    el.textContent = `Nothing logged for ${formatMonth(selectedMonth)} yet.`;
    el.className = "log-summary";
    return;
  }
  const diff = total.variance;
  const tolerance = Math.max(1, total.budget * 0.02);
  let tail = "right on budget";
  let tone = "";
  if (diff > tolerance) { tail = `${fmtFull(diff)} over`; tone = "tile-critical"; }
  else if (diff < -tolerance) { tail = `${fmtFull(-diff)} under`; tone = "tile-good"; }
  el.textContent = `Logged ${fmtFull(total.actual)} of ${fmtFull(total.budget)} budgeted — ${tail}.`;
  el.className = `log-summary ${tone}`.trim();
}

/** The month the average runs up to: the last completed one. */
function lastCompletedMonth() {
  return addMonths(monthKey(new Date()), -1);
}

function currentExpenses() {
  return effectiveExpenses({
    spendLog: state.spendLog,
    monthlyExpenses: state.monthlyExpenses,
    useActuals: state.useActualsForForecast,
    endMonth: lastCompletedMonth(),
  });
}

function updateForecastHint() {
  const hint = document.getElementById("forecast-hint");
  const { monthly, basis, monthsUsed } = currentExpenses();
  if (basis === "actuals") {
    const months = monthsUsed === 1 ? "1 completed month" : `${monthsUsed} completed months`;
    hint.textContent = `Forecasting on ${fmtFull(monthly)}/month — your average across ${months}. Retirement spending is unaffected.`;
  } else if (state.useActualsForForecast) {
    hint.textContent = `Nothing logged for a completed month yet, so the forecast still uses your plan figure of ${fmtFull(monthly)}/month.`;
  } else {
    hint.textContent = `Forecasting on your plan figure of ${fmtFull(monthly)}/month.`;
  }
}

function stepMonth(delta) {
  const next = addMonths(selectedMonth, delta);
  if (next > monthKey(new Date())) return;
  selectedMonth = next;
  renderLog();
}

function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/* ---------- results ---------- */
function recompute() {
  const result = project({
    currentAge: state.currentAge,
    retirementAge: state.retirementAge,
    endAge: state.endAge,
    startYear: new Date().getFullYear(),
    startNetWorth: accountsTotal(),
    annualGrossIncome: state.monthlyGrossIncome * 12,
    annualExpenses: currentExpenses().annual,
    annualRetirementSpend: state.monthlyRetirementSpend * 12,
    returnRate: state.returnRate,
    inflationRate: state.inflationRate,
    incomeGrowthRate: state.incomeGrowthRate,
    includeTax: state.includeTax,
    cpf: state.cpf,
    events: state.events,
  });

  updateIncomeHint();
  updateForecastHint();
  updateBudgetTotal(); // the plan figure it quotes may have just changed
  renderLogSummary();

  // The chart measures its container, which reads zero while the projection
  // page is hidden. Defer the whole results block instead of drawing at a
  // guessed width, and redraw when the page comes back into view.
  if (currentPage === "projection") renderResults(result);
  else resultsStale = true;
}

function renderResults(result) {
  renderHero(result);
  renderTiles(result);
  disposeChart();
  disposeChart = renderChart(document.getElementById("chart"), result, {
    fmtCompact,
    fmtFull,
    retirementAge: state.retirementAge,
  });
  renderTable(result);
  updateChartAria(result);
  resultsStale = false;
}

function updateIncomeHint() {
  const hint = document.getElementById("income-hint");
  const cpfOn = state.cpf.enabled;
  const taxOn = state.includeTax;
  if ((!cpfOn && !taxOn) || !(state.monthlyGrossIncome > 0)) {
    hint.hidden = true;
    return;
  }
  const grossAnnual = state.monthlyGrossIncome * 12;
  const rate = cpfOn ? CPF.employeeRateForAge(state.currentAge) : 0;
  const cpfAnnual = rate * Math.min(grossAnnual, CPF.OW_CEILING_ANNUAL);
  const taxAnnual = taxOn
    ? TAX.of(Math.max(0, grossAnnual - cpfAnnual - TAX.EARNED_INCOME_RELIEF))
    : 0;
  const takeHome = (grossAnnual - cpfAnnual - taxAnnual) / 12;
  const parts = [];
  if (cpfOn) parts.push(`${(rate * 100).toLocaleString("en-US")}% CPF at age ${state.currentAge}`);
  if (taxOn) parts.push(`income tax ≈ ${fmtFull(taxAnnual / 12)}/month`);
  hint.hidden = false;
  hint.textContent =
    `Take-home after ${[cpfOn && "CPF", taxOn && "tax"].filter(Boolean).join(" & ")}` +
    ` ≈ ${fmtFull(takeHome)}/month (${parts.join(" · ")})`;
}

function renderHero(result) {
  const ret = result.retirementRow;
  document.getElementById("hero-label").textContent =
    `Projected net worth at retirement (age ${state.retirementAge})`;
  document.getElementById("hero-value").textContent = fmtCompact(ret.nominal);
  document.getElementById("hero-sub").textContent =
    `${fmtFull(ret.nominal)} in ${ret.year} — worth ${fmtCompact(ret.real)} in today's money`;
}

function renderTiles(result) {
  const tiles = document.getElementById("tiles");
  tiles.textContent = "";

  const cpfOn = result.cpfEnabled;
  const fiTarget = 25 * state.monthlyRetirementSpend * 12;
  addTile(tiles, "Financial independence target",
    fmtCompact(fiTarget),
    `25× yearly retirement spending (4% rule), today's money${cpfOn ? ", outside CPF" : ""}`);

  addTile(tiles, "Financial independence age",
    result.fiAge === null ? "Not reached" : String(result.fiAge),
    result.fiAge === null
      ? `not within this plan (to age ${state.endAge})`
      : `in ${Math.max(0, result.fiAge - state.currentAge)} years`);

  if (cpfOn && result.cpfLifePayoutAnnual > 0) {
    addTile(tiles, "CPF LIFE payout",
      `${fmtCompact(result.cpfLifePayoutAnnual / 12)}/mo`,
      "estimated for life from age 65, Standard plan");
  } else {
    addTile(tiles, "Peak net worth",
      fmtCompact(result.peak.nominal),
      `at age ${result.peak.age} (${result.peak.year})`);
  }

  if (result.depletedAge !== null) {
    addTile(tiles, "Savings run out", `⚠ Age ${result.depletedAge}`,
      result.cpfLifePayoutAnnual > 0
        ? `CPF LIFE keeps paying ${fmtCompact(result.cpfLifePayoutAnnual / 12)}/mo`
        : `${result.depletedAge - state.retirementAge} years into retirement`,
      "tile-critical");
  } else {
    const last = result.rows[result.rows.length - 1];
    addTile(tiles, "Money lasts", `✓ Past age ${state.endAge}`,
      `${fmtCompact(last.nominal)} left at age ${state.endAge}`, "tile-good");
  }
}

function addTile(parent, label, value, sub, valueClass = "") {
  const tile = document.createElement("div");
  tile.className = "card tile";
  const l = document.createElement("p");
  l.className = "tile-label";
  l.textContent = label;
  const v = document.createElement("p");
  v.className = `tile-value ${valueClass}`.trim();
  v.textContent = value;
  const s = document.createElement("p");
  s.className = "tile-sub";
  s.textContent = sub;
  tile.append(l, v, s);
  parent.append(tile);
}

/* ---------- table view (the no-hover twin of the chart) ---------- */
function renderTable(result) {
  const wrap = document.getElementById("table-view");
  wrap.textContent = "";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const headers = ["Age", "Year", "Net worth", "In today's money"];
  if (result.cpfEnabled) headers.push("of which CPF");
  headers.push("Saved / withdrawn", "Growth");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const row of result.rows) {
    const tr = document.createElement("tr");
    const cells = [
      String(row.age),
      String(row.year),
      fmtFull(row.nominal),
      fmtFull(row.real),
    ];
    if (result.cpfEnabled) cells.push(fmtFull(row.cpfTotal));
    cells.push(
      row.t === 0 ? "—" : fmtFull(row.cashFlow),
      row.t === 0 ? "—" : fmtFull(row.growth),
    );
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
}

function updateChartAria(result) {
  const ret = result.retirementRow;
  const last = result.rows[result.rows.length - 1];
  document.getElementById("chart").setAttribute("aria-label",
    `Line chart of projected net worth from age ${state.currentAge} to ${state.endAge}. ` +
    `${fmtFull(ret.nominal)} at retirement age ${state.retirementAge}; ` +
    `${fmtFull(last.nominal)} at age ${last.age}. Full figures in the table view.`);
}

/* ---------- pages ---------- */
const PAGE_COPY = {
  projection: {
    title: "Wealth Projection",
    tagline: "Track what you own today and see where it takes you.",
  },
  tracker: {
    title: "Monthly tracker · Wealth Projection",
    tagline: "Log what you actually spent, month by month, against your budget.",
  },
};

function showPage(page) {
  currentPage = page;
  for (const name of PAGES) {
    document.getElementById(`page-${name}`).hidden = name !== page;
    const link = document.getElementById(`nav-${name}`);
    if (name === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = PAGE_COPY[page].title;
  document.getElementById("tagline").textContent = PAGE_COPY[page].tagline;
  // The modelling caveats only describe the projection, so they follow it.
  document.getElementById("model-notes").hidden = page !== "projection";
  if (page === "projection" && resultsStale) recompute();
}

/* ---------- theme ---------- */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme() {
  if (state.theme === "light" || state.theme === "dark") return state.theme;
  return darkQuery.matches ? "dark" : "light";
}

function applyTheme() {
  if (state.theme === "light" || state.theme === "dark") {
    document.documentElement.setAttribute("data-theme", state.theme);
  } else {
    document.documentElement.removeAttribute("data-theme"); // follow the system
  }
  const dark = effectiveTheme() === "dark";
  // the icon shows what a click switches to
  document.getElementById("theme-icon-moon").hidden = dark;
  document.getElementById("theme-icon-sun").hidden = !dark;
  document.getElementById("theme-toggle")
    .setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function bindThemeToggle() {
  document.getElementById("theme-toggle").addEventListener("click", () => {
    state.theme = effectiveTheme() === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
    recompute(); // the chart samples theme colors at render time
  });
}

/* ---------- view toggle ---------- */
function bindViewToggle() {
  const chartBtn = document.getElementById("view-chart");
  const tableBtn = document.getElementById("view-table");
  const chart = document.getElementById("chart");
  const table = document.getElementById("table-view");
  const select = (showChart) => {
    chartBtn.setAttribute("aria-selected", String(showChart));
    tableBtn.setAttribute("aria-selected", String(!showChart));
    chart.hidden = !showChart;
    table.hidden = showChart;
  };
  chartBtn.addEventListener("click", () => select(true));
  tableBtn.addEventListener("click", () => select(false));
}

/* ---------- wiring ---------- */
document.getElementById("add-account").addEventListener("click", () => {
  state.accounts.push({ name: "", type: "other", value: 0 });
  saveState();
  renderAccounts();
  recompute();
  const rows = document.querySelectorAll("#accounts-list .account-row");
  rows[rows.length - 1]?.querySelector("input")?.focus();
});

document.getElementById("add-event").addEventListener("click", () => {
  state.events.push({ name: "", age: state.currentAge + 5, amount: 0 });
  saveState();
  renderEvents();
  recompute();
  const rows = document.querySelectorAll("#events-list .event-row");
  rows[rows.length - 1]?.querySelector("input")?.focus();
});

document.getElementById("add-category").addEventListener("click", () => {
  state.spendCategories.push({ id: newId(), name: "" });
  saveState();
  renderBudget();
  renderLog();
  const rows = document.querySelectorAll("#budget-list .budget-row");
  rows[rows.length - 1]?.querySelector("input")?.focus();
});

document.getElementById("log-prev").addEventListener("click", () => stepMonth(-1));
document.getElementById("log-next").addEventListener("click", () => stepMonth(1));
document.getElementById("log-today").addEventListener("click", () => {
  selectedMonth = monthKey(new Date());
  renderLog();
});

document.getElementById("reset-data").addEventListener("click", () => {
  if (!confirm("Reset all data to the defaults?")) return;
  clearState(localStorage);
  state = structuredClone(DEFAULT_STATE);
  selectedMonth = monthKey(new Date());
  rerenderAll();
});

/* ---------- backup files ---------- */
document.getElementById("export-data").addEventListener("click", () => {
  const payload = {
    app: "wealth-projection",
    version: 3,
    exportedAt: new Date().toISOString(),
    state,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `wealth-projection-${new Date().toISOString().slice(0, 10)}.json`;
  // Firefox only downloads from an anchor in the document, and cancels the
  // download if the object URL is revoked before it has been read.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  // Stamped after the payload is built, so the file records the backup before
  // it rather than its own timestamp twice.
  state.lastBackupAt = payload.exportedAt;
  saveState();
  renderBackupStatus();
});

const importFile = document.getElementById("import-file");
document.getElementById("import-data").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = ""; // so re-importing the same file still fires "change"
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert("That file isn't valid JSON.");
    return;
  }
  const saved = payload?.app === "wealth-projection" ? payload.state : null;
  if (!saved || typeof saved !== "object") {
    alert("That file isn't a Wealth Projection backup.");
    return;
  }
  if (!confirm("Replace everything currently saved with this backup?")) return;
  state = mergeSaved(saved); // same sanitising funnel as localStorage
  // What is now on screen came from that file, so the file's own export time
  // is when this data was last backed up — not "now".
  state.lastBackupAt = sanitiseTimestamp(payload.exportedAt) ?? state.lastBackupAt;
  selectedMonth = monthKey(new Date());
  saveState();
  rerenderAll();
});

function renderBackupStatus() {
  const el = document.getElementById("backup-status");
  // A default install has nothing to lose yet, so only nag once something
  // has actually been entered.
  const hasData = loggedMonths(state.spendLog).length > 0 || state.spendCategories.length > 0;
  const { label, stale } = backupHint(state.lastBackupAt, { hasData });
  el.textContent = label;
  el.classList.toggle("backup-status-stale", stale);
}

function rerenderAll() {
  applyTheme();
  syncInputsFromState();
  renderAccounts();
  renderEvents();
  renderBudget();
  renderLog();
  renderBackupStatus();
  recompute();
}

function syncInputsFromState() {
  for (const key of PLAN_FIELDS) document.getElementById(`in-${key}`).value = state[key];
  document.getElementById("in-currency").value = state.currency;
  document.getElementById("in-includeTax").checked = state.includeTax;
  document.getElementById("in-useActualsForForecast").checked = state.useActualsForForecast;
  document.getElementById("in-cpfEnabled").checked = state.cpf.enabled;
  for (const [id, key] of CPF_FIELDS) document.getElementById(id).value = state.cpf[key];
  syncCpfUI();
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(recompute, 150);
});
darkQuery.addEventListener("change", () => {
  applyTheme(); // refresh the icon when following the system
  recompute();
});

applyTheme();
startRouter(window, showPage);
bindThemeToggle();
bindPlanInputs();
bindCpfInputs();
bindViewToggle();
renderAccounts();
renderEvents();
renderBudget();
renderLog();
renderBackupStatus();
recompute();
