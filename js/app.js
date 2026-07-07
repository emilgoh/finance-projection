import { project } from "./projection.js";
import { renderChart } from "./chart.js";

const STORAGE_KEY = "wealth-projection-v1";

const DEFAULT_STATE = {
  currency: "$",
  currentAge: 30,
  retirementAge: 65,
  endAge: 90,
  monthlyIncome: 5000,
  monthlyExpenses: 3500,
  monthlyRetirementSpend: 3500,
  returnRate: 6,
  inflationRate: 2.5,
  incomeGrowthRate: 3,
  accounts: [
    { name: "Checking", type: "cash", value: 5000 },
    { name: "Brokerage", type: "investments", value: 20000 },
    { name: "Retirement fund", type: "retirement", value: 15000 },
  ],
};

const ACCOUNT_TYPES = ["cash", "investments", "retirement", "property", "other"];

let state = loadState();
let disposeChart = () => {};

/* ---------- persistence ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...structuredClone(DEFAULT_STATE), ...saved };
    }
  } catch { /* corrupt storage — fall back to defaults */ }
  return structuredClone(DEFAULT_STATE);
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
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
  "currentAge", "retirementAge", "endAge", "monthlyIncome", "monthlyExpenses",
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
  const currency = document.getElementById("in-currency");
  currency.value = state.currency;
  if (currency.value !== state.currency) currency.value = "$"; // unknown saved symbol
  currency.addEventListener("change", () => {
    state.currency = currency.value;
    saveState();
    recompute();
    renderAccounts();
  });
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

function netWorthToday() {
  return state.accounts.reduce((sum, a) => sum + (Number.isFinite(a.value) ? a.value : 0), 0);
}

function updateAccountsTotal() {
  document.getElementById("accounts-total-value").textContent = fmtFull(netWorthToday());
}

/* ---------- results ---------- */
function recompute() {
  const result = project({
    currentAge: state.currentAge,
    retirementAge: state.retirementAge,
    endAge: state.endAge,
    startNetWorth: netWorthToday(),
    annualIncome: state.monthlyIncome * 12,
    annualExpenses: state.monthlyExpenses * 12,
    annualRetirementSpend: state.monthlyRetirementSpend * 12,
    returnRate: state.returnRate,
    inflationRate: state.inflationRate,
    incomeGrowthRate: state.incomeGrowthRate,
  });

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

  const fiTarget = 25 * state.monthlyRetirementSpend * 12;
  addTile(tiles, "Financial independence target",
    fmtCompact(fiTarget),
    "25× yearly retirement spending (4% rule), today's money");

  addTile(tiles, "Financial independence age",
    result.fiAge === null ? "Not reached" : String(result.fiAge),
    result.fiAge === null
      ? `not within this plan (to age ${state.endAge})`
      : `in ${Math.max(0, result.fiAge - state.currentAge)} years`);

  addTile(tiles, "Peak net worth",
    fmtCompact(result.peak.nominal),
    `at age ${result.peak.age} (${result.peak.year})`);

  if (result.depletedAge !== null) {
    addTile(tiles, "Money runs out", `⚠ Age ${result.depletedAge}`,
      `${result.depletedAge - state.retirementAge} years into retirement`, "tile-critical");
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
  for (const h of ["Age", "Year", "Net worth", "In today's money", "Saved / withdrawn", "Growth"]) {
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
      row.t === 0 ? "—" : fmtFull(row.cashFlow),
      row.t === 0 ? "—" : fmtFull(row.growth),
    ];
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

document.getElementById("reset-data").addEventListener("click", () => {
  if (!confirm("Reset all data to the defaults?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  bindPlanInputsValuesOnly();
  renderAccounts();
  recompute();
});

function bindPlanInputsValuesOnly() {
  for (const key of PLAN_FIELDS) document.getElementById(`in-${key}`).value = state[key];
  document.getElementById("in-currency").value = state.currency;
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(recompute, 150);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recompute);

bindPlanInputs();
bindViewToggle();
renderAccounts();
recompute();
