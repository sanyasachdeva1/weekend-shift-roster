# Weekend Shift Roster

A laptop-first static prototype for collecting weekend unavailability (NA) and generating a fair draft roster.

## Live mock-up

- Website: https://sanyasachdeva1.github.io/weekend-shift-roster/
- Before cutoff demo: https://sanyasachdeva1.github.io/weekend-shift-roster/?mockDate=2026-07-20&preview=before&storage=team-demo-before
- After roster generated demo: https://sanyasachdeva1.github.io/weekend-shift-roster/?mockDate=2026-07-29&preview=after&storage=team-demo-after

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## What works

- Opens on next month and shows real date/time in Asia/Kolkata.
- Each team member can mark weekend dates red (NA) and explicitly save their response.
- Availability is editable only from 15th 11:00 AM IST until 28th 7:00 PM IST for the following month.
- After cutoff, the scheduler can automatically generate the next roster.
- Demo mode can save data in that browser with `localStorage`; production requires Supabase shared storage.
- Exports JSON snapshots for backup or committing to GitHub.
- Exports a simple TXT proof file listing every person's name, NA dates and saved-response timestamp.
- Generates a draft with 4 basic engineers + 1 signature engineer on Saturday, and 3 basic engineers + 1 signature engineer on Sunday.
- Excludes NA dates initially, avoids consecutive Saturdays where possible, and balances assignments using prior-month history.
- Alternates each employee's target from actual prior-month load: anyone with 2 or more shifts last month is targeted for 1 this month; everyone else is targeted for 2.
- If availability causes a shortage, fills the gap by overriding NA for the latest responders first, using their saved response timestamps. Every override is visibly marked and retained in roster history.
- Treats anyone who did not submit before cutoff as available for the full month; there is no separate PTO administration.
- Employees can request a two-person date swap or ask a colleague to cover one assigned shift after the roster month begins; submitted NA dates do not block these options because teams can agree to exceptions.
- Once the selected colleague approves, the roster updates automatically: swaps exchange only the two requested assignments, and cover requests replace only the covered assignment.
- Basic engineers can swap/cover only with basic engineers; signature engineers can swap/cover only with signature engineers.
- Availability saves, roster generation, requests and decisions are recorded in an append-only audit log with before/after snapshots.
- The audit history can be downloaded as a JSON file.

For local testing outside the submission window, open `http://localhost:8000/?demo=1`. This override must not be enabled for real collection.

## Hosting and shared data

GitHub Pages can host the static site for free. It cannot securely write user submissions back into the repository by itself. For real multi-laptop collection, use GitHub Pages for the UI plus Supabase as the shared datastore. The production page intentionally locks submission controls when Supabase is not configured, so users do not accidentally save NA dates only on their own laptop. The current production flow is an open team form: each person selects their own name and saves NA dates without a login. A scheduled server job should freeze submissions and generate the roster at 28th 7:00 PM IST. Monthly finalized JSON, NA proof TXT files and audit exports may also be committed under `data/history/` as secondary archives.

Do not put a GitHub personal access token in browser JavaScript. It would be visible to every visitor.

## Production setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Copy `config.example.js` values into `config.js`, using the project URL and **public anon key** only.
3. No Google/Auth provider is required for the open team-form workflow.
4. Create a GitHub repository, enable Pages from the default branch, and add repository secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` if you later enable the monthly archive workflow.
5. The included workflow runs monthly and commits finalized roster plus audit history into month-named files such as `data/history/2026-08-August.json`, with the matching NA proof at `data/history/2026-08-August-na-proof.txt`. The service-role key stays only in GitHub Actions secrets.

The database—not the visitor's laptop—enforces that submissions are accepted only from 15th 11:00 AM IST until 28th 7:00 PM IST for the following month. Direct table access remains revoked; the page writes through limited Supabase RPC functions. Since this workflow intentionally has no login or employee code, the team relies on mindful name selection rather than identity enforcement.

### Identity and change tracking

- Employees select their name from the approved roster list and submit NA dates.
- Every save, swap/cover request, roster generation, approval, rejection and finalization writes the selected employee/admin display name, timestamp, before state and after state to `audit_log`.
- Only database administrators/service-role maintenance can alter audit rows directly; the application exposes no table update or delete permission for them.
