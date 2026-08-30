/**
 * Monthly spending log: month-key math, actual-vs-budget variance, and the
 * average that can feed the projection. Pure, no DOM — usable in tests.
 *
 * A month is keyed "YYYY-MM", so keys sort lexicographically in chronological
 * order. One logged month is `{ byCategory: { [id]: amount }, other: amount }`;
 * `other` is the uncategorised bucket, and is the only field when no categories
 * are defined. A month's total always counts every id present, including ids
 * whose category has since been archived or deleted — historical totals must
 * never silently shrink.
 *
 * Categories are optional: the plan's `monthlyExpenses` stays the budget of
 * record, and a category's own `budget` only drives its own variance row.
 */

export const OTHER_ID = "__other__";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ---------- month keys ---------- */

/** Local-time month key for a Date — "2026-08". Local, not UTC, on purpose. */
export function monthKey(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** "2026-08" -> { year: 2026, month: 8 }; null if the key is malformed. */
export function parseMonth(key) {
  if (typeof key !== "string" || !MONTH_RE.test(key)) return null;
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

/** Step a month key by whole months: addMonths("2026-01", -1) -> "2025-12". */
export function addMonths(key, delta) {
  const parsed = parseMonth(key);
  if (!parsed) return key;
  const total = parsed.year * 12 + (parsed.month - 1) + Math.trunc(num(delta, 0));
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "2026-08" -> "August 2026". */
export function formatMonth(key, locale = "en-US") {
  const parsed = parseMonth(key);
  if (!parsed) return "";
  const d = new Date(parsed.year, parsed.month - 1, 1);
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/* ---------- categories ---------- */

/** Categories still in use, in their original order. */
export function activeCategories(categories) {
  return (Array.isArray(categories) ? categories : []).filter((c) => c && !c.archived);
}

/** Sum of the active categories' own budgets. */
export function categoryBudgetTotal(categories) {
  return activeCategories(categories).reduce((sum, c) => sum + num(c.budget, 0), 0);
}

/* ---------- the log ---------- */

/** Everything spent in one month entry, including ids with no live category. */
export function monthTotal(entry) {
  if (!entry) return 0;
  const byCategory = entry.byCategory || {};
  let sum = num(entry.other, 0);
  for (const key of Object.keys(byCategory)) sum += num(byCategory[key], 0);
  return sum;
}

/** True when the month has been logged at all — a single zero still counts. */
export function isLogged(spendLog, key) {
  const entry = spendLog?.[key];
  if (!entry) return false;
  if (Number.isFinite(entry.other)) return true;
  return Object.keys(entry.byCategory || {}).some((id) => Number.isFinite(entry.byCategory[id]));
}

/** Every logged month key, oldest first. */
export function loggedMonths(spendLog) {
  if (!spendLog) return [];
  return Object.keys(spendLog).filter((k) => MONTH_RE.test(k) && isLogged(spendLog, k)).sort();
}

/**
 * One month, actual against budget. `variance = actual − budget`, so a positive
 * variance is an overspend.
 *
 * Rows cover every active category, then any archived or deleted id that still
 * carries an amount this month, then the uncategorised "Other" bucket. Rows with
 * no budget of their own report `budget: null` and `variance: null`.
 *
 * `total.budget` is the plan's `monthlyExpenses` — the budget of record — not
 * the sum of the category budgets.
 */
export function monthVariance(spendLog, key, categories, monthlyExpenses) {
  const entry = spendLog?.[key];
  const logged = isLogged(spendLog, key);
  const byCategory = entry?.byCategory || {};
  const all = Array.isArray(categories) ? categories : [];
  const rows = [];
  const seen = new Set();

  for (const cat of activeCategories(all)) {
    seen.add(cat.id);
    const budget = Number.isFinite(cat.budget) ? cat.budget : null;
    // An unlogged month means "unknown", not "spent nothing".
    const actual = logged ? num(byCategory[cat.id], 0) : null;
    rows.push(row(cat.id, cat.name || "Untitled", false, budget, actual));
  }

  // Archived or deleted categories keep their history visible.
  for (const id of Object.keys(byCategory)) {
    if (seen.has(id)) continue;
    const amount = num(byCategory[id], 0);
    if (amount === 0) continue;
    const known = all.find((c) => c && c.id === id);
    rows.push(row(id, known?.name || "Uncategorised", true, null, amount));
  }

  // Always present, so there is somewhere to put spending that fits no category.
  const otherActual = logged ? num(entry.other, 0) : null;
  rows.push(row(OTHER_ID, "Other", false, null, otherActual));

  const actual = logged ? monthTotal(entry) : null;
  const budget = num(monthlyExpenses, 0);
  return {
    rows,
    total: { budget, actual, variance: logged ? actual - budget : null },
    logged,
  };
}

function row(id, name, archived, budget, actual) {
  const variance = budget === null || actual === null ? null : actual - budget;
  return { id, name, archived, budget, actual, variance };
}

/**
 * Mean monthly total across every logged month at or before `endMonth`.
 * Unlogged months are skipped, never counted as zero.
 * `average` is null when nothing qualifies.
 */
export function averageMonthlySpend(spendLog, { endMonth } = {}) {
  let keys = loggedMonths(spendLog);
  if (endMonth && MONTH_RE.test(endMonth)) keys = keys.filter((k) => k <= endMonth);
  if (keys.length === 0) return { average: null, monthsUsed: 0, monthKeys: [] };
  const sum = keys.reduce((acc, k) => acc + monthTotal(spendLog[k]), 0);
  return { average: sum / keys.length, monthsUsed: keys.length, monthKeys: keys };
}

/**
 * The spending figure the projection should use, and why it chose it.
 * `basis` is "actuals" only when the user asked for it AND something is logged;
 * otherwise it falls back hard to the planned budget — never a blend, because a
 * blended number is one nobody can explain.
 */
export function effectiveExpenses({ spendLog, monthlyExpenses, useActuals, endMonth } = {}) {
  const budget = num(monthlyExpenses, 0);
  const { average, monthsUsed } = averageMonthlySpend(spendLog, { endMonth });
  const useIt = Boolean(useActuals) && monthsUsed > 0;
  const monthly = useIt ? average : budget;
  return { monthly, annual: monthly * 12, basis: useIt ? "actuals" : "budget", monthsUsed };
}

function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
