import { project, CPF, TAX } from "./projection.js";
import { renderChart } from "./chart.js";
import {
  OTHER_ID, monthKey, addMonths, formatMonth,
  activeCategories, categoryKind, categoriesOfKind, categoryBudgetTotal, bucketTargetTotal,
  isLogged, loggedMonths, monthSections, savingsVariance, effectiveExpenses,
} from "./expenses.js";
import { PAGES, pageFromHash, startRouter } from "./router.js";
import {
  DEFAULT_STATE, ACCOUNT_TYPES,
  loadState, writeState, clearState, mergeSaved, moveItem, newId, backupHint, sanitiseTimestamp,
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
    renderNamedList("spendCategories");
    renderNamedList("savingsBuckets");
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


/* ---------- spending categories & savings buckets ---------- */
/**
 * A category and a savings bucket are the same row with a different middle: a
 * category picks fixed or variable and carries a budget, a bucket only carries
 * a monthly target. Both key their own month log by id, so both archive rather
 * than delete once there is history behind them.
 */
const NAMED_LISTS = {
  spendCategories: {
    listId: "budget-list", logKey: "spendLog", noun: "category", kinds: true,
    nameLabel: "Category name", namePlaceholder: "Category name",
    amountKey: "budget", amountLabel: "Monthly budget", amountPlaceholder: "Budget",
    render: () => updateBudgetTotal(),
  },
  savingsBuckets: {
    listId: "savings-budget-list", logKey: "savingsLog", noun: "bucket", kinds: false,
    nameLabel: "Bucket name", namePlaceholder: "Bucket (e.g. Emergency fund)",
    amountKey: "target", amountLabel: "Monthly target", amountPlaceholder: "Target",
    render: () => updateSavingsTargetTotal(),
  },
};

function renderNamedList(listKey) {
  const cfg = NAMED_LISTS[listKey];
  const list = document.getElementById(cfg.listId);
  const live = activeCategories(state[listKey]);
  list.textContent = "";
  live.forEach((item, position) => {
    const row = document.createElement("div");
    row.className = cfg.kinds ? "budget-row budget-row-kind" : "budget-row";
    row.dataset.id = item.id;

    const name = document.createElement("input");
    name.type = "text";
    name.value = item.name;
    name.placeholder = cfg.namePlaceholder;
    name.setAttribute("aria-label", cfg.nameLabel);
    name.addEventListener("input", () => {
      item.name = name.value;
      const label = item.name || cfg.noun;
      remove.setAttribute("aria-label", `Remove ${label}`);
      for (const button of moves.querySelectorAll("[data-move]")) {
        button.setAttribute("aria-label", `Move ${label} ${button.dataset.move}`);
      }
      saveState();
      renderLog(); // the log labels rows by name; keep them in step
    });

    const amount = document.createElement("input");
    amount.type = "number";
    amount.min = "0";
    amount.step = "50";
    amount.value = Number.isFinite(item[cfg.amountKey]) ? item[cfg.amountKey] : "";
    amount.placeholder = cfg.amountPlaceholder;
    amount.setAttribute("aria-label", `${cfg.amountLabel} in ${state.currency}`);
    amount.addEventListener("input", () => {
      const v = parseFloat(amount.value);
      if (Number.isFinite(v)) item[cfg.amountKey] = v;
      else delete item[cfg.amountKey];
      saveState();
      cfg.render();
      renderLog();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove ${item.name || cfg.noun}`);
    remove.addEventListener("click", () => removeNamedItem(listKey, item));

    const moves = moveButtons(listKey, item, position, live.length);
    if (cfg.kinds) row.append(name, kindSelect(listKey, item), amount, moves, remove);
    else row.append(name, amount, moves, remove);
    list.append(row);
  });
  cfg.render();
}

/**
 * Order is the user's own: the list they read it in, and the order the month
 * log lists its rows in. Two buttons rather than drag and drop — a swap is the
 * whole gesture, it works from the keyboard without a story about drop targets,
 * and it needs no library in a project that has none.
 */
function moveButtons(listKey, item, position, count) {
  const wrap = document.createElement("div");
  wrap.className = "row-moves";
  for (const [dir, delta, glyph] of [["up", -1, "\u2191"], ["down", 1, "\u2193"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-move";
    button.dataset.move = dir;
    button.textContent = glyph;
    button.disabled = dir === "up" ? position === 0 : position === count - 1;
    button.setAttribute("aria-label", `Move ${item.name || NAMED_LISTS[listKey].noun} ${dir}`);
    button.addEventListener("click", () => moveNamedItem(listKey, item, delta));
    wrap.append(button);
  }
  return wrap;
}

function moveNamedItem(listKey, item, delta) {
  if (!moveItem(state[listKey], item, delta)) return;
  saveState();
  renderNamedList(listKey);
  renderLog(); // the log lists its rows in this order too
  focusMoveButton(listKey, item, delta);
}

/**
 * Keep the keyboard on the button just pressed, so a row can be walked several
 * places in one go. At either end that button is now disabled and cannot hold
 * focus, so the other one takes it.
 */
function focusMoveButton(listKey, item, delta) {
  const row = document.querySelector(
    `#${NAMED_LISTS[listKey].listId} [data-id="${CSS.escape(item.id)}"]`);
  if (!row) return;
  const pressed = row.querySelector(`[data-move="${delta < 0 ? "up" : "down"}"]`);
  const other = row.querySelector(`[data-move="${delta < 0 ? "down" : "up"}"]`);
  (pressed && !pressed.disabled ? pressed : other)?.focus();
}

function kindSelect(listKey, cat) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Fixed or variable");
  for (const [value, label] of [["fixed", "Fixed"], ["variable", "Variable"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  // Read through categoryKind, so a blob written before the split — or an
  // import carrying something else entirely — still selects a real option.
  select.value = categoryKind(cat);
  select.addEventListener("change", () => {
    cat.kind = select.value === "fixed" ? "fixed" : "variable";
    saveState();
    updateBudgetTotal();
    renderLog(); // the log groups rows by kind
  });
  return select;
}

/**
 * Items with logged history are archived rather than deleted, so past months
 * keep their names and their totals never shift under the user.
 */
function removeNamedItem(listKey, item) {
  const cfg = NAMED_LISTS[listKey];
  const logged = Object.values(state[cfg.logKey]).some((e) => Number.isFinite(e.byCategory?.[item.id]));
  if (logged) {
    const label = item.name || `this ${cfg.noun}`;
    if (!confirm(`${label} has amounts logged against it. Remove it from the list but keep that history?`)) return;
    item.archived = true;
  } else {
    const i = state[listKey].indexOf(item);
    if (i >= 0) state[listKey].splice(i, 1);
  }
  saveState();
  renderNamedList(listKey);
  renderLog();
}

function updateBudgetTotal() {
  const line = document.getElementById("budget-total-line");
  const cats = activeCategories(state.spendCategories);
  if (cats.length === 0) {
    line.textContent = "";
    return;
  }
  const fixed = categoryBudgetTotal(state.spendCategories, "fixed");
  const variable = categoryBudgetTotal(state.spendCategories, "variable");
  let text = `Categories add up to ${fmtFull(fixed + variable)} / month`;
  // The split is only worth spelling out once something has been marked fixed.
  if (categoriesOfKind(state.spendCategories, "fixed").length > 0) {
    text += ` (${fmtFull(fixed)} fixed · ${fmtFull(variable)} variable)`;
  }
  // The two figures are allowed to disagree — the plan figure is what forecasts.
  if (Math.abs(fixed + variable - state.monthlyExpenses) >= 1) {
    text += ` · your plan says ${fmtFull(state.monthlyExpenses)}`;
  }
  line.textContent = text;
}

function updateSavingsTargetTotal() {
  const line = document.getElementById("savings-target-line");
  const buckets = activeCategories(state.savingsBuckets);
  line.textContent = buckets.length === 0
    ? ""
    : `Targets add up to ${fmtFull(bucketTargetTotal(state.savingsBuckets))} / month`;
}

/* ---------- life events & windfalls ---------- */

/**
 * Life events (money out) and windfalls (money in) are the same row: a name,
 * an age, and an amount in today's money. The engine inflates each to the year
 * the age is reached, so what is typed here stays comparable to the plan
 * figures above it. Only the wording and which list is mutated differ.
 */
const ONE_OFF_LISTS = {
  events: {
    listId: "events-list",
    noun: "event",
    placeholder: "Event (e.g. home down payment)",
  },
  windfalls: {
    listId: "windfalls-list",
    noun: "windfall",
    placeholder: "Windfall (e.g. inheritance)",
  },
};

function renderOneOffs(kind) {
  const { listId, noun, placeholder } = ONE_OFF_LISTS[kind];
  const list = document.getElementById(listId);
  list.textContent = "";
  for (const entry of state[kind]) {
    const row = document.createElement("div");
    row.className = "one-off-row";

    const name = document.createElement("input");
    name.type = "text";
    name.value = entry.name;
    name.placeholder = placeholder;
    name.setAttribute("aria-label", `${cap(noun)} name`);
    name.addEventListener("input", () => {
      entry.name = name.value;
      remove.setAttribute("aria-label", `Remove ${entry.name || noun}`);
      saveState();
    });

    const age = document.createElement("input");
    age.type = "number";
    age.step = "1";
    age.min = "16";
    age.max = "120";
    age.value = entry.age ?? "";
    age.setAttribute("aria-label", "At age");
    age.title = "At age";
    age.addEventListener("input", () => {
      // Cleared, or mid-typing garbage: null keeps the row editable and the
      // engine skips it, rather than silently landing in year zero.
      entry.age = num(age.value, null);
      saveState();
      recompute();
    });

    const amount = document.createElement("input");
    amount.type = "number";
    amount.step = "1000";
    amount.min = "0";
    amount.value = entry.amount;
    amount.setAttribute("aria-label", `Amount in today's ${state.currency}`);
    amount.addEventListener("input", () => {
      entry.amount = Math.max(0, num(amount.value, 0));
      saveState();
      recompute();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove ${entry.name || noun}`);
    remove.addEventListener("click", () => {
      const i = state[kind].indexOf(entry);
      if (i >= 0) state[kind].splice(i, 1);
      saveState();
      renderOneOffs(kind);
      recompute();
    });

    row.append(name, age, amount, remove);
    list.append(row);
  }
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* ---------- the monthly log ---------- */
/**
 * Spending and savings are two logs of the same shape, so one row renderer,
 * one variance cell and one month navigator serve both. What differs is the
 * sign: an overspend is bad news, and saving past the target is good news.
 */
function entryFor(logKey, key) {
  if (!state[logKey][key]) state[logKey][key] = { byCategory: {} };
  const entry = state[logKey][key];
  if (!entry.byCategory) entry.byCategory = {};
  return entry;
}

/** Drop a month once nothing is left in it, so "logged" stays honest. */
function pruneMonth(logKey, key) {
  if (!isLogged(state[logKey], key)) delete state[logKey][key];
}

/**
 * How far back the log can be browsed: three years, or further if an imported
 * backup holds older months — those still feed the average, so they must stay
 * reachable. Either log can hold the oldest month.
 */
function earliestMonth() {
  const floor = addMonths(monthKey(new Date()), -36);
  const oldest = [loggedMonths(state.spendLog)[0], loggedMonths(state.savingsLog)[0]]
    .filter(Boolean)
    .sort()[0];
  return oldest && oldest < floor ? oldest : floor;
}

// Variance cells are refreshed in place as amounts are typed, so the inputs keep
// their focus and caret instead of being rebuilt on every keystroke. Subtotals
// are kept separately because their amounts move too, not just their variance.
let varianceCells = { spendLog: new Map(), savingsLog: new Map() };
let subtotalCells = new Map();

function renderLog() {
  const thisMonth = monthKey(new Date());
  document.getElementById("log-month-label").textContent = formatMonth(selectedMonth);
  document.getElementById("log-next").disabled = selectedMonth >= thisMonth;
  document.getElementById("log-prev").disabled = selectedMonth <= earliestMonth();
  document.getElementById("log-today").hidden = selectedMonth === thisMonth;
  renderSpendRows();
  renderSavingsRows();
  renderLogSummary();
}

function renderSpendRows() {
  const { sections } = monthSections(
    state.spendLog, selectedMonth, state.spendCategories, state.monthlyExpenses);
  const list = document.getElementById("log-list");
  list.textContent = "";
  varianceCells.spendLog = new Map();
  subtotalCells = new Map();

  const filled = sections.filter((s) => s.rows.length > 0);
  const solo = filled.length === 1 && filled[0].rows.length === 1;
  const spec = {
    logKey: "spendLog",
    solo,
    positiveIsGood: false,
    soloLabel: "Total spent",
    aria: (r) => (solo
      ? `Total spent in ${formatMonth(selectedMonth)}`
      : `Spent on ${r.name} in ${formatMonth(selectedMonth)}`),
  };

  if (!solo) list.append(logHeadRow("Category", "Budget", "Spent", "vs budget"));
  // With nothing marked fixed there is only one group, and a lone "Variable"
  // heading would name a distinction the user has not drawn yet.
  const grouped = filled.length > 1;
  for (const section of filled) {
    if (grouped) list.append(groupHeadRow(section.label));
    for (const r of section.rows) list.append(logRow(r, spec));
    // A one-row group is its own subtotal; repeating it says nothing.
    if (grouped && section.rows.length > 1) list.append(subtotalRow(section, spec));
  }
}

function renderSavingsRows() {
  const { rows } = savingsVariance(state.savingsLog, selectedMonth, state.savingsBuckets);
  const list = document.getElementById("savings-log-list");
  list.textContent = "";
  varianceCells.savingsLog = new Map();

  const solo = rows.length === 1;
  const spec = {
    logKey: "savingsLog",
    solo,
    positiveIsGood: true,
    soloLabel: "Total saved",
    aria: (r) => (solo
      ? `Total saved in ${formatMonth(selectedMonth)}`
      : `Saved into ${r.name} in ${formatMonth(selectedMonth)}`),
  };

  if (!solo) list.append(logHeadRow("Bucket", "Target", "Saved", "vs target"));
  for (const r of rows) list.append(logRow(r, spec));
}

function logRow(r, spec) {
  const row = document.createElement("div");
  row.className = "log-row";

  const name = document.createElement("span");
  name.className = "log-name";
  name.textContent = spec.solo ? spec.soloLabel : r.name;
  if (r.archived) {
    const tag = document.createElement("small");
    tag.textContent = " (removed)";
    name.append(tag);
  }

  const planned = document.createElement("span");
  planned.className = "log-budget";
  planned.textContent = r.budget === null ? "—" : fmtFull(r.budget);

  const amount = document.createElement("input");
  amount.type = "number";
  amount.min = "0";
  amount.step = "10";
  amount.value = r.actual === null ? "" : r.actual;
  amount.placeholder = "0";
  amount.setAttribute("aria-label", spec.aria(r));
  amount.addEventListener("input", () => {
    const raw = parseFloat(amount.value);
    // Negatives are dropped on reload by sanitiseLog, so never accept one here
    // — otherwise the totals would quietly change on the next page load.
    const v = Number.isFinite(raw) && raw >= 0 ? raw : null;
    const entry = entryFor(spec.logKey, selectedMonth);
    if (r.id === OTHER_ID) {
      if (v !== null) entry.other = v;
      else delete entry.other;
    } else if (v !== null) {
      entry.byCategory[r.id] = v;
    } else {
      delete entry.byCategory[r.id];
    }
    pruneMonth(spec.logKey, selectedMonth);
    saveState();
    // Spending can drive the forecast; savings never does, so it only needs
    // the summary block redrawn.
    if (spec.logKey === "spendLog") recompute();
    else renderLogSummary();
  });

  const variance = document.createElement("span");
  applyVariance(variance, r.variance, r.budget, spec.positiveIsGood);
  varianceCells[spec.logKey].set(r.id, variance);

  if (spec.solo) row.append(name, amount);
  else row.append(name, planned, amount, variance);
  row.classList.toggle("log-row-solo", spec.solo);
  return row;
}

function logHeadRow(nameLabel, plannedLabel, actualLabel, varianceLabel) {
  const head = document.createElement("div");
  head.className = "log-row log-head";
  const month = formatMonth(selectedMonth).split(" ")[0];
  for (const label of [nameLabel, plannedLabel, `${actualLabel} in ${month}`, varianceLabel]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.append(cell);
  }
  return head;
}

function groupHeadRow(label) {
  const row = document.createElement("div");
  row.className = "log-group";
  row.textContent = label;
  return row;
}

function subtotalRow(section, spec) {
  const row = document.createElement("div");
  row.className = "log-row log-subtotal";

  const name = document.createElement("span");
  name.className = "log-name";
  name.textContent = "Subtotal";

  // The labels only surface on narrow screens, where the header row is hidden
  // and two bare amounts under "Subtotal" would be anyone's guess.
  const planned = document.createElement("span");
  planned.className = "log-budget";
  planned.dataset.label = "Budget";
  const actual = document.createElement("span");
  actual.className = "log-budget log-actual";
  actual.dataset.label = "Spent";
  const variance = document.createElement("span");

  row.append(name, planned, actual, variance);
  subtotalCells.set(section.kind, { planned, actual, variance });
  applySubtotal(section, spec.positiveIsGood);
  return row;
}

function applySubtotal(section, positiveIsGood) {
  const cells = subtotalCells.get(section.kind);
  if (!cells) return;
  const { budget, actual, variance } = section.subtotal;
  cells.planned.textContent = budget === null ? "—" : fmtFull(budget);
  cells.actual.textContent = actual === null ? "—" : fmtFull(actual);
  applyVariance(cells.variance, variance, budget, positiveIsGood);
}

function refreshVariances(logKey, rows, positiveIsGood) {
  const cells = varianceCells[logKey];
  if (cells.size === 0) return;
  for (const r of rows) {
    const cell = cells.get(r.id);
    if (cell) applyVariance(cell, r.variance, r.budget, positiveIsGood);
  }
}

/**
 * Sign carries the meaning, so colour is never the only channel. Which sign is
 * the good one is the caller's call: over budget is bad, over target is good.
 */
function applyVariance(el, variance, planned, positiveIsGood = false) {
  el.className = "log-variance";
  if (variance === null) {
    el.textContent = "—";
    return;
  }
  const tolerance = Math.max(1, Math.abs(num(planned, 0)) * 0.02);
  if (Math.abs(variance) < tolerance) {
    el.textContent = positiveIsGood ? "on target" : "on budget";
    return;
  }
  const good = variance > 0 === Boolean(positiveIsGood);
  el.textContent = `${variance > 0 ? "+" : "−"}${fmtFull(Math.abs(variance))}`;
  el.classList.add(good ? "tile-good" : "tile-critical");
}

function renderLogSummary() {
  const spend = monthSections(
    state.spendLog, selectedMonth, state.spendCategories, state.monthlyExpenses);
  refreshVariances("spendLog", spend.rows, false);
  for (const section of spend.sections) applySubtotal(section, false);
  renderSpendSummary(spend.total, spend.logged);

  const savings = savingsVariance(state.savingsLog, selectedMonth, state.savingsBuckets);
  refreshVariances("savingsLog", savings.rows, true);
  renderSavingsSummary(savings.total, savings.logged);

  renderNetLine(spend.total, savings.total);
}

function renderSpendSummary(total, logged) {
  const el = document.getElementById("log-summary");
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

function renderSavingsSummary(total, logged) {
  const el = document.getElementById("savings-summary");
  el.className = "log-summary";
  if (!logged) {
    el.textContent = `Nothing saved logged for ${formatMonth(selectedMonth)} yet.`;
    return;
  }
  // With no targets set there is nothing to be short of, so the figure stands
  // on its own rather than being scored against a zero nobody chose.
  if (!(total.target > 0)) {
    el.textContent = `Saved ${fmtFull(total.actual)} in ${formatMonth(selectedMonth)}.`;
    return;
  }
  const diff = total.variance;
  const tolerance = Math.max(1, total.target * 0.02);
  let tail = "right on target";
  let tone = "";
  if (diff > tolerance) { tail = `${fmtFull(diff)} ahead`; tone = "tile-good"; }
  else if (diff < -tolerance) { tail = `${fmtFull(-diff)} short`; tone = "tile-critical"; }
  el.textContent = `Saved ${fmtFull(total.actual)} of ${fmtFull(total.target)} targeted — ${tail}.`;
  el.className = `log-summary ${tone}`.trim();
}

/**
 * The savings rate is the one number neither log can give on its own, which is
 * the whole reason this line exists. It is a share of what was logged, not of
 * income — nothing here knows what actually reached the bank.
 */
function renderNetLine(spent, saved) {
  const el = document.getElementById("log-net");
  el.className = "log-net";
  const tracked = num(spent.actual, 0) + num(saved.actual, 0);
  if (spent.actual === null || saved.actual === null || tracked <= 0) {
    el.textContent = "";
    return;
  }
  const rate = Math.round((saved.actual / tracked) * 100);
  el.textContent = `${formatMonth(selectedMonth)}: ${fmtFull(spent.actual)} spent, ` +
    `${fmtFull(saved.actual)} saved — ${rate}% of what you logged was kept.`;
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
    windfalls: state.windfalls,
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
    tagline: "Log what you actually spent and saved, month by month, against your plan.",
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

for (const [kind, { listId, noun }] of Object.entries(ONE_OFF_LISTS)) {
  document.getElementById(`add-${noun}`).addEventListener("click", () => {
    state[kind].push({ name: "", age: state.currentAge + 5, amount: 0 });
    saveState();
    renderOneOffs(kind);
    recompute();
    const rows = document.querySelectorAll(`#${listId} .one-off-row`);
    rows[rows.length - 1]?.querySelector("input")?.focus();
  });
}

for (const [listKey, { listId, noun }] of Object.entries(NAMED_LISTS)) {
  document.getElementById(`add-${noun}`).addEventListener("click", () => {
    state[listKey].push({ id: newId(), name: "" });
    saveState();
    renderNamedList(listKey);
    renderLog();
    const rows = document.querySelectorAll(`#${listId} .budget-row`);
    rows[rows.length - 1]?.querySelector("input")?.focus();
  });
}

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
  const hasData = loggedMonths(state.spendLog).length > 0 || state.spendCategories.length > 0
    || loggedMonths(state.savingsLog).length > 0 || state.savingsBuckets.length > 0;
  const { label, stale } = backupHint(state.lastBackupAt, { hasData });
  el.textContent = label;
  el.classList.toggle("backup-status-stale", stale);
}

function rerenderAll() {
  applyTheme();
  syncInputsFromState();
  renderAccounts();
  renderOneOffs("events");
  renderOneOffs("windfalls");
  renderNamedList("spendCategories");
  renderNamedList("savingsBuckets");
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
renderOneOffs("events");
renderOneOffs("windfalls");
renderNamedList("spendCategories");
renderNamedList("savingsBuckets");
renderLog();
renderBackupStatus();
recompute();
