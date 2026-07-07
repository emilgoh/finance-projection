import test from "node:test";
import assert from "node:assert/strict";
import { project } from "../js/projection.js";

const base = {
  currentAge: 30,
  retirementAge: 65,
  endAge: 90,
  startNetWorth: 40000,
  annualIncome: 60000,
  annualExpenses: 42000,
  annualRetirementSpend: 42000,
  returnRate: 6,
  inflationRate: 2.5,
  incomeGrowthRate: 3,
  startYear: 2026,
};

test("row bookkeeping: one row per year, ages and years line up", () => {
  const { rows } = project(base);
  assert.equal(rows.length, 61);
  assert.equal(rows[0].age, 30);
  assert.equal(rows[0].year, 2026);
  assert.equal(rows.at(-1).age, 90);
  assert.equal(rows.at(-1).year, 2086);
});

test("first working year: growth on start balance plus savings", () => {
  const { rows } = project(base);
  assert.equal(rows[0].nominal, 40000);
  // 40000 * 1.06 + (60000 - 42000)
  assert.ok(Math.abs(rows[1].nominal - 60400) < 1e-6);
});

test("zero return, zero inflation, zero growth: pure arithmetic", () => {
  const { rows } = project({
    ...base,
    returnRate: 0,
    inflationRate: 0,
    incomeGrowthRate: 0,
  });
  const retirement = rows.find((r) => r.age === 65);
  // 40000 + 35 years * 18000 saved
  assert.equal(retirement.nominal, 40000 + 35 * 18000);
  // then draws down 42000/yr; real === nominal with zero inflation
  const at80 = rows.find((r) => r.age === 80);
  assert.equal(at80.nominal, retirement.nominal - 15 * 42000);
  assert.equal(at80.real, at80.nominal);
});

test("real value deflates nominal by inflation", () => {
  const { rows } = project({ ...base, inflationRate: 2.5 });
  const r10 = rows[10];
  assert.ok(Math.abs(r10.real - r10.nominal / 1.025 ** 10) < 1e-6);
});

test("depletion is detected and balance floors at zero", () => {
  const result = project({
    ...base,
    startNetWorth: 0,
    annualIncome: 42000, // saves nothing
    returnRate: 0,
  });
  assert.notEqual(result.depletedAge, null);
  assert.ok(result.depletedAge > base.retirementAge);
  const after = result.rows.filter((r) => r.age >= result.depletedAge);
  for (const row of after) assert.equal(row.nominal, 0);
});

test("FI age: reached when net worth covers 25x inflated retirement spend", () => {
  const rich = project({ ...base, startNetWorth: 25 * 42000 });
  assert.equal(rich.fiAge, 30);
  const normal = project(base);
  if (normal.fiAge !== null) {
    const fiRow = normal.rows.find((r) => r.age === normal.fiAge);
    assert.ok(fiRow.nominal >= 25 * 42000 * 1.025 ** fiRow.t);
  }
});

test("retirement at current age: no contributions, immediate drawdown", () => {
  const { rows } = project({
    ...base,
    retirementAge: 30,
    startNetWorth: 500000,
    returnRate: 0,
    inflationRate: 0,
  });
  assert.equal(rows[1].nominal, 500000 - 42000);
});

test("string and missing inputs fall back safely", () => {
  const { rows } = project({ currentAge: "40", retirementAge: "65" });
  assert.equal(rows[0].age, 40);
  assert.equal(rows.at(-1).age, 90);
});
