import test from "node:test";
import assert from "node:assert/strict";
import { project, CPF, TAX } from "../js/projection.js";

const base = {
  currentAge: 30,
  retirementAge: 65,
  endAge: 90,
  startNetWorth: 40000,
  annualGrossIncome: 60000,
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
    annualGrossIncome: 42000, // saves nothing
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
  cpf: { enabled: true, oa: 30000, sa: 12000, ma: 18000 },
};

test("CPF: first-year contributions and interest on each account", () => {
  const { rows } = project(cpfBase);
  // gross 60,000 < ceiling; total contribution 37%, split 23/6/8
  const oa = 30000 * 1.025 + 60000 * 0.23;
  const sa = 12000 * 1.04 + 60000 * 0.06;
  const ma = 18000 * 1.04 + 60000 * 0.08;
  assert.ok(Math.abs(rows[1].cpfTotal - (oa + sa + ma)) < 1e-6);
});

test("CPF: employee share is deducted from gross to get take-home", () => {
  const { rows } = project(cpfBase);
  // take-home = 60,000 − 20% employee share; savings = take-home − expenses
  const takeHome = 60000 * (1 - 0.2);
  assert.ok(Math.abs(rows[1].liquid - (40000 * 1.06 + takeHome - 42000)) < 1e-6);
});

test("CPF: contributions and deduction are capped at the Ordinary Wage ceiling", () => {
  const low = project({ ...cpfBase, annualGrossIncome: 96000 });
  const high = project({ ...cpfBase, annualGrossIncome: 240000 });
  assert.ok(Math.abs(low.rows[1].cpfTotal - high.rows[1].cpfTotal) < 1e-6);
  // above the ceiling every extra dollar is take-home, none goes to CPF
  assert.ok(Math.abs((high.rows[1].liquid - low.rows[1].liquid) - (240000 - 96000)) < 1e-6);
});

test("CPF: employee contribution rates step down with age", () => {
  assert.equal(CPF.employeeRateForAge(50), 0.2);
  assert.equal(CPF.employeeRateForAge(57), 0.18);
  assert.equal(CPF.employeeRateForAge(62), 0.125);
  assert.equal(CPF.employeeRateForAge(67), 0.075);
  assert.equal(CPF.employeeRateForAge(75), 0.05);
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

/* ---------- life events ---------- */

test("events: spent in the right year, inflated from today's money", () => {
  const plain = project(base);
  const withEvent = project({
    ...base,
    events: [{ name: "wedding", age: 35, amount: 50000 }],
  });
  const t = 5; // age 35
  const cost = 50000 * 1.025 ** t;
  // the two projections only diverge from the event year onward
  assert.equal(withEvent.rows[t - 1].nominal, plain.rows[t - 1].nominal);
  assert.ok(Math.abs((plain.rows[t].nominal - withEvent.rows[t].nominal) - cost) < 1e-6);
});

test("events: several in one year add up; out-of-range ages are ignored", () => {
  const doubled = project({
    ...base,
    events: [
      { name: "a", age: 35, amount: 20000 },
      { name: "b", age: 35, amount: 30000 },
      { name: "too early", age: 30, amount: 99999 }, // current age: no year to land in
      { name: "too late", age: 200, amount: 99999 },
    ],
  });
  const single = project({
    ...base,
    events: [{ name: "wedding", age: 35, amount: 50000 }],
  });
  assert.deepEqual(
    doubled.rows.map((r) => r.nominal),
    single.rows.map((r) => r.nominal),
  );
});

test("events: a big retirement expense can deplete savings", () => {
  const calm = project(cpfBase);
  const hit = project({
    ...cpfBase,
    events: [{ name: "medical", age: 80, amount: 5000000 }],
  });
  assert.equal(calm.depletedAge, null);
  assert.equal(hit.depletedAge, 80);
});

/* ---------- Singapore income tax ---------- */

test("tax brackets match IRAS cumulative figures", () => {
  // published "gross tax payable" checkpoints for the resident schedule
  const expected = [
    [20000, 0], [30000, 200], [40000, 550], [80000, 3350],
    [120000, 7950], [160000, 13950], [200000, 21150], [320000, 44550],
    [500000, 84150], [1000000, 199150], [1100000, 223150],
  ];
  for (const [chargeable, tax] of expected) {
    assert.ok(Math.abs(TAX.of(chargeable) - tax) < 1e-6, `at ${chargeable}`);
  }
  assert.equal(TAX.of(0), 0);
});

test("tax: deducted from working-year savings, after CPF relief", () => {
  const { rows } = project({ ...cpfBase, includeTax: true });
  // chargeable = 60,000 − 12,000 employee CPF − 1,000 relief = 47,000
  const tax = TAX.of(47000);
  assert.ok(Math.abs(tax - 1040) < 1e-6);
  const takeHome = 60000 - 12000 - tax;
  assert.ok(Math.abs(rows[1].liquid - (40000 * 1.06 + takeHome - 42000)) < 1e-6);
});

test("tax: retirement withdrawals and CPF LIFE payouts are untaxed", () => {
  const taxed = project({ ...cpfBase, includeTax: true });
  const untaxed = project(cpfBase);
  const iRetire = taxed.rows.findIndex((r) => r.age === 66);
  // same retirement-year cash flow whether or not tax is enabled
  assert.ok(
    Math.abs(taxed.rows[iRetire].cashFlow - untaxed.rows[iRetire].cashFlow) < 1e-6,
  );
});

test("tax off by default: engine unchanged without includeTax", () => {
  const a = project(base);
  const b = project({ ...base, includeTax: false });
  assert.deepEqual(a.rows.map((r) => r.nominal), b.rows.map((r) => r.nominal));
});

test("CPF disabled: identical to the plain projection", () => {
  const off = project({ ...base, cpf: { enabled: false, oa: 999999 } });
  const plain = project(base);
  assert.deepEqual(
    off.rows.map((r) => r.nominal),
    plain.rows.map((r) => r.nominal),
  );
});
