import { project, CPF, TAX } from "./projection.js";
import { renderChart } from "./chart.js";

const STORAGE_KEY = "wealth-projection-v3";
const LEGACY_STORAGE_KEY = "wealth-projection-v2";

const DEFAULT_STATE = {
  theme: "system",
  currency: "S$",
  currentAge: 30,
  retirementAge: 65,
  endAge: 95,
  monthlyGrossIncome: 6000,
  monthlyExpenses: 3500,
  monthlyRetirementSpend: 3500,
  returnRate: 6,
  inflationRate: 2,
  incomeGrowthRate: 3,
  includeTax: true,
  cpf: {
    enabled: true,
    oa: 30000,
    sa: 12000,
    ma: 18000,
  },
  accounts: [
    { name: "Bank account", type: "cash", value: 5000 },
    { name: "Brokerage", type: "investments", value: 20000 },
    { name: "SRS", type: "retirement", value: 10000 },
  ],
  events: [],
};

const ACCOUNT_TYPES = ["cash", "investments", "retirement", "property", "other"];

let state = loadState();
let disposeChart = () => {};

/* ---------- persistence ---------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeSaved(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      // v2 stored take-home income plus a separate CPF gross salary; income
      // is now gross, so prefer the old gross salary when it exists.
      const old = JSON.parse(legacy);
      old.monthlyGrossIncome = old.cpf?.grossMonthlySalary ?? old.monthlyIncome;
      delete old.monthlyIncome;
      return mergeSaved(old);
    }
  } catch { /* corrupt storage — fall back to defaults */ }
  return structuredClone(DEFAULT_STATE);
}

function mergeSaved(saved) {
  const merged = { ...structuredClone(DEFAULT_STATE), ...saved };
  merged.cpf = { ...structuredClone(DEFAULT_STATE.cpf), ...(saved.cpf || {}) };
  delete merged.cpf.grossMonthlySalary;
  if (!Array.isArray(merged.accounts)) merged.accounts = [];
  if (!Array.isArray(merged.events)) merged.events = [];
  return merged;
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

/* ---------- life events ---------- */
function renderEvents() {
  const list = document.getElementById("events-list");
  list.textContent = "";
  state.events.forEach((event, i) => {
    const row = document.createElement("div");
    row.className = "event-row";

    const name = document.createElement("input");
    name.type = "text";
    name.value = event.name;
    name.placeholder = "Event (e.g. home down payment)";
    name.setAttribute("aria-label", "Event name");
    name.addEventListener("input", () => {
      event.name = name.value;
      saveState();
    });

    const age = document.createElement("input");
    age.type = "number";
    age.step = "1";
    age.min = "16";
    age.max = "120";
    age.value = event.age;
    age.setAttribute("aria-label", "At age");
    age.title = "At age";
    age.addEventListener("input", () => {
      const v = parseFloat(age.value);
      event.age = Number.isFinite(v) ? v : 0;
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
      const v = parseFloat(amount.value);
      event.amount = Number.isFinite(v) ? v : 0;
      saveState();
      recompute();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "account-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${event.name || "event"}`);
    remove.addEventListener("click", () => {
      state.events.splice(i, 1);
      saveState();
      renderEvents();
      recompute();
    });

    row.append(name, age, amount, remove);
    list.append(row);
  });
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
    annualGrossIncome: state.monthlyGrossIncome * 12,
    annualExpenses: state.monthlyExpenses * 12,
    annualRetirementSpend: state.monthlyRetirementSpend * 12,
    returnRate: state.returnRate,
    inflationRate: state.inflationRate,
    incomeGrowthRate: state.incomeGrowthRate,
    includeTax: state.includeTax,
    cpf: state.cpf,
    events: state.events,
  });

  updateIncomeHint();
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

/* ---------- import / export ---------- */
document.getElementById("export-data").addEventListener("click", () => {
  const payload = {
    app: "wealth-projection",
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wealth-projection-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("import-data").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = ""; // allow re-importing the same file
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // accept both an export payload and a bare state object
    const saved = parsed && typeof parsed.state === "object" ? parsed.state : parsed;
    if (!saved || typeof saved !== "object" ||
        !("accounts" in saved || "cpf" in saved || "monthlyGrossIncome" in saved)) {
      throw new Error("not a wealth-projection export");
    }
    if (!confirm("Replace your current data with the imported file?")) return;
    if (saved.monthlyIncome != null && saved.monthlyGrossIncome == null) {
      // legacy shape: take-home income + CPF gross salary
      saved.monthlyGrossIncome = saved.cpf?.grossMonthlySalary ?? saved.monthlyIncome;
      delete saved.monthlyIncome;
    }
    state = mergeSaved(saved);
    saveState();
    bindPlanInputsValuesOnly();
    applyTheme();
    renderAccounts();
    renderEvents();
    recompute();
  } catch {
    alert("Couldn't import that file — it doesn't look like a wealth-projection export.");
  }
});

document.getElementById("reset-data").addEventListener("click", () => {
  if (!confirm("Reset all data to the defaults?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  bindPlanInputsValuesOnly();
  applyTheme();
  renderAccounts();
  renderEvents();
  recompute();
});

function bindPlanInputsValuesOnly() {
  for (const key of PLAN_FIELDS) document.getElementById(`in-${key}`).value = state[key];
  document.getElementById("in-currency").value = state.currency;
  document.getElementById("in-includeTax").checked = state.includeTax;
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
renderEvents();
recompute();
