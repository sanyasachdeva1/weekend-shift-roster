import { mkdir, writeFile } from "node:fs/promises";

await import(new URL("../roster-engine.js", import.meta.url));

const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || "https://npzmwgdnmactszivuukn.supabase.co",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "sb_publishable_NcYC81_XQ4iSUGa0-NqeHg_o4HYmyGG"
};
const HEADERS = {
  apikey: CONFIG.supabaseAnonKey,
  Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
  "Content-Type": "application/json"
};
const RETIRED = new Set(["EMP014"]);

const rpc = async (name, body = {}) => {
  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${text}`);
  return text ? JSON.parse(text) : null;
};
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthKey = (date) => dateKey(date).slice(0, 7);
const parseDate = (key) => new Date(`${key}T12:00:00`);
const targetMonth = process.env.ROSTER_MONTH || monthKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
const monthDate = parseDate(`${targetMonth}-01`);
const monthLabel = monthDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const historyBase = `data/history/${targetMonth}-${monthDate.toLocaleDateString("en-US", { month: "long" })}`;

function normalizeState(remote) {
  return {
    availability: remote?.availability || {},
    submissions: remote?.submissions || {},
    rosters: remote?.rosters || {},
    team: remote?.team || [],
    audit: remote?.audit || []
  };
}
function displayMap(team) {
  return Object.fromEntries(team.map((member) => [member.employee_code, member.full_name]));
}
function formatDates(dates) {
  return dates.length
    ? dates.map((key) => parseDate(key).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })).join(", ")
    : "No NA submitted";
}
async function exportNAProof(state) {
  const names = displayMap(state.team);
  const lines = [
    "Weekend Shift Roster - NA Entries Proof",
    `Roster month: ${monthLabel}`,
    "Submission window: 15th 11:00 AM IST to 28th 7:00 PM IST",
    `Exported at: ${new Date().toISOString()}`,
    ""
  ];
  for (const member of state.team.filter((item) => !RETIRED.has(item.employee_code))) {
    const dates = Object.keys(state.availability[member.employee_code]?.[targetMonth] || {}).sort();
    const savedAt = state.submissions[member.employee_code]?.[targetMonth]?.savedAt;
    lines.push(`${names[member.employee_code]}: ${formatDates(dates)} | ${savedAt ? `saved: ${savedAt}` : "no saved response"}`);
  }
  await mkdir("data/history", { recursive: true });
  const file = `${historyBase}-na-proof.txt`;
  await writeFile(file, `${lines.join("\n")}\n`);
  console.log(`Wrote ${file}`);
}
async function generateRoster(state) {
  if (state.rosters[targetMonth]) {
    console.log(`Roster already exists for ${targetMonth}; not overwriting.`);
    return;
  }
  const team = state.team.filter((member) => !RETIRED.has(member.employee_code));
  const people = team.map((member) => member.employee_code);
  const signaturePeople = team.filter((member) => member.coverage_group === "signature").map((member) => member.employee_code);
  const generated = globalThis.RosterEngine.generate({
    people,
    signaturePeople,
    monthDate,
    availability: state.availability,
    submissions: state.submissions,
    rosters: state.rosters
  });
  const roster = {
    month: targetMonth,
    status: generated.warnings.length ? "needs-review" : "published",
    generatedAt: new Date().toISOString(),
    generatedBy: "Automatic cutoff scheduler",
    assignments: generated.assignments,
    warnings: generated.warnings
  };
  await rpc("open_save_roster", {
    p_month: targetMonth,
    p_roster: roster,
    p_actor_name: "Automatic cutoff scheduler",
    p_access_code: ""
  });
  await writeFile(`${historyBase}-draft-roster.json`, `${JSON.stringify(roster, null, 2)}\n`);
  console.log(`Saved ${targetMonth} roster with ${generated.warnings.length} warning(s).`);
}

const mode = process.argv[2] || "proof";
const state = normalizeState(await rpc("open_get_roster_state"));
if (mode === "proof") await exportNAProof(state);
else if (mode === "generate") {
  await exportNAProof(state);
  await generateRoster(state);
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
