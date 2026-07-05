import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
const month = process.env.ROSTER_MONTH || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (path) => { const response = await fetch(`${url}/rest/v1/${path}`, { headers }); if (!response.ok) throw new Error(await response.text()); return response.json(); };
const rosters = await get(`rosters?roster_month=eq.${month}-01&select=*`);
if (!rosters.length || !["published", "finalized"].includes(rosters[0].status)) throw new Error(`No publishable roster for ${month}`);
const audit = await get(`audit_log?occurred_at=gte.${month}-01T00:00:00Z&occurred_at=lt.${new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString()}&select=occurred_at,actor_code,action&order=occurred_at.asc`);
await mkdir("data/history", { recursive: true });
await writeFile(`data/history/${month}.json`, JSON.stringify({ archivedAt: new Date().toISOString(), roster: rosters[0], audit }, null, 2) + "\n");
