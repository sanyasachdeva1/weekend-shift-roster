import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ console });
vm.runInContext(await readFile("roster-engine.js", "utf8"), context);
const generate = context.RosterEngine.generate;
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

const fullTeam = Array.from({ length: 22 }, (_, index) => `EMP${String(index + 1).padStart(3, "0")}`);
const date = "2026-08-01", availability = {}, submissions = {};
for (const [index, code] of fullTeam.entries()) {
  availability[code] = { "2026-08": { [date]: true } };
  submissions[code] = { "2026-08": { savedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString() } };
}
const overridden = generate({ people: fullTeam, monthDate: new Date(2026, 7, 1), availability, submissions, rosters: {} });
assert.deepEqual(Array.from(overridden.assignments[0].assigned), ["EMP022", "EMP021", "EMP020", "EMP019"]);
assert.equal(overridden.assignments[0].overrides.length, 4);
for (const row of overridden.assignments) assert.equal(new Set(row.assigned).size, row.assigned.length);
for (const code of fullTeam) assert.ok(overridden.monthlyLoad[code] >= 1, `${code} must receive monthly coverage`);

console.log("Roster engine tests passed");
