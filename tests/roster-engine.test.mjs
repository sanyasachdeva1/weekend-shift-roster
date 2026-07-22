import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ console });
vm.runInContext(await readFile("roster-engine.js", "utf8"), context);
const generate = context.RosterEngine.generate;
const hasScheduleConflict = context.RosterEngine.hasScheduleConflict;
const people = Array.from({ length: 7 }, (_, index) => `EMP${String(index + 1).padStart(3, "0")}`);

const previous = { assignments: [
  { assigned: ["EMP001", "EMP002"] },
  { assigned: ["EMP001", "EMP003"] },
] };
const alternating = generate({ people, monthDate: new Date(2026, 7, 1), availability: {}, submissions: {}, rosters: { "2026-07": previous } });
assert.equal(alternating.targetLoad.EMP001, 1);
assert.equal(alternating.targetLoad.EMP002, 2);
assert.equal(alternating.targetLoad.EMP007, 2);

for (const row of alternating.assignments) assert.equal(new Set(row.assigned).size, row.assigned.length);
for (const code of people) assert.ok(alternating.monthlyLoad[code] >= 1, `${code} must receive monthly coverage`);
for (const row of alternating.assignments) for (const code of row.assigned) assert.equal(hasScheduleConflict(alternating.assignments, code, row.date, row.date), false);

const fullTeam = Array.from({ length: 22 }, (_, index) => `EMP${String(index + 1).padStart(3, "0")}`);
const date = "2026-08-01", availability = {}, submissions = {};
for (const [index, code] of fullTeam.entries()) {
  availability[code] = { "2026-08": { [date]: true } };
  submissions[code] = { "2026-08": { savedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString() } };
}
const overridden = generate({ people: fullTeam, monthDate: new Date(2026, 7, 1), availability, submissions, rosters: {} });
assert.equal(overridden.assignments[0].overrides.length, 4);
const overrideTimes = overridden.assignments[0].overrides.map((item) => new Date(item.submittedAt).getTime());
assert.deepEqual(overrideTimes, overrideTimes.slice().sort((a, b) => b - a));
for (const row of overridden.assignments) assert.equal(new Set(row.assigned).size, row.assigned.length);
for (const code of fullTeam) assert.ok(overridden.monthlyLoad[code] >= 1, `${code} must receive monthly coverage`);
for (const row of overridden.assignments) for (const code of row.assigned) assert.equal(hasScheduleConflict(overridden.assignments, code, row.date, row.date), false);

const basicPeople = Array.from({ length: 20 }, (_, index) => `EMP${String(index + 1).padStart(3, "0")}`);
const signaturePeople = ["SIG001", "SIG002", "SIG003", "SIG004"];
const splitRoster = generate({ people: [...basicPeople, ...signaturePeople], signaturePeople, monthDate: new Date(2026, 7, 1), availability: {}, submissions: {}, rosters: {} });
for (const row of splitRoster.assignments) {
  const date = new Date(`${row.date}T12:00:00`);
  const basicAssigned = row.assigned.filter((code) => code.startsWith("EMP"));
  const signatureAssigned = row.assigned.filter((code) => code.startsWith("SIG"));
  assert.equal(signatureAssigned.length, 1, `${row.date} must have exactly one signature engineer`);
  assert.equal(basicAssigned.length, date.getDay() === 6 ? 4 : 3, `${row.date} must have the expected basic engineer count`);
  assert.equal(row.assigned.length, date.getDay() === 6 ? 5 : 4);
}
for (const code of signaturePeople) assert.ok(splitRoster.monthlyLoad[code] >= 1, `${code} must receive signature coverage`);
for (const row of splitRoster.assignments) for (const code of row.assigned) assert.equal(hasScheduleConflict(splitRoster.assignments, code, row.date, row.date), false);

console.log("Roster engine tests passed");
