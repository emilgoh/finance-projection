/**
 * Pure wealth-projection engine. Annual steps, no DOM — usable in tests.
 *
 * Model: liquid net worth (everything outside CPF) compounds at `returnRate`;
 * while working, yearly savings (income − expenses) are added; in retirement,
 * that year's inflation-adjusted spending is withdrawn instead. Once liquid
 * savings hit zero they stay at zero (no borrowing in retirement).
 *
 * Income is GROSS (before CPF). With CPF enabled, the employee's age-banded
 * share is deducted automatically to get take-home pay; with CPF disabled,
 * gross is treated as take-home.
 *
 * Optional CPF module (Singapore): OA/SA/MediSave balances earn CPF interest
 * and receive age-banded total (employer + employee) contributions on the
 * capped gross income while working. At 65, OA+SA (up to the Enhanced
 * Retirement Sum) is annuitized
 * into CPF LIFE: a fixed lifelong payout that offsets retirement spending.
 * The unused premium (premium − payouts made, floored at 0) stays in net
 * worth as the bequest value, mirroring the Standard plan's refund.
 */

// 2026 CPF parameters, held constant in nominal terms — a simplification:
// ceilings and retirement sums are adjusted upward over time in reality.
export const CPF = {
  OW_CEILING_ANNUAL: 8000 * 12, // contributions only on salary up to S$8,000/mo
  OA_INTEREST: 0.025,
  SMRA_INTEREST: 0.04, // SA / MediSave / RA floor rate (extra 1% on first S$60k ignored)
  // Allocation uses the under-35 split (OA 23 / SA 6 / MA 8 of a 37% total)
  // at every age — real allocation shifts toward MediSave/RA with age.
  ALLOC: { oa: 23 / 37, sa: 6 / 37, ma: 8 / 37 },
  ERS: 440800, // Enhanced Retirement Sum: max that can go into CPF LIFE
  PAYOUT_AGE: 65,
  // CPF LIFE Standard plan estimate: FRS S$220,400 → ~S$1,780/mo at 65,
  // i.e. yearly payout ≈ 9.7% of the annuitized sum, fixed for life.
  LIFE_PAYOUT_RATE: 0.097,
  // Total (employer + employee) contribution rate by age, from 1 Jan 2026.
  rateForAge(age) {
    if (age <= 55) return 0.37;
    if (age <= 60) return 0.34;
    if (age <= 65) return 0.25;
    if (age <= 70) return 0.165;
    return 0.125;
  },
  // The employee's share of the above (deducted from gross pay), 1 Jan 2026.
  employeeRateForAge(age) {
    if (age <= 55) return 0.2;
    if (age <= 60) return 0.18;
    if (age <= 65) return 0.125;
    if (age <= 70) return 0.075;
    return 0.05;
  },
};

// Singapore resident income tax (YA 2026 schedule), applied to employment
// income while working. Chargeable income = gross − employee CPF share −
// earned income relief; other reliefs are ignored. CPF LIFE payouts and
// investment gains are untaxed (as in Singapore). Brackets are held constant
// in nominal terms — another simplification.
export const TAX = {
  EARNED_INCOME_RELIEF: 1000,
  BRACKETS: [
    // [upper bound of bracket, marginal rate]
    [20000, 0], [30000, 0.02], [40000, 0.035], [80000, 0.07],
    [120000, 0.115], [160000, 0.15], [200000, 0.18], [240000, 0.19],
    [280000, 0.195], [320000, 0.20], [500000, 0.22], [1000000, 0.23],
    [Infinity, 0.24],
  ],
  of(chargeable) {
    let tax = 0;
    let prev = 0;
    for (const [cap, rate] of TAX.BRACKETS) {
      if (chargeable <= prev) break;
      tax += (Math.min(chargeable, cap) - prev) * rate;
      prev = cap;
    }
    return tax;
  },
};

export function project(p) {
  const currentAge = num(p.currentAge, 30);
  const retirementAge = Math.max(currentAge, num(p.retirementAge, 65));
  const endAge = Math.max(retirementAge, num(p.endAge, 95));
  const r = num(p.returnRate, 6) / 100;
  const infl = num(p.inflationRate, 2) / 100;
  const g = num(p.incomeGrowthRate, 3) / 100;
  const startYear = num(p.startYear, new Date().getFullYear());

  let liquid = num(p.startNetWorth, 0);
  let gross = num(p.annualGrossIncome, 0);
  let expenses = num(p.annualExpenses, 0);
  const retirementSpendToday = num(p.annualRetirementSpend, expenses);

  // One-off life events (wedding, home down payment…): amounts in today's
  // money, spent from liquid savings in the year the given age is reached.
  const eventsByAge = new Map();
  if (Array.isArray(p.events)) {
    for (const e of p.events) {
      const eventAge = num(e.age, NaN);
      const amount = num(e.amount, 0);
      if (Number.isFinite(eventAge) && amount) {
        eventsByAge.set(eventAge, (eventsByAge.get(eventAge) || 0) + amount);
      }
    }
  }

  const taxOn = !!p.includeTax;
  const cpfOn = !!(p.cpf && p.cpf.enabled);
  let oa = cpfOn ? num(p.cpf.oa, 0) : 0;
  let sa = cpfOn ? num(p.cpf.sa, 0) : 0;
  let ma = cpfOn ? num(p.cpf.ma, 0) : 0;
  let annuityPool = 0;
  let annualPayout = 0;
  let annuitized = false;

  const rows = [];
  let fiAge = null;
  let depletedAge = null;
  let totalSaved = 0;
  let totalGrowth = 0;

  const years = endAge - currentAge;
  for (let t = 0; t <= years; t++) {
    const age = currentAge + t;
    const deflator = Math.pow(1 + infl, t);
    const working = age - 1 < retirementAge; // year t spans age-1 → age
    const retiredYear = t > 0 && !working;

    let growth = 0;
    let cashFlow = 0;
    if (t > 0) {
      // Growth only compounds a positive balance; a working-years deficit is
      // carried as plain negative cash, not compounding debt.
      growth = Math.max(liquid, 0) * r;

      if (cpfOn) {
        const cpfInterest =
          oa * CPF.OA_INTEREST + (sa + ma) * CPF.SMRA_INTEREST;
        oa *= 1 + CPF.OA_INTEREST;
        sa *= 1 + CPF.SMRA_INTEREST;
        ma *= 1 + CPF.SMRA_INTEREST;
        totalGrowth += cpfInterest;
        if (working && gross > 0) {
          const cappedWage = Math.min(gross, CPF.OW_CEILING_ANNUAL);
          const contrib = cappedWage * CPF.rateForAge(age - 1);
          oa += contrib * CPF.ALLOC.oa;
          sa += contrib * CPF.ALLOC.sa;
          ma += contrib * CPF.ALLOC.ma;
          totalSaved += contrib;
        }
        // CPF LIFE bequest value amortizes as payouts are made; the payout
        // itself continues for life regardless (it's an annuity).
        annuityPool = Math.max(0, annuityPool - annualPayout);
      }

      if (working) {
        // take-home = gross − the employee's CPF share on the capped wage
        // − income tax on what remains chargeable
        const employeeShare = cpfOn
          ? Math.min(gross, CPF.OW_CEILING_ANNUAL) * CPF.employeeRateForAge(age - 1)
          : 0;
        const tax = taxOn
          ? TAX.of(Math.max(0, gross - employeeShare - TAX.EARNED_INCOME_RELIEF))
          : 0;
        cashFlow = gross - employeeShare - tax - expenses + annualPayout;
        gross *= 1 + g;
        expenses *= 1 + infl;
      } else {
        // CPF LIFE payouts are tax-exempt; withdrawals aren't income
        cashFlow = annualPayout - retirementSpendToday * deflator;
      }
      cashFlow -= (eventsByAge.get(age) || 0) * deflator;

      const liquidBefore = liquid;
      liquid += growth + cashFlow;
      if (retiredYear && liquid < 0) {
        // Could only withdraw what was there.
        cashFlow = -(liquidBefore + growth);
        liquid = 0;
        if (depletedAge === null) depletedAge = age;
      }
      totalGrowth += growth;
      if (cashFlow > 0) totalSaved += cashFlow;
    }

    const cpfTotal = oa + sa + ma + annuityPool;
    const nominal = liquid + cpfTotal;

    // Financially independent when investable (non-CPF) assets cover 25× that
    // year's inflation-adjusted retirement spending — the 4% rule. CPF is
    // excluded because it is locked until the payout age.
    if (fiAge === null && retirementSpendToday > 0 &&
        liquid >= 25 * retirementSpendToday * deflator) {
      fiAge = age;
    }

    rows.push({
      t,
      age,
      year: startYear + t,
      nominal,
      real: nominal / deflator,
      liquid,
      cpfTotal,
      growth,
      cashFlow,
      retired: !working,
    });

    // Reaching the payout age converts OA+SA (up to the ERS) into CPF LIFE;
    // any excess above the ERS becomes withdrawable, i.e. liquid.
    if (cpfOn && !annuitized && age >= CPF.PAYOUT_AGE) {
      annuityPool = Math.min(oa + sa, CPF.ERS);
      liquid += oa + sa - annuityPool;
      annualPayout = annuityPool * CPF.LIFE_PAYOUT_RATE;
      oa = 0;
      sa = 0;
      annuitized = true;
      // keep the just-pushed row's totals consistent (sum is unchanged)
      rows[rows.length - 1].liquid = liquid;
      rows[rows.length - 1].cpfTotal = ma + annuityPool;
    }
  }

  const retirementRow = rows[Math.min(retirementAge - currentAge, rows.length - 1)];
  let peak = rows[0];
  for (const row of rows) if (row.nominal > peak.nominal) peak = row;

  return {
    rows, fiAge, depletedAge, retirementRow, peak, totalSaved, totalGrowth,
    cpfEnabled: cpfOn,
    cpfLifePayoutAnnual: annualPayout,
  };
}

function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
