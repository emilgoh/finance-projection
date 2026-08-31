import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY, LEGACY_STORAGE_KEY, DEFAULT_STATE, ACCOUNT_TYPES,
  loadState, writeState, clearState, mergeSaved,
  sanitiseAccounts, sanitiseCategories, sanitiseLog, newId,
  sanitiseTimestamp, backupHint, BACKUP_STALE_DAYS, sanitiseOneOffs,
} from "../js/state.js";

/** Minimal stand-in for localStorage: same three methods, plain object inside. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

/* ---------- loadState ---------- */

test("loadState: empty storage yields the defaults, not a shared reference", () => {
  const state = loadState(fakeStorage());
  assert.deepEqual(state, DEFAULT_STATE);
  state.accounts[0].value = 999999;
  assert.equal(DEFAULT_STATE.accounts[0].value, 5000);
});

test("loadState: corrupt JSON falls back to the defaults instead of throwing", () => {
  const state = loadState(fakeStorage({ [STORAGE_KEY]: "{not json" }));
  assert.deepEqual(state, DEFAULT_STATE);
});

test("loadState: a saved blob merges over the defaults for missing keys", () => {
  const state = loadState(fakeStorage({
    [STORAGE_KEY]: JSON.stringify({ currentAge: 41, returnRate: 4.5 }),
  }));
  assert.equal(state.currentAge, 41);
  assert.equal(state.returnRate, 4.5);
  assert.equal(state.endAge, DEFAULT_STATE.endAge); // absent key keeps its default
});

test("loadState: v2 legacy blob prefers the old gross salary over take-home", () => {
  const state = loadState(fakeStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      monthlyIncome: 4200,
      cpf: { enabled: true, grossMonthlySalary: 5500, oa: 1000 },
    }),
  }));
  assert.equal(state.monthlyGrossIncome, 5500);
  assert.equal(state.cpf.oa, 1000);
  assert.ok(!("monthlyIncome" in state));
  assert.ok(!("grossMonthlySalary" in state.cpf), "the v2-only CPF key is dropped");
});

test("loadState: v2 falls back to take-home when no gross salary was stored", () => {
  const state = loadState(fakeStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({ monthlyIncome: 4200 }),
  }));
  assert.equal(state.monthlyGrossIncome, 4200);
});

test("loadState: v3 wins over a v2 blob when both are present", () => {
  const state = loadState(fakeStorage({
    [STORAGE_KEY]: JSON.stringify({ monthlyGrossIncome: 9000 }),
    [LEGACY_STORAGE_KEY]: JSON.stringify({ monthlyIncome: 4200 }),
  }));
  assert.equal(state.monthlyGrossIncome, 9000);
});

/* ---------- the round trip ---------- */

test("a saved state reloads unchanged — no value is lost or re-sanitised away", () => {
  const storage = fakeStorage();
  const original = loadState(storage);
  original.currentAge = 44;
  original.spendCategories = [{ id: "c1", name: "Food", budget: 800 }];
  original.spendLog = { "2026-06": { byCategory: { c1: 750 }, other: 20 } };
  original.useActualsForForecast = true;
  writeState(storage, original);
  assert.deepEqual(loadState(storage), original);
});

test("writeState survives a storage that throws (quota exceeded, private mode)", () => {
  const storage = { setItem() { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => writeState(storage, DEFAULT_STATE));
});

test("clearState removes the v2 key too, so old data can't reload", () => {
  const storage = fakeStorage({ [STORAGE_KEY]: "{}", [LEGACY_STORAGE_KEY]: "{}" });
  clearState(storage);
  assert.equal(storage.size, 0);
  assert.deepEqual(loadState(storage), DEFAULT_STATE);
});

/* ---------- mergeSaved: the import funnel ---------- */

test("mergeSaved: cpf is merged key-by-key, not replaced wholesale", () => {
  const merged = mergeSaved({ cpf: { oa: 50000 } });
  assert.equal(merged.cpf.oa, 50000);
  assert.equal(merged.cpf.sa, DEFAULT_STATE.cpf.sa);
  assert.equal(merged.cpf.enabled, DEFAULT_STATE.cpf.enabled);
});

test("mergeSaved: deleted categories stay deleted", () => {
  // Deep-merging would resurrect the defaults' entries; replacement must win.
  const merged = mergeSaved({ spendCategories: [] });
  assert.deepEqual(merged.spendCategories, []);
});

test("mergeSaved: absent accounts key keeps the defaults, explicit null does not", () => {
  assert.deepEqual(mergeSaved({}).accounts, DEFAULT_STATE.accounts);
  assert.deepEqual(mergeSaved({ accounts: null }).accounts, DEFAULT_STATE.accounts);
  assert.deepEqual(mergeSaved({ accounts: [] }).accounts, []);
});

test("mergeSaved: useActualsForForecast is coerced to a real boolean", () => {
  assert.equal(mergeSaved({ useActualsForForecast: "yes" }).useActualsForForecast, true);
  assert.equal(mergeSaved({ useActualsForForecast: undefined }).useActualsForForecast, false);
});

test("mergeSaved: a hostile blob still produces a loadable state", () => {
  // The regression that mattered: an imported file that persisted, then threw
  // on every subsequent load. Whatever comes in, the result must round-trip.
  const merged = mergeSaved({
    accounts: "not a list",
    spendCategories: { nope: true },
    spendLog: [1, 2, 3],
    cpf: null,
  });
  const storage = fakeStorage();
  writeState(storage, merged);
  assert.deepEqual(loadState(storage), merged);
  assert.deepEqual(merged.accounts, DEFAULT_STATE.accounts);
  assert.deepEqual(merged.spendCategories, []);
  assert.deepEqual(merged.spendLog, {});
  assert.deepEqual(merged.cpf, DEFAULT_STATE.cpf);
});

/* ---------- sanitiseAccounts ---------- */

test("sanitiseAccounts: a non-array becomes the default accounts", () => {
  for (const bad of [undefined, null, "x", 7, {}]) {
    assert.deepEqual(sanitiseAccounts(bad), DEFAULT_STATE.accounts);
  }
});

test("sanitiseAccounts: non-objects are dropped and fields are coerced", () => {
  const out = sanitiseAccounts([
    null,
    "ignored",
    { name: 42, type: "crypto", value: "1000" },
    { name: "Bank", type: "cash", value: 250.5 },
    {},
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { name: "42", type: "other", value: 0 });
  assert.deepEqual(out[1], { name: "Bank", type: "cash", value: 250.5 });
  assert.deepEqual(out[2], { name: "", type: "other", value: 0 });
});

test("sanitiseAccounts: every known type survives the round trip", () => {
  const out = sanitiseAccounts(ACCOUNT_TYPES.map((type) => ({ name: type, type, value: 1 })));
  assert.deepEqual(out.map((a) => a.type), ACCOUNT_TYPES);
});

test("sanitiseAccounts: NaN and Infinity become 0 rather than poisoning totals", () => {
  const out = sanitiseAccounts([{ value: NaN }, { value: Infinity }]);
  assert.deepEqual(out.map((a) => a.value), [0, 0]);
});

/* ---------- sanitiseCategories ---------- */

test("sanitiseCategories: a non-array becomes an empty list", () => {
  for (const bad of [undefined, null, "x", {}]) assert.deepEqual(sanitiseCategories(bad), []);
});

test("sanitiseCategories: duplicate ids are reassigned, never collapsed", () => {
  const out = sanitiseCategories([
    { id: "dup", name: "First" },
    { id: "dup", name: "Second" },
  ]);
  assert.equal(out.length, 2, "both categories survive");
  assert.equal(out[0].id, "dup", "the first keeps the id");
  assert.notEqual(out[1].id, "dup", "the second is given a fresh one");
  assert.deepEqual(out.map((c) => c.name), ["First", "Second"]);
});

test("sanitiseCategories: a missing or non-string id is replaced", () => {
  const out = sanitiseCategories([{ name: "A" }, { id: 5, name: "B" }, { id: "", name: "C" }]);
  assert.equal(new Set(out.map((c) => c.id)).size, 3);
  for (const c of out) assert.equal(typeof c.id, "string");
});

test("sanitiseCategories: budget is kept only when finite, archived only when set", () => {
  const out = sanitiseCategories([
    { id: "a", name: "A", budget: 0 },
    { id: "b", name: "B", budget: "800" },
    { id: "c", name: "C", budget: NaN, archived: true },
  ]);
  assert.equal(out[0].budget, 0, "a zero budget is a real budget");
  assert.ok(!("budget" in out[1]), "a string budget is dropped, not coerced");
  assert.ok(!("budget" in out[2]));
  assert.equal(out[2].archived, true);
  assert.ok(!("archived" in out[0]));
});

test("newId returns distinct strings", () => {
  const ids = new Set(Array.from({ length: 100 }, newId));
  assert.equal(ids.size, 100);
});

/* ---------- sanitiseLog ---------- */

test("sanitiseLog: a non-object becomes an empty log", () => {
  for (const bad of [undefined, null, "x", 5]) assert.deepEqual(sanitiseLog(bad), {});
});

test("sanitiseLog: keys that aren't YYYY-MM are dropped", () => {
  const out = sanitiseLog({
    "2026-06": { byCategory: { c1: 100 } },
    "2026-6": { byCategory: { c1: 100 } },
    "26-06": { byCategory: { c1: 100 } },
    "2026-13": { byCategory: { c1: 100 } },
    junk: { byCategory: { c1: 100 } },
  });
  assert.deepEqual(Object.keys(out), ["2026-06"]);
});

test("sanitiseLog: negative and non-finite amounts are dropped", () => {
  const out = sanitiseLog({
    "2026-06": { byCategory: { c1: -50, c2: 300, c3: NaN, c4: "200" }, other: -10 },
  });
  assert.deepEqual(out["2026-06"].byCategory, { c2: 300 });
  assert.ok(!("other" in out["2026-06"]), "a negative other is dropped, not clamped");
});

test("sanitiseLog: zero is a legitimate logged amount", () => {
  const out = sanitiseLog({ "2026-06": { byCategory: { c1: 0 } } });
  assert.deepEqual(out["2026-06"].byCategory, { c1: 0 });
});

test("sanitiseLog: months left with nothing logged are dropped entirely", () => {
  const out = sanitiseLog({
    "2026-06": { byCategory: { c1: -5 } },   // sole amount is invalid
    "2026-07": {},                            // no amounts at all
    "2026-08": { byCategory: "nope" },        // byCategory isn't an object
    "2026-09": null,
    "2026-10": { other: 40 },                 // other alone still counts as logged
  });
  assert.deepEqual(Object.keys(out), ["2026-10"]);
});

test("sanitiseLog: byCategory always exists on a surviving month", () => {
  // renderLog() reads entry.byCategory directly; a missing one would throw.
  const out = sanitiseLog({ "2026-10": { other: 40 } });
  assert.deepEqual(out["2026-10"], { byCategory: {}, other: 40 });
});

/* ---------- backup freshness ---------- */

const DAY = 86400000;
const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

test("backupHint: a fresh install is told, not warned", () => {
  assert.deepEqual(backupHint(null, { hasData: false, now: NOW }),
    { label: "No backup yet.", stale: false });
});

test("backupHint: never backing up is stale once there is data to lose", () => {
  const hint = backupHint(null, { hasData: true, now: NOW });
  assert.equal(hint.stale, true);
  assert.equal(hint.label, "Never backed up.");
});

test("backupHint: ages read in the largest useful unit", () => {
  const label = (n) => backupHint(daysAgo(n), { now: NOW }).label;
  assert.equal(label(0), "Last backup: today.");
  assert.equal(label(1), "Last backup: yesterday.");
  assert.equal(label(5), "Last backup: 5 days ago.");
  assert.equal(label(21), "Last backup: 3 weeks ago.");
  assert.equal(label(90), "Last backup: 3 months ago.");
  assert.equal(label(400), "Last backup: over a year ago.");
  assert.equal(label(900), "Last backup: over 2 years ago.");
});

test(`backupHint: stale at exactly ${BACKUP_STALE_DAYS} days, not before`, () => {
  assert.equal(backupHint(daysAgo(BACKUP_STALE_DAYS - 1), { now: NOW }).stale, false);
  assert.equal(backupHint(daysAgo(BACKUP_STALE_DAYS), { now: NOW }).stale, true);
});

test("backupHint: staleness does not depend on hasData once a backup exists", () => {
  for (const hasData of [true, false]) {
    assert.equal(backupHint(daysAgo(60), { hasData, now: NOW }).stale, true);
  }
});

test("backupHint: a future timestamp reads as today rather than a negative age", () => {
  // A timezone change or an imported file with a skewed clock.
  const hint = backupHint(new Date(NOW + 3 * DAY).toISOString(), { now: NOW });
  assert.deepEqual(hint, { label: "Last backup: today.", stale: false });
});

test("backupHint: an unparseable timestamp degrades to never, not Invalid Date", () => {
  for (const bad of ["not a date", "", 12345, {}, undefined]) {
    assert.equal(backupHint(bad, { hasData: true, now: NOW }).label, "Never backed up.");
  }
});

test("sanitiseTimestamp keeps valid ISO strings and drops everything else", () => {
  const iso = "2026-08-30T12:00:00.000Z";
  assert.equal(sanitiseTimestamp(iso), iso);
  for (const bad of [null, undefined, 0, Date.now(), "nope", new Date(), {}]) {
    assert.equal(sanitiseTimestamp(bad), null);
  }
});

test("mergeSaved: a garbage lastBackupAt cannot render as Invalid Date", () => {
  assert.equal(mergeSaved({ lastBackupAt: "nope" }).lastBackupAt, null);
  assert.equal(mergeSaved({ lastBackupAt: 1756555555555 }).lastBackupAt, null);
  const iso = "2026-01-02T03:04:05.000Z";
  assert.equal(mergeSaved({ lastBackupAt: iso }).lastBackupAt, iso);
});

/* ---------- sanitiseOneOffs ---------- */

test("sanitiseOneOffs: a non-array becomes an empty list", () => {
  for (const bad of [undefined, null, "x", 7, {}]) assert.deepEqual(sanitiseOneOffs(bad), []);
});

test("sanitiseOneOffs: non-objects are dropped and fields are coerced", () => {
  const out = sanitiseOneOffs([
    null,
    "ignored",
    { name: "Wedding", age: 35, amount: 50000 },
    { name: 42, age: "35", amount: "50000" },
    {},
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { name: "Wedding", age: 35, amount: 50000 });
  assert.deepEqual(out[1], { name: "42", age: null, amount: 0 },
    "string age and amount are dropped, not parsed");
  assert.deepEqual(out[2], { name: "", age: null, amount: 0 });
});

test("sanitiseOneOffs: an unusable age becomes null, never 0", () => {
  // 0 would claim to be a real age; null makes the engine skip the row.
  const out = sanitiseOneOffs([{ age: NaN }, { age: Infinity }, { age: undefined }]);
  for (const e of out) assert.equal(e.age, null);
});

test("sanitiseOneOffs: a negative amount becomes 0 rather than income", () => {
  const out = sanitiseOneOffs([{ name: "refund", age: 40, amount: -50000 }]);
  assert.equal(out[0].amount, 0);
});

test("sanitiseOneOffs: age 0 and amount 0 are preserved as given", () => {
  assert.deepEqual(sanitiseOneOffs([{ name: "x", age: 0, amount: 0 }]),
    [{ name: "x", age: 0, amount: 0 }]);
});

test("mergeSaved: events go through the same funnel as everything else", () => {
  assert.deepEqual(mergeSaved({}).events, []);
  assert.deepEqual(mergeSaved({ events: "nope" }).events, []);
  assert.deepEqual(mergeSaved({ events: [{ name: "Wedding", age: 35, amount: 50000 }] }).events,
    [{ name: "Wedding", age: 35, amount: 50000 }]);
});

test("mergeSaved: windfalls go through the same funnel as events", () => {
  assert.deepEqual(mergeSaved({}).windfalls, []);
  assert.deepEqual(mergeSaved({ windfalls: "nope" }).windfalls, []);
  assert.deepEqual(mergeSaved({ windfalls: [{ name: "Bonus", age: 35, amount: 20000 }] }).windfalls,
    [{ name: "Bonus", age: 35, amount: 20000 }]);
});

test("events survive the storage round trip", () => {
  const storage = fakeStorage();
  const state = loadState(storage);
  state.events = [{ name: "Down payment", age: 34, amount: 200000 }];
  writeState(storage, state);
  assert.deepEqual(loadState(storage), state);
});
