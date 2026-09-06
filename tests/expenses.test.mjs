import test from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_ID, monthKey, parseMonth, addMonths, formatMonth,
  isDateKey, dayKey, monthOfDay, formatDay,
  entriesForMonth, entriesByDay, dailyMonthTotals, effectiveSpendLog,
  activeCategories, categoryKind, categoriesOfKind, categoryBudgetTotal, bucketTargetTotal,
  monthTotal, isLogged, loggedMonths, monthVariance, monthSections, savingsVariance,
  averageMonthlySpend, effectiveExpenses,
} from "../js/expenses.js";
import { project } from "../js/projection.js";

const cats = [
  { id: "c1", name: "Housing", budget: 1500 },
  { id: "c2", name: "Food", budget: 800 },
  { id: "c3", name: "Transport", budget: 300 },
  { id: "c4", name: "Gym", budget: 100, archived: true },
];

// Two logged months, a gap at 2026-05, and an orphan id in the later month.
const log = {
  "2026-06": { byCategory: { c1: 1500, c2: 900, c3: 250 }, other: 150 }, // 2800
  "2026-04": { byCategory: { c1: 1500, c2: 700, gone: 200 }, other: 0 }, // 2400
};

/* ---------- month keys ---------- */

test("month keys step across year boundaries in both directions", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-06", -18), "2024-12");
  assert.equal(addMonths("2026-06", 0), "2026-06");
});

test("monthKey reads local time, not UTC", () => {
  // new Date(2026, 7, 3) is 3 August locally; a UTC read could roll to July.
  assert.equal(monthKey(new Date(2026, 7, 3)), "2026-08");
  assert.equal(monthKey(new Date(2026, 0, 1)), "2026-01");
  assert.equal(monthKey(new Date(2026, 11, 31)), "2026-12");
});

test("parseMonth rejects malformed keys", () => {
  assert.deepEqual(parseMonth("2026-08"), { year: 2026, month: 8 });
  assert.equal(parseMonth("2026-13"), null);
  assert.equal(parseMonth("2026-00"), null);
  assert.equal(parseMonth("26-01"), null);
  assert.equal(parseMonth(""), null);
  assert.equal(parseMonth(null), null);
});

test("formatMonth spells the month out", () => {
  assert.equal(formatMonth("2026-08"), "August 2026");
  assert.equal(formatMonth("nonsense"), "");
});

/* ---------- categories ---------- */

test("archived categories drop out of the active list and the budget total", () => {
  assert.deepEqual(activeCategories(cats).map((c) => c.id), ["c1", "c2", "c3"]);
  assert.equal(categoryBudgetTotal(cats), 2600);
  assert.equal(categoryBudgetTotal([{ id: "x", name: "x" }]), 0); // no budget set
  assert.equal(categoryBudgetTotal(undefined), 0);
});

/* ---------- reading the log ---------- */

test("monthTotal counts every id present, including orphans", () => {
  assert.equal(monthTotal(log["2026-06"]), 2800);
  assert.equal(monthTotal(log["2026-04"]), 2400); // includes the 200 under "gone"
  assert.equal(monthTotal(undefined), 0);
  assert.equal(monthTotal({ byCategory: {} }), 0);
});

test("isLogged is true for a month holding a single zero", () => {
  assert.equal(isLogged(log, "2026-06"), true);
  assert.equal(isLogged(log, "2026-05"), false);
  assert.equal(isLogged({ "2026-01": {} }, "2026-01"), false);
  assert.equal(isLogged({ "2026-01": { other: 0 } }, "2026-01"), true);
  assert.equal(isLogged({ "2026-01": { byCategory: { c1: 0 } } }, "2026-01"), true);
});

test("loggedMonths sorts ascending and skips gaps and junk", () => {
  const messy = { ...log, "2026-13": { other: 999 }, "2026-05": {} };
  assert.deepEqual(loggedMonths(messy), ["2026-04", "2026-06"]);
  assert.deepEqual(loggedMonths({}), []);
});

/* ---------- variance ---------- */

test("variance is positive when overspent, negative when under", () => {
  const { rows, total } = monthVariance(log, "2026-06", cats, 2600);
  const food = rows.find((r) => r.id === "c2");
  const transport = rows.find((r) => r.id === "c3");
  assert.equal(food.variance, 100); // 900 spent against an 800 budget
  assert.equal(transport.variance, -50);
  assert.equal(total.actual, 2800);
  assert.equal(total.budget, 2600);
  assert.equal(total.variance, 200);
});

test("an unlogged month reports unknown, not zero", () => {
  const { rows, total, logged } = monthVariance(log, "2026-05", cats, 2600);
  assert.equal(logged, false);
  assert.equal(total.actual, null);
  assert.equal(total.variance, null);
  for (const r of rows) assert.equal(r.actual, null, `${r.id} should be unknown`);
});

test("a logged month with no entry for a category counts as zero spent", () => {
  const { rows } = monthVariance(log, "2026-04", cats, 2600);
  const transport = rows.find((r) => r.id === "c3");
  assert.equal(transport.actual, 0);
  assert.equal(transport.variance, -300);
});

test("orphan and archived ids keep their history visible", () => {
  const { rows, total } = monthVariance(log, "2026-04", cats, 2600);
  const orphan = rows.find((r) => r.id === "gone");
  assert.equal(orphan.name, "Uncategorised");
  assert.equal(orphan.actual, 200);
  assert.equal(orphan.budget, null);
  assert.equal(orphan.variance, null);
  // the row sum still matches the month total
  const summed = rows.reduce((s, r) => s + (r.actual ?? 0), 0);
  assert.equal(summed, total.actual);

  const archived = { "2026-04": { byCategory: { c4: 90 }, other: 0 } };
  const gymRow = monthVariance(archived, "2026-04", cats, 2600).rows.find((r) => r.id === "c4");
  assert.equal(gymRow.name, "Gym"); // archived, but still named
  assert.equal(gymRow.archived, true);
});

test("the Other row is always offered, even with no categories at all", () => {
  const bare = { "2026-06": { byCategory: {}, other: 3100 } };
  const { rows, total } = monthVariance(bare, "2026-06", [], 3500);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, OTHER_ID);
  assert.equal(rows[0].actual, 3100);
  assert.equal(total.variance, -400);

  const withCats = monthVariance(log, "2026-04", cats, 2600).rows;
  assert.ok(withCats.some((r) => r.id === OTHER_ID), "Other row present alongside categories");
});

test("a category with no budget of its own reports no variance", () => {
  const loose = [{ id: "c1", name: "Housing" }];
  const { rows } = monthVariance(log, "2026-06", loose, 2600);
  assert.equal(rows[0].budget, null);
  assert.equal(rows[0].actual, 1500);
  assert.equal(rows[0].variance, null);
});

/* ---------- the feedback loop ---------- */

test("the average skips gaps rather than counting them as zero", () => {
  const { average, monthsUsed, monthKeys } = averageMonthlySpend(log);
  assert.equal(monthsUsed, 2);
  assert.deepEqual(monthKeys, ["2026-04", "2026-06"]);
  assert.equal(average, 2600); // (2400 + 2800) / 2, not divided by three
});

test("months after endMonth are excluded from the average", () => {
  assert.equal(averageMonthlySpend(log, { endMonth: "2026-05" }).average, 2400);
  assert.equal(averageMonthlySpend(log, { endMonth: "2026-03" }).monthsUsed, 0);
});

test("an empty log has no average at all", () => {
  const { average, monthsUsed } = averageMonthlySpend({});
  assert.equal(average, null);
  assert.equal(monthsUsed, 0);
});

test("effectiveExpenses falls back hard to the budget when nothing is logged", () => {
  const off = effectiveExpenses({ spendLog: log, monthlyExpenses: 3500, useActuals: false });
  assert.equal(off.basis, "budget");
  assert.equal(off.monthly, 3500);
  assert.equal(off.annual, 42000);

  const empty = effectiveExpenses({ spendLog: {}, monthlyExpenses: 3500, useActuals: true });
  assert.equal(empty.basis, "budget");
  assert.equal(empty.monthly, 3500);
  assert.equal(empty.monthsUsed, 0);
});

test("effectiveExpenses uses the logged average when asked and able", () => {
  const on = effectiveExpenses({ spendLog: log, monthlyExpenses: 3500, useActuals: true });
  assert.equal(on.basis, "actuals");
  assert.equal(on.monthly, 2600);
  assert.equal(on.annual, 31200);
  assert.equal(on.monthsUsed, 2);
});

/* ---------- the loop actually closes ---------- */

const base = {
  currentAge: 30,
  retirementAge: 65,
  endAge: 90,
  startNetWorth: 40000,
  annualGrossIncome: 90000,
  annualRetirementSpend: 42000,
  returnRate: 6,
  inflationRate: 2.5,
  incomeGrowthRate: 3,
  startYear: 2026,
  includeTax: false,
};

test("spending more than planned lowers the projection when actuals drive it", () => {
  const overspending = {
    "2026-04": { byCategory: {}, other: 4000 },
    "2026-05": { byCategory: {}, other: 4200 },
  };
  const args = { spendLog: overspending, monthlyExpenses: 3500 };
  const budget = effectiveExpenses({ ...args, useActuals: false });
  const actuals = effectiveExpenses({ ...args, useActuals: true });
  assert.equal(actuals.monthly, 4100);

  const onBudget = project({ ...base, annualExpenses: budget.annual });
  const onActuals = project({ ...base, annualExpenses: actuals.annual });
  assert.ok(
    onActuals.retirementRow.nominal < onBudget.retirementRow.nominal,
    "overspending should leave less at retirement",
  );
});

/* ---------- fixed and variable ---------- */

const split = [
  { id: "c1", name: "Rent", kind: "fixed", budget: 1500 },
  { id: "c2", name: "Food", kind: "variable", budget: 800 },
  { id: "c3", name: "Insurance", kind: "fixed", budget: 200 },
];

test("a category with no kind reads as variable, not as dropped", () => {
  assert.equal(categoryKind({ id: "x", name: "Old" }), "variable");
  assert.equal(categoryKind({ id: "x", kind: "FIXED" }), "variable", "only the exact value counts");
  assert.equal(categoryKind(undefined), "variable");
  assert.equal(categoryKind({ id: "x", kind: "fixed" }), "fixed");
});

test("categoriesOfKind keeps original order and skips archived", () => {
  const list = [...split, { id: "c4", name: "Gym", kind: "fixed", budget: 90, archived: true }];
  assert.deepEqual(categoriesOfKind(list, "fixed").map((c) => c.name), ["Rent", "Insurance"]);
  assert.deepEqual(categoriesOfKind(list, "variable").map((c) => c.name), ["Food"]);
});

test("categoryBudgetTotal filters by kind only when asked", () => {
  assert.equal(categoryBudgetTotal(split), 2500);
  assert.equal(categoryBudgetTotal(split, "fixed"), 1700);
  assert.equal(categoryBudgetTotal(split, "variable"), 800);
});

test("sections hold every row exactly once, and the total stays the whole month", () => {
  const log = { "2026-06": { byCategory: { c1: 1500, c2: 900, c3: 200 }, other: 50 } };
  const { sections, rows, total } = monthSections(log, "2026-06", split, 2500);
  const grouped = sections.flatMap((s) => s.rows);
  assert.equal(grouped.length, rows.length);
  assert.deepEqual(new Set(grouped.map((r) => r.id)), new Set(rows.map((r) => r.id)));
  assert.equal(total.actual, 2650, "the grouping is a lens, not a filter");
});

test("Other and orphaned ids land under variable", () => {
  const log = { "2026-06": { byCategory: { gone: 40 }, other: 50 } };
  const { sections } = monthSections(log, "2026-06", split, 2500);
  const variable = sections.find((s) => s.kind === "variable");
  assert.ok(variable.rows.some((r) => r.id === OTHER_ID));
  assert.ok(variable.rows.some((r) => r.id === "gone"));
  assert.deepEqual(sections.find((s) => s.kind === "fixed").rows.map((r) => r.id), ["c1", "c3"]);
});

test("subtotals count their own group, and only the budgets that group set", () => {
  const log = { "2026-06": { byCategory: { c1: 1600, c2: 900, c3: 200 }, other: 50 } };
  const { sections } = monthSections(log, "2026-06", split, 2500);
  const fixed = sections.find((s) => s.kind === "fixed").subtotal;
  assert.deepEqual(fixed, { budget: 1700, actual: 1800, variance: 100 });

  // Food budgets 800; Other and the untracked rest carry no budget of their own.
  const variable = sections.find((s) => s.kind === "variable").subtotal;
  assert.deepEqual(variable, { budget: 800, actual: 950, variance: 150 });
});

test("a subtotal with no budgets anywhere in the group reports none", () => {
  const bare = [{ id: "c1", name: "Rent", kind: "fixed" }];
  const log = { "2026-06": { byCategory: { c1: 1500 } } };
  const { sections } = monthSections(log, "2026-06", bare, 2500);
  assert.deepEqual(sections.find((s) => s.kind === "fixed").subtotal,
    { budget: null, actual: 1500, variance: null });
});

test("an unlogged month leaves every subtotal unknown rather than zero", () => {
  const { sections, logged } = monthSections({}, "2026-06", split, 2500);
  assert.equal(logged, false);
  for (const s of sections) assert.equal(s.subtotal.actual, null);
});

test("both groups exist even when one is empty, so the shape never varies", () => {
  const { sections } = monthSections({}, "2026-06", [], 2500);
  assert.deepEqual(sections.map((s) => s.kind), ["fixed", "variable"]);
  assert.equal(sections.find((s) => s.kind === "fixed").rows.length, 0);
});

/* ---------- savings ---------- */

const buckets = [
  { id: "b1", name: "Emergency fund", target: 500 },
  { id: "b2", name: "Brokerage", target: 1000 },
  { id: "b3", name: "Old goal", target: 200, archived: true },
];

test("bucket targets total only the live buckets", () => {
  assert.equal(bucketTargetTotal(buckets), 1500);
  assert.equal(bucketTargetTotal(null), 0);
});

test("savings variance is positive when ahead of target, negative when short", () => {
  const log = { "2026-06": { byCategory: { b1: 500, b2: 800 }, other: 300 } };
  const { rows, total } = savingsVariance(log, "2026-06", buckets);
  assert.deepEqual(rows.find((r) => r.id === "b1"), {
    id: "b1", name: "Emergency fund", archived: false, budget: 500, actual: 500, variance: 0,
  });
  assert.equal(rows.find((r) => r.id === "b2").variance, -200, "short of target");
  assert.deepEqual(total, { target: 1500, actual: 1600, variance: 100 });
});

test("the unallocated savings row is always offered and carries no target", () => {
  const { rows } = savingsVariance({}, "2026-06", buckets);
  const other = rows.find((r) => r.id === OTHER_ID);
  assert.equal(other.name, "Unallocated");
  assert.equal(other.budget, null);
  assert.equal(other.actual, null, "an unlogged month is unknown, not zero");
});

test("an archived bucket with money logged this month keeps its own name", () => {
  const log = { "2026-06": { byCategory: { b3: 200 } } };
  const { rows } = savingsVariance(log, "2026-06", buckets);
  const row = rows.find((r) => r.id === "b3");
  assert.equal(row.name, "Old goal");
  assert.equal(row.archived, true);
  assert.equal(row.actual, 200);
});

test("savings and spending are separate ledgers — neither shows in the other", () => {
  const spendLog = { "2026-06": { byCategory: { c1: 1500 } } };
  const savingsLog = { "2026-06": { byCategory: { b1: 500 } } };
  assert.equal(monthSections(spendLog, "2026-06", split, 2500).total.actual, 1500);
  assert.equal(savingsVariance(savingsLog, "2026-06", buckets).total.actual, 500);
  assert.equal(savingsVariance(spendLog, "2026-06", buckets).total.actual, 1500,
    "the shapes are interchangeable, so only the caller keeps them apart");
});

test("logged savings never reach the projection's expense basis", () => {
  const savingsLog = { "2026-06": { byCategory: { b1: 5000 } } };
  const withSavings = effectiveExpenses({
    spendLog: { "2026-06": { other: 2000 } },
    monthlyExpenses: 3500,
    useActuals: true,
    endMonth: "2026-07",
  });
  assert.equal(withSavings.monthly, 2000, "only the spend log feeds it");
  assert.equal(monthTotal(savingsLog["2026-06"]), 5000, "and the savings log is untouched by it");
});

/* ---------- daily expenses ---------- */

const daily = [
  { id: "e1", date: "2026-06-03", categoryId: "c2", amount: 40, note: "" },
  { id: "e2", date: "2026-06-01", categoryId: "c2", amount: 60, note: "" },
  { id: "e3", date: "2026-06-01", categoryId: null, amount: 25, note: "taxi" },
  { id: "e4", date: "2026-07-02", categoryId: "c1", amount: 900, note: "" },
];

test("isDateKey rejects a day that does not exist, not just a malformed one", () => {
  assert.equal(isDateKey("2026-06-03"), true);
  assert.equal(isDateKey("2026-02-31"), false, "the shape passes; the calendar does not");
  assert.equal(isDateKey("2026-02-29"), false, "2026 is not a leap year");
  assert.equal(isDateKey("2028-02-29"), true, "2028 is");
  for (const bad of ["2026-13-01", "2026-06-00", "2026-6-3", "not-a-date", "", null, 20260603]) {
    assert.equal(isDateKey(bad), false, `${bad} is not a day`);
  }
});

test("dayKey reads local time, not UTC", () => {
  // 23:30 local on the 3rd is already the 4th in UTC; the day key must not slip.
  assert.equal(dayKey(new Date(2026, 5, 3, 23, 30)), "2026-06-03");
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("monthOfDay gives the month a day belongs to, or nothing at all", () => {
  assert.equal(monthOfDay("2026-06-03"), "2026-06");
  assert.equal(monthOfDay("2026-02-31"), null);
  assert.equal(monthOfDay(undefined), null);
});

test("formatDay names the weekday, so a mis-dated entry is visible", () => {
  assert.equal(formatDay("2026-06-03"), "Wed, Jun 3");
  assert.equal(formatDay("nonsense"), "");
});

test("entriesForMonth keeps only that month, oldest day first", () => {
  const june = entriesForMonth(daily, "2026-06");
  assert.deepEqual(june.map((e) => e.id), ["e2", "e3", "e1"]);
  assert.deepEqual(entriesForMonth(daily, "2026-07").map((e) => e.id), ["e4"]);
  assert.deepEqual(entriesForMonth(daily, "2026-05"), []);
});

test("entriesForMonth holds the order entries were added to a single day", () => {
  const sameDay = [
    { id: "b", date: "2026-06-01", amount: 1 },
    { id: "a", date: "2026-06-01", amount: 2 },
  ];
  assert.deepEqual(entriesForMonth(sameDay, "2026-06").map((e) => e.id), ["b", "a"]);
});

test("entriesByDay groups with a total each, and skips days with nothing", () => {
  const days = entriesByDay(daily, "2026-06");
  assert.deepEqual(days.map((d) => [d.date, d.entries.length, d.total]), [
    ["2026-06-01", 2, 85],
    ["2026-06-03", 1, 40],
  ]);
});

test("dailyMonthTotals folds entries into the month-entry shape", () => {
  const totals = dailyMonthTotals(daily, "2026-06");
  assert.deepEqual(totals.byCategory, { c2: 100 });
  assert.equal(totals.other, 25, "uncategorised entries land in Other");
  assert.deepEqual([...totals.counts], [["c2", 2], [OTHER_ID, 1]]);
});

test("a category whose entries sum to zero is still entry-driven", () => {
  const refunded = [{ id: "r", date: "2026-06-01", categoryId: "c2", amount: 0 }];
  const totals = dailyMonthTotals(refunded, "2026-06");
  assert.equal(totals.byCategory.c2, 0);
  assert.equal(totals.counts.get("c2"), 1, "a zero total and no entries must stay distinguishable");
});

/* ---------- the merge ---------- */

const typed = {
  "2026-06": { byCategory: { c1: 1500, c2: 999 }, other: 300 },
  "2026-04": { byCategory: { c1: 1400 }, other: 50 },
};

test("entries replace the typed figure for their own cell, and only that cell", () => {
  const merged = effectiveSpendLog(typed, daily);
  assert.deepEqual(merged["2026-06"], { byCategory: { c1: 1500, c2: 100 }, other: 25 });
  assert.equal(typed["2026-06"].byCategory.c2, 999, "the typed figure is left in storage");
});

test("a month with no entries is passed through untouched", () => {
  assert.deepEqual(effectiveSpendLog(typed, daily)["2026-04"], typed["2026-04"]);
});

test("entries alone make a month logged, with no typed figures at all", () => {
  const merged = effectiveSpendLog({}, daily);
  assert.deepEqual(Object.keys(merged).sort(), ["2026-06", "2026-07"]);
  assert.deepEqual(merged["2026-07"], { byCategory: { c1: 900 } });
  assert.equal(monthTotal(merged["2026-06"]), 125);
});

test("entries are never added to the typed figure — that would double-count", () => {
  const merged = effectiveSpendLog(
    { "2026-06": { byCategory: { c2: 999 } } },
    [{ id: "x", date: "2026-06-02", categoryId: "c2", amount: 10 }],
  );
  assert.equal(merged["2026-06"].byCategory.c2, 10);
});

test("entries summing to zero still take the cell over", () => {
  const merged = effectiveSpendLog(
    { "2026-06": { byCategory: { c2: 999 } } },
    [{ id: "x", date: "2026-06-02", categoryId: "c2", amount: 0 }],
  );
  assert.equal(merged["2026-06"].byCategory.c2, 0);
});

test("uncategorised entries take over Other, and leave it alone otherwise", () => {
  const withOther = effectiveSpendLog({ "2026-06": { other: 300 } },
    [{ id: "x", date: "2026-06-02", categoryId: null, amount: 12 }]);
  assert.equal(withOther["2026-06"].other, 12);

  const untouched = effectiveSpendLog({ "2026-06": { other: 300 } },
    [{ id: "x", date: "2026-06-02", categoryId: "c1", amount: 12 }]);
  assert.equal(untouched["2026-06"].other, 300);
});

test("the merged log is what the variance and the forecast should read", () => {
  const merged = effectiveSpendLog(typed, daily);
  const { rows, total } = monthVariance(merged, "2026-06", cats, 2600);
  assert.equal(rows.find((r) => r.id === "c2").actual, 100, "not the typed 999");
  assert.equal(total.actual, 1625);

  const { monthly, basis, monthsUsed } = effectiveExpenses({
    spendLog: merged, monthlyExpenses: 3000, useActuals: true, endMonth: "2026-07",
  });
  assert.equal(basis, "actuals");
  assert.equal(monthsUsed, 3, "the daily-only month counts as logged");
  assert.equal(monthly, (1450 + 1625 + 900) / 3);
});

test("effectiveSpendLog survives junk on either side", () => {
  assert.deepEqual(effectiveSpendLog(null, null), {});
  assert.deepEqual(effectiveSpendLog({ "not-a-month": { other: 5 } }, "nope"), {});
  assert.deepEqual(effectiveSpendLog({}, [null, { date: "2026-02-31", amount: 5 }, { amount: 5 }]), {});
});
