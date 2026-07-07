/**
 * Pure wealth-projection engine. Annual steps, no DOM — usable in tests.
 *
 * Model: the full net worth compounds at `returnRate`; while working, yearly
 * savings (income − expenses) are added after growth; in retirement, that
 * year's inflation-adjusted spending is withdrawn instead. Once retirement
 * funds hit zero they stay at zero (no borrowing in retirement).
 */
export function project(p) {
  const currentAge = num(p.currentAge, 30);
  const retirementAge = Math.max(currentAge, num(p.retirementAge, 65));
  const endAge = Math.max(retirementAge, num(p.endAge, 90));
  const r = num(p.returnRate, 6) / 100;
  const infl = num(p.inflationRate, 2.5) / 100;
  const g = num(p.incomeGrowthRate, 3) / 100;
  const startYear = num(p.startYear, new Date().getFullYear());

  let netWorth = num(p.startNetWorth, 0);
  let income = num(p.annualIncome, 0);
  let expenses = num(p.annualExpenses, 0);
  const retirementSpendToday = num(p.annualRetirementSpend, expenses);

  const rows = [];
  let fiAge = null;
  let depletedAge = null;
  let totalSaved = 0;
  let totalGrowth = 0;

  const years = endAge - currentAge;
  for (let t = 0; t <= years; t++) {
    const age = currentAge + t;
    const deflator = Math.pow(1 + infl, t);
    const retired = age > retirementAge;

    let growth = 0;
    let cashFlow = 0;
    if (t > 0) {
      // Growth only compounds a positive balance; a working-years deficit is
      // carried as plain negative cash, not compounding debt.
      growth = Math.max(netWorth, 0) * r;
      if (retired) {
        cashFlow = -(retirementSpendToday * deflator);
      } else {
        cashFlow = income - expenses;
        income *= 1 + g;
        expenses *= 1 + infl;
      }
      netWorth += growth + cashFlow;
      if (retired && netWorth <= 0) {
        netWorth = 0;
        if (depletedAge === null) depletedAge = age;
        growth = 0;
        cashFlow = 0;
      }
      totalGrowth += growth;
      if (cashFlow > 0) totalSaved += cashFlow;
    }

    // Financially independent when net worth covers 25× that year's
    // (inflation-adjusted) retirement spending — the 4% rule.
    if (fiAge === null && retirementSpendToday > 0 &&
        netWorth >= 25 * retirementSpendToday * deflator) {
      fiAge = age;
    }

    rows.push({
      t,
      age,
      year: startYear + t,
      nominal: netWorth,
      real: netWorth / deflator,
      growth,
      cashFlow,
      retired,
    });
  }

  const retirementRow = rows[Math.min(retirementAge - currentAge, rows.length - 1)];
  let peak = rows[0];
  for (const row of rows) if (row.nominal > peak.nominal) peak = row;

  return { rows, fiAge, depletedAge, retirementRow, peak, totalSaved, totalGrowth };
}

function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
