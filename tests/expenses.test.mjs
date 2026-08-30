import test from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_ID, monthKey, parseMonth, addMonths, formatMonth,
  activeCategories, categoryBudgetTotal,
  monthTotal, isLogged, loggedMonths, monthVariance,
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
