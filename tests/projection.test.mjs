import test from "node:test";
import assert from "node:assert/strict";
import { project, CPF } from "../js/projection.js";

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
  assert.equal(rows.at(-1).age, 95);
});

/* ---------- CPF (Singapore) ---------- */

const cpfBase = {
  ...base,
  cpf: { enabled: true, grossMonthlySalary: 5000, oa: 30000, sa: 12000, ma: 18000 },
};

test("CPF: first-year contributions and interest on each account", () => {
  const { rows } = project(cpfBase);
  // salary 60,000 < ceiling; total contribution 37%, split 23/6/8
  const oa = 30000 * 1.025 + 60000 * 0.23;
  const sa = 12000 * 1.04 + 60000 * 0.06;
  const ma = 18000 * 1.04 + 60000 * 0.08;
  assert.ok(Math.abs(rows[1].cpfTotal - (oa + sa + ma)) < 1e-6);
  // liquid net worth unchanged by CPF: same as the no-CPF projection
  const plain = project(base);
  assert.ok(Math.abs(rows[1].liquid - plain.rows[1].nominal) < 1e-6);
});

test("CPF: contributions are capped at the Ordinary Wage ceiling", () => {
  const low = project({ ...cpfBase, cpf: { ...cpfBase.cpf, grossMonthlySalary: 8000 } });
  const high = project({ ...cpfBase, cpf: { ...cpfBase.cpf, grossMonthlySalary: 20000 } });
  assert.ok(Math.abs(low.rows[1].cpfTotal - high.rows[1].cpfTotal) < 1e-6);
});

test("CPF: net worth today includes CPF balances", () => {
  const { rows } = project(cpfBase);
  assert.equal(rows[0].nominal, 40000 + 30000 + 12000 + 18000);
});

test("CPF LIFE: OA+SA annuitized at 65, payout offsets retirement spending", () => {
  const result = project(cpfBase);
  const at65 = result.rows.find((r) => r.age === 65);
  const at66 = result.rows.find((r) => r.age === 66);
  // after annuitization CPF holds only MediSave + the annuity pool
  assert.ok(result.cpfLifePayoutAnnual > 0);
  assert.ok(at65.cpfTotal > 0);
  // the pool amortizes: one payout out (9.7% of pool) far exceeds MA interest
  assert.ok(at66.cpfTotal < at65.cpfTotal);
  // retirement cash flow = payout − spending (partially offset)
  const spend66 = 42000 * 1.025 ** at66.t;
  assert.ok(Math.abs(at66.cashFlow - (result.cpfLifePayoutAnnual - spend66)) < 1e-6);
});

test("CPF LIFE: excess above the ERS becomes liquid at 65", () => {
  const result = project({
    ...cpfBase,
    cpf: { ...cpfBase.cpf, oa: 600000, sa: 100000 },
  });
  assert.ok(Math.abs(result.cpfLifePayoutAnnual - CPF.ERS * CPF.LIFE_PAYOUT_RATE) < 1e-6);
  // the amount above the ERS moved out of CPF into liquid savings
  const at64 = result.rows.find((r) => r.age === 64);
  const at65 = result.rows.find((r) => r.age === 65);
  assert.ok(at65.liquid > at64.liquid + 100000);
});

test("CPF: FI age uses liquid assets only (CPF is locked)", () => {
  // huge CPF, no liquid: not FI at the start
  const result = project({
    ...cpfBase,
    startNetWorth: 0,
    cpf: { ...cpfBase.cpf, oa: 2000000 },
  });
  assert.notEqual(result.fiAge, 30);
});

test("CPF: senior contribution rates step down with age", () => {
  assert.equal(CPF.rateForAge(50), 0.37);
  assert.equal(CPF.rateForAge(57), 0.34);
  assert.equal(CPF.rateForAge(62), 0.25);
  assert.equal(CPF.rateForAge(67), 0.165);
  assert.equal(CPF.rateForAge(75), 0.125);
});

test("CPF disabled: identical to the plain projection", () => {
  const off = project({ ...base, cpf: { enabled: false, oa: 999999 } });
  const plain = project(base);
  assert.deepEqual(
    off.rows.map((r) => r.nominal),
    plain.rows.map((r) => r.nominal),
  );
});
