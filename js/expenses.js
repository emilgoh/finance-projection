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
 *
 * Every category is either fixed (rent, insurance — the same bill each month)
 * or variable (groceries, going out). The split is presentational: it groups
 * the log and gives each group a subtotal, and changes no total and no average.
 *
 * Daily expenses are a separate, flat list — one row per thing bought. They do
 * not replace the month log; they feed it. For any month and category that has
 * daily entries, their sum *is* that cell, and the typed figure is ignored;
 * every other cell stays hand-typed. That is what lets rent be logged once a
 * month and groceries logged as they happen. `effectiveSpendLog()` performs
 * that merge, and everything downstream — variance, averages, the forecast —
 * reads the merged log rather than either source.
 *
 * The savings log reuses the month-entry shape exactly, with buckets standing
 * in for categories and a `target` standing in for a `budget`, so every helper
 * here works on both. The one thing that does not carry over is the reading of
 * the sign: an overspend is bad, but saving more than the target is good, and
 * that judgement belongs to whatever renders the number.
 */

export const OTHER_ID = "__other__";

export const KINDS = ["fixed", "variable"];

export const KIND_LABELS = { fixed: "Fixed", variable: "Variable" };

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

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

/**
 * True for a real calendar day. The shape check alone would pass 2026-02-31,
 * which would then sort into February and never be reachable from a calendar.
 */
export function isDateKey(key) {
  if (typeof key !== "string" || !DATE_RE.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local-time day key for a Date — "2026-08-05". Local, not UTC, on purpose. */
export function dayKey(date) {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The month a day belongs to: "2026-08-05" -> "2026-08". */
export function monthOfDay(key) {
  return isDateKey(key) ? key.slice(0, 7) : null;
}

/** "2026-08-05" -> "Wed 5 Aug". */
export function formatDay(key, locale = "en-US") {
  if (!isDateKey(key)) return "";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
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

/**
 * A category's kind, defaulting to variable. Anything unrecognised — an old
 * blob written before the split, a hostile import — reads as variable rather
 * than being dropped: guessing "fixed" would understate what can be cut.
 */
export function categoryKind(cat) {
  return cat?.kind === "fixed" ? "fixed" : "variable";
}

/** Active categories of one kind, in their original order. */
export function categoriesOfKind(categories, kind) {
  return activeCategories(categories).filter((c) => categoryKind(c) === kind);
}

/** Sum of the active categories' own budgets; one kind only when asked. */
export function categoryBudgetTotal(categories, kind) {
  const list = kind ? categoriesOfKind(categories, kind) : activeCategories(categories);
  return list.reduce((sum, c) => sum + num(c.budget, 0), 0);
}

/** Sum of the active savings buckets' monthly targets. */
export function bucketTargetTotal(buckets) {
  return activeCategories(buckets).reduce((sum, b) => sum + num(b.target, 0), 0);
}

/* ---------- daily expenses ---------- */

/**
 * One month's entries, oldest day first, and within a day in the order they
 * were added — the order they were spent in, as far as anything here knows.
 */
export function entriesForMonth(dailyExpenses, key) {
  if (!Array.isArray(dailyExpenses) || !MONTH_RE.test(key ?? "")) return [];
  return dailyExpenses
    .filter((e) => e && monthOfDay(e.date) === key)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The same entries grouped by day, oldest day first, with each day's total. */
export function entriesByDay(dailyExpenses, key) {
  const days = new Map();
  for (const entry of entriesForMonth(dailyExpenses, key)) {
    if (!days.has(entry.date)) days.set(entry.date, { date: entry.date, entries: [], total: 0 });
    const day = days.get(entry.date);
    day.entries.push(entry);
    day.total += num(entry.amount, 0);
  }
  return [...days.values()];
}

/**
 * One month of daily entries folded into the month-entry shape, plus a count
 * per id. The counts are what tell a caller which cells are entry-driven —
 * a category summing to zero is still driven by its entries, so a zero total
 * and no entries at all must stay distinguishable.
 */
export function dailyMonthTotals(dailyExpenses, key) {
  const totals = { byCategory: {}, counts: new Map() };
  for (const entry of entriesForMonth(dailyExpenses, key)) {
    const id = entry.categoryId || OTHER_ID;
    const amount = num(entry.amount, 0);
    if (id === OTHER_ID) totals.other = num(totals.other, 0) + amount;
    else totals.byCategory[id] = num(totals.byCategory[id], 0) + amount;
    totals.counts.set(id, (totals.counts.get(id) ?? 0) + 1);
  }
  return totals;
}

/**
 * The log the rest of the app should read: the typed month log with every
 * entry-driven cell replaced by the sum of its daily entries.
 *
 * Replaced, never added to — a typed figure and a daily list are two answers to
 * the same question, and summing them would quietly double-count the month you
 * started logging daily. The typed figure is left in storage untouched, so it
 * comes back if the entries are removed.
 */
export function effectiveSpendLog(spendLog, dailyExpenses) {
  const months = new Set(Object.keys(spendLog || {}).filter((k) => MONTH_RE.test(k)));
  for (const entry of Array.isArray(dailyExpenses) ? dailyExpenses : []) {
    const month = monthOfDay(entry?.date);
    if (month) months.add(month);
  }

  const merged = {};
  for (const month of months) {
    const typed = spendLog?.[month];
    const daily = dailyMonthTotals(dailyExpenses, month);
    const entry = { byCategory: { ...(typed?.byCategory || {}) } };
    if (Number.isFinite(typed?.other)) entry.other = typed.other;
    Object.assign(entry.byCategory, daily.byCategory);
    if (Number.isFinite(daily.other)) entry.other = daily.other;
    if (isLogged({ [month]: entry }, month)) merged[month] = entry;
  }
  return merged;
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
  const logged = isLogged(spendLog, key);
  const rows = varianceRows(spendLog?.[key], logged, categories, {
    plannedKey: "budget", otherLabel: "Other", unknownLabel: "Uncategorised",
  });
  const actual = logged ? monthTotal(spendLog[key]) : null;
  const budget = num(monthlyExpenses, 0);
  return {
    rows,
    total: { budget, actual, variance: logged ? actual - budget : null },
    logged,
  };
}

/**
 * The same month, split into fixed and variable groups with a subtotal each.
 * Every row of `monthVariance` appears in exactly one group, and the returned
 * `total` is still the whole month — the grouping is a lens, not a filter.
 *
 * "Other" and any orphaned id whose category is gone land under variable:
 * nothing left standing says they were a fixed commitment, and variable is the
 * assumption that overstates rather than understates what could be cut.
 *
 * A subtotal's `budget` counts only the rows in that group that set one, so a
 * group holding unbudgeted rows reports a variance against a partial budget.
 * That is the honest reading — the alternative is a subtotal that silently
 * pretends an unbudgeted row was budgeted at zero.
 */
export function monthSections(spendLog, key, categories, monthlyExpenses) {
  const result = monthVariance(spendLog, key, categories, monthlyExpenses);
  const kindById = new Map(
    (Array.isArray(categories) ? categories : [])
      .filter((c) => c && typeof c === "object")
      .map((c) => [c.id, categoryKind(c)]),
  );
  const sections = KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind], rows: [] }));
  const byKind = new Map(sections.map((s) => [s.kind, s]));
  for (const r of result.rows) {
    const kind = r.id === OTHER_ID ? "variable" : kindById.get(r.id) || "variable";
    byKind.get(kind).rows.push(r);
  }
  for (const section of sections) section.subtotal = subtotal(section.rows, result.logged);
  return { ...result, sections };
}

/**
 * One month of savings, actual against target. Buckets are categories in every
 * way that matters here, so the rows come out in the same shape — `budget` on a
 * row is that bucket's monthly target.
 *
 * `total.target` is the sum of the active buckets' targets. There is no
 * plan-level savings figure to be the number of record, unlike spending, where
 * `monthlyExpenses` is.
 */
export function savingsVariance(savingsLog, key, buckets) {
  const logged = isLogged(savingsLog, key);
  const rows = varianceRows(savingsLog?.[key], logged, buckets, {
    plannedKey: "target", otherLabel: "Unallocated", unknownLabel: "Unassigned",
  });
  const actual = logged ? monthTotal(savingsLog[key]) : null;
  const target = bucketTargetTotal(buckets);
  return {
    rows,
    total: { target, actual, variance: logged ? actual - target : null },
    logged,
  };
}

/**
 * Shared by spending and savings. `items` are categories or buckets; the
 * planned amount is read from `plannedKey` and always lands on the row as
 * `budget`, so one renderer covers both.
 */
function varianceRows(entry, logged, items, { plannedKey, otherLabel, unknownLabel }) {
  const byCategory = entry?.byCategory || {};
  const all = Array.isArray(items) ? items : [];
  const rows = [];
  const seen = new Set();

  for (const item of activeCategories(all)) {
    seen.add(item.id);
    const planned = Number.isFinite(item[plannedKey]) ? item[plannedKey] : null;
    // An unlogged month means "unknown", not "spent nothing".
    const actual = logged ? num(byCategory[item.id], 0) : null;
    rows.push(row(item.id, item.name || "Untitled", false, planned, actual));
  }

  // Archived or deleted categories keep their history visible.
  for (const id of Object.keys(byCategory)) {
    if (seen.has(id)) continue;
    const amount = num(byCategory[id], 0);
    if (amount === 0) continue;
    const known = all.find((c) => c && c.id === id);
    rows.push(row(id, known?.name || unknownLabel, true, null, amount));
  }

  // Always present, so there is somewhere to put what fits no category.
  rows.push(row(OTHER_ID, otherLabel, false, null, logged ? num(entry.other, 0) : null));
  return rows;
}

function subtotal(rows, logged) {
  let budget = null;
  for (const r of rows) if (r.budget !== null) budget = num(budget, 0) + r.budget;
  const actual = logged ? rows.reduce((sum, r) => sum + num(r.actual, 0), 0) : null;
  return {
    budget,
    actual,
    variance: budget === null || actual === null ? null : actual - budget,
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
