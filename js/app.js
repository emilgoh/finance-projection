import { project } from "./projection.js";
import { renderChart } from "./chart.js";

const STORAGE_KEY = "wealth-projection-v2";

const DEFAULT_STATE = {
  theme: "system",
  currency: "S$",
  currentAge: 30,
  retirementAge: 65,
  endAge: 95,
  monthlyIncome: 4800,
  monthlyExpenses: 3500,
  monthlyRetirementSpend: 3500,
  returnRate: 6,
  inflationRate: 2,
  incomeGrowthRate: 3,
  cpf: {
    enabled: true,
    grossMonthlySalary: 6000,
    oa: 30000,
    sa: 12000,
    ma: 18000,
  },
  accounts: [
    { name: "Bank account", type: "cash", value: 5000 },
    { name: "Brokerage", type: "investments", value: 20000 },
    { name: "SRS", type: "retirement", value: 10000 },
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
      const merged = { ...structuredClone(DEFAULT_STATE), ...saved };
      merged.cpf = { ...structuredClone(DEFAULT_STATE.cpf), ...(saved.cpf || {}) };
      return merged;
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
  if (currency.value !== state.currency) currency.value = "S$"; // unknown saved symbol
  currency.addEventListener("change", () => {
    state.currency = currency.value;
    saveState();
    recompute();
    renderAccounts();
  });
}

/* ---------- CPF ---------- */
const CPF_FIELDS = [
  ["in-cpfSalary", "grossMonthlySalary"],
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

/* ---------- results ---------- */
function recompute() {
  const result = project({
    currentAge: state.currentAge,
    retirementAge: state.retirementAge,
    endAge: state.endAge,
    startNetWorth: accountsTotal(),
    annualIncome: state.monthlyIncome * 12,
    annualExpenses: state.monthlyExpenses * 12,
    annualRetirementSpend: state.monthlyRetirementSpend * 12,
    returnRate: state.returnRate,
    inflationRate: state.inflationRate,
    incomeGrowthRate: state.incomeGrowthRate,
    cpf: state.cpf,
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

document.getElementById("reset-data").addEventListener("click", () => {
  if (!confirm("Reset all data to the defaults?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  bindPlanInputsValuesOnly();
  applyTheme();
  renderAccounts();
  recompute();
});

function bindPlanInputsValuesOnly() {
  for (const key of PLAN_FIELDS) document.getElementById(`in-${key}`).value = state[key];
  document.getElementById("in-currency").value = state.currency;
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
bindThemeToggle();
bindPlanInputs();
bindCpfInputs();
bindViewToggle();
renderAccounts();
recompute();
