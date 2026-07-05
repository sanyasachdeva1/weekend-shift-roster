# Weekend Shift Roster

A laptop-first static prototype for collecting weekend unavailability (NA) and generating a fair draft roster.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## What works

- Opens on next month and shows real date/time in Asia/Kolkata.
- Each team member can mark weekend dates red (NA) and explicitly save their response.
- Availability is editable only from the 15th through the 28th for the following month.
- After cutoff, the scheduler can automatically generate the next roster.
- Saves data in that browser with `localStorage`.
- Imports/exports JSON snapshots for backup or committing to GitHub.
- Generates a draft with 4 people on Saturday and 3 on Sunday.
- Excludes NA dates initially, avoids consecutive Saturdays where possible, and balances assignments using prior-month history.
- Alternates each employee's target from actual prior-month load: anyone with 2 or more shifts last month is targeted for 1 this month; everyone else is targeted for 2.
- If availability causes a shortage, fills the gap by overriding NA for the latest responders first, using their saved response timestamps. Every override is visibly marked and retained in roster history.
- Treats anyone who did not submit before cutoff as available for the full month; there is no separate PTO administration.
- Employees can request a two-person date swap after the roster month begins.
- Admin approval atomically exchanges only the two requested assignments.
- Availability saves, roster generation, requests and decisions are recorded in an append-only audit log with before/after snapshots.
- The audit history can be downloaded as a JSON file.

For local testing outside the submission window, open `http://localhost:8000/?demo=1`. This override must not be enabled in production.

## Hosting and shared data

GitHub Pages can host the static site for free. It cannot securely write user submissions back into the repository by itself. For a multi-user production version, use GitHub Pages for the UI plus a shared datastore (Supabase is a good fit), authentication, role-based admin access, database row-level security and an immutable audit table. A scheduled server job should freeze submissions and generate the roster after the 28th. Monthly finalized JSON and audit exports may also be committed under `data/history/` as secondary archives.

Do not put a GitHub personal access token in browser JavaScript. It would be visible to every visitor.

## Production setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Copy `config.example.js` values into `config.js`, using the project URL and **public anon key** only.
3. In Supabase Authentication, enable the Google provider. Create Google OAuth credentials, copy the client ID/secret into Supabase, and add the Supabase callback URL shown there to Google's authorized redirect URIs. Add the GitHub Pages URL to Supabase's allowed redirect URLs.
4. Ask each person to sign in once with their approved Gmail or Google Workspace account and select their full name from the approved list. Their account remains blocked until an administrator approves the mapping. After approval the application locks their identity to that Google account. Set only trusted administrators to `role='admin'`.
5. Create a GitHub repository, enable Pages from the default branch, and add repository secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
6. The included workflow runs monthly and commits finalized roster plus audit history into `data/history/YYYY-MM.json`. The service-role key stays only in GitHub Actions secrets.

The database—not the visitor's laptop—enforces that submissions are accepted only from the 15th through 28th for the following month. Row-level security prevents employees from saving another person's availability or using admin operations.

### Identity and change tracking

- Google performs authentication; Supabase issues the application session.
- One authenticated Google `user_id` maps to one unique employee code and name.
- Unmapped Google accounts can sign in but cannot read or write roster data.
- Employees cannot choose another name in shared mode, even by modifying browser code: database functions compare the requested person with `auth.uid()`.
- Every save, swap request, roster generation, approval, rejection and finalization writes the authenticated user ID, display name, timestamp, before state and after state to `audit_log`.
- Only database administrators/service-role maintenance can alter audit rows; the application exposes no update or delete permission for them.
