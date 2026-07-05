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

const date = "2026-08-01", availability = {}, submissions = {};
for (const [index, code] of people.entries()) {
  availability[code] = { "2026-08": { [date]: true } };
  submissions[code] = { "2026-08": { savedAt: `2026-07-${String(20 + index).padStart(2, "0")}T10:00:00Z` } };
}
const overridden = generate({ people, monthDate: new Date(2026, 7, 1), availability, submissions, rosters: {} });
assert.deepEqual(Array.from(overridden.assignments[0].assigned), ["EMP007", "EMP006", "EMP005", "EMP004"]);
assert.equal(overridden.assignments[0].overrides.length, 4);
assert.ok(overridden.warnings[0].includes("latest-response override"));

console.log("Roster engine tests passed");
