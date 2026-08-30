/**
 * State shape, persistence and the sanitising funnel every saved or imported
 * blob passes through.
 *
 * Kept free of the DOM so it can be tested the way projection.js and
 * expenses.js are. Storage is passed in rather than reached for, so tests can
 * hand it a plain object instead of a browser.
 */
import { MONTH_RE, isLogged } from "./expenses.js";

export const STORAGE_KEY = "wealth-projection-v3";
export const LEGACY_STORAGE_KEY = "wealth-projection-v2";

export const DEFAULT_STATE = {
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
  spendCategories: [],            // optional: [{ id, name, budget, archived }]
  spendLog: {},                   // "YYYY-MM" -> { byCategory: { id: n }, other: n }
  useActualsForForecast: false,
  events: [],                     // optional: [{ name, age, amount }] in today's money
  lastBackupAt: null,             // ISO string, set when a backup is exported
};

export const ACCOUNT_TYPES = ["cash", "investments", "retirement", "property", "other"];

/* ---------- persistence ---------- */
export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return mergeSaved(JSON.parse(raw));
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
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

export function writeState(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function clearState(storage) {
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY); // else the old data loads again on reload
}

export function mergeSaved(saved) {
  const merged = { ...structuredClone(DEFAULT_STATE), ...saved };
  merged.cpf = { ...structuredClone(DEFAULT_STATE.cpf), ...(saved.cpf || {}) };
  delete merged.cpf.grossMonthlySalary;
  // Replaced wholesale, then sanitised — deep-merging would resurrect deleted
  // categories, and an imported file is no longer a trusted source.
  merged.spendCategories = sanitiseCategories(saved.spendCategories);
  merged.spendLog = sanitiseLog(saved.spendLog);
  merged.useActualsForForecast = Boolean(saved.useActualsForForecast);
  merged.events = sanitiseEvents(saved.events);
  merged.lastBackupAt = sanitiseTimestamp(saved.lastBackupAt);
  if ("accounts" in (saved || {})) merged.accounts = sanitiseAccounts(saved.accounts);
  return merged;
}

/**
 * Accounts are rendered and mutated in place, so anything that isn't a list of
 * plain objects would throw mid-render — and an imported file is not trusted.
 */
export function sanitiseAccounts(list) {
  if (!Array.isArray(list)) return structuredClone(DEFAULT_STATE.accounts);
  return list
    .filter((a) => a && typeof a === "object")
    .map((a) => ({
      name: String(a.name ?? ""),
      type: ACCOUNT_TYPES.includes(a.type) ? a.type : "other",
      value: Number.isFinite(a.value) ? a.value : 0,
    }));
}

export function newId() {
  return crypto.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function sanitiseCategories(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter((c) => c && typeof c === "object").map((c) => {
    let id = typeof c.id === "string" && c.id && !seen.has(c.id) ? c.id : newId();
    seen.add(id);
    const cat = { id, name: String(c.name ?? "") };
    if (Number.isFinite(c.budget)) cat.budget = c.budget;
    if (c.archived) cat.archived = true;
    return cat;
  });
}

/**
 * Events reach the projection engine, which ignores a non-finite age but would
 * happily arithmetic on a string amount. Rows are also rendered and mutated in
 * place, so the shape has to survive an untrusted import.
 *
 * An unusable age becomes null rather than 0 — the row stays editable and the
 * engine skips it, where 0 would claim to be a real age nobody reaches.
 */
export function sanitiseEvents(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      name: String(e.name ?? ""),
      age: Number.isFinite(e.age) ? e.age : null,
      amount: Number.isFinite(e.amount) && e.amount >= 0 ? e.amount : 0,
    }));
}

export function sanitiseLog(log) {
  if (!log || typeof log !== "object") return {};
  const out = {};
  for (const key of Object.keys(log)) {
    if (!MONTH_RE.test(key)) continue;
    const entry = log[key];
    if (!entry || typeof entry !== "object") continue;
    const clean = { byCategory: {} };
    const by = entry.byCategory && typeof entry.byCategory === "object" ? entry.byCategory : {};
    for (const id of Object.keys(by)) {
      if (Number.isFinite(by[id]) && by[id] >= 0) clean.byCategory[id] = by[id];
    }
    if (Number.isFinite(entry.other) && entry.other >= 0) clean.other = entry.other;
    if (isLogged({ [key]: clean }, key)) out[key] = clean;
  }
  return out;
}

/**
 * Kept as an ISO string so an unparseable one degrades to "never backed up"
 * rather than rendering "Invalid Date" in the footer.
 */
export function sanitiseTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

/* ---------- backup freshness ---------- */

/** A backup older than this is worth nagging about. */
export const BACKUP_STALE_DAYS = 30;

const DAY_MS = 86400000;

/**
 * Everything lives in one browser's local storage, so a cleared site is a
 * cleared history. This drives the footer line that says how long it has been.
 *
 * `hasData` keeps a fresh install quiet: with nothing logged there is nothing
 * to lose yet, so "no backup" is a fact rather than a warning.
 */
export function backupHint(lastBackupAt, { hasData = false, now = Date.now() } = {}) {
  const at = typeof lastBackupAt === "string" ? Date.parse(lastBackupAt) : NaN;
  if (!Number.isFinite(at)) {
    return hasData
      ? { label: "Never backed up.", stale: true }
      : { label: "No backup yet.", stale: false };
  }

  // A clock that moved backwards (timezone change, an imported future date)
  // should read as "just now", never as a negative age.
  const days = Math.max(0, Math.floor((now - at) / DAY_MS));
  return { label: `Last backup: ${describeAge(days)}.`, stale: days >= BACKUP_STALE_DAYS };
}

function describeAge(days) {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "over a year ago" : `over ${years} years ago`;
}
