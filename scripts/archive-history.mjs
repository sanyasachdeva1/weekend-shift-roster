import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
const month = process.env.ROSTER_MONTH || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const monthDate = new Date(`${month}-01T12:00:00Z`);
const monthLabel = monthDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const archiveBase = `${month}-${monthLabel}`;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (path) => { const response = await fetch(`${url}/rest/v1/${path}`, { headers }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
const rosters = await get(`rosters?roster_month=eq.${month}-01&select=*`);
if (!rosters.length || !["published", "finalized"].includes(rosters[0].status)) throw new Error(`No publishable roster for ${month}`);
const audit = await get(`audit_log?occurred_at=gte.${month}-01T00:00:00Z&occurred_at=lt.${new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString()}&select=occurred_at,actor_code,action&order=occurred_at.asc`);
const team = await get("team_members?select=employee_code,full_name&order=employee_code.asc");
const availability = await get(`availability?roster_month=eq.${month}-01&select=employee_id,na_date,team_members(employee_code,full_name)&order=na_date.asc`);
const submissions = await get(`submissions?roster_month=eq.${month}-01&select=employee_id,saved_at,team_members(employee_code)&order=saved_at.asc`);
const availabilityByCode = new Map();
for (const row of availability) {
  const code = row.team_members?.employee_code;
  if (!code) continue;
  if (!availabilityByCode.has(code)) availabilityByCode.set(code, []);
  availabilityByCode.get(code).push(row.na_date);
}
const submittedAtByCode = new Map(submissions.map((row) => [row.team_members?.employee_code, row.saved_at]).filter(([code]) => code));
const proofLines = [
  "Weekend Shift Roster - NA Entries Proof",
  `Roster month: ${monthLabel} ${month.slice(0, 4)}`,
  "Submission window: 15th 11:00 AM IST to 28th 7:00 PM IST",
  `Archived at: ${new Date().toISOString()}`,
  ""
];
for (const member of team) {
  const dates = availabilityByCode.get(member.employee_code) || [];
  proofLines.push(`${member.full_name}: ${dates.length ? dates.join(", ") : "No NA submitted"} | ${submittedAtByCode.has(member.employee_code) ? `saved: ${submittedAtByCode.get(member.employee_code)}` : "no saved response"}`);
}
await mkdir("data/history", { recursive: true });
await writeFile(`data/history/${archiveBase}.json`, JSON.stringify({ archivedAt: new Date().toISOString(), month, monthName: monthLabel, roster: rosters[0], audit }, null, 2) + "\n");
await writeFile(`data/history/${archiveBase}-na-proof.txt`, `${proofLines.join("\n")}\n`);
