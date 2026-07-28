-- Safe one-time correction for August 2026 generated roster.
-- Purpose:
-- 1) remove EMP014/Renjith from the saved roster after he was removed from the active list;
-- 2) apply the max-stretch generation rule: no same weekend and no Sunday -> next Saturday assignment;
-- 3) keep consecutive Saturdays as a soft avoid-only rule;
-- 4) enforce basic engineer monthly load as minimum 1 and maximum 2 shifts;
-- 5) apply the soft Saturday/Sunday balance preference where it improves comfort without adding NA overrides.
--
-- This updates only public.rosters for 2026-08 and appends one audit row.
-- It does not delete or modify availability, submissions, team_members, or access codes.

do $$
declare
  prior jsonb;
  corrected_roster jsonb := '{
    "month": "2026-08",
    "status": "needs-review",
    "generatedAt": "2026-07-28T19:20:51.094Z",
    "generatedBy": "Manual safe regeneration after active list, max-stretch, max-2 load, previous-month target, and Sat/Sun balance correction",
    "assignments": [
      {
        "date": "2026-08-01",
        "required": 5,
        "requiredBasic": 4,
        "requiredSignature": 1,
        "assigned": ["EMP013", "EMP016", "EMP021", "EMP011", "SIG001"],
        "overrides": []
      },
      {
        "date": "2026-08-02",
        "required": 4,
        "requiredBasic": 3,
        "requiredSignature": 1,
        "assigned": ["EMP019", "EMP007", "EMP017", "SIG003"],
        "overrides": [
          {
            "name": "EMP017",
            "submittedAt": "2026-07-23T17:51:12.733244+00:00",
            "reason": "Latest responder NA override"
          }
        ]
      },
      {
        "date": "2026-08-08",
        "required": 5,
        "requiredBasic": 4,
        "requiredSignature": 1,
        "assigned": ["EMP022", "EMP020", "EMP016", "EMP004", "SIG004"],
        "overrides": []
      },
      {
        "date": "2026-08-09",
        "required": 4,
        "requiredBasic": 3,
        "requiredSignature": 1,
        "assigned": ["EMP018", "EMP008", "EMP006", "SIG002"],
        "overrides": []
      },
      {
        "date": "2026-08-15",
        "required": 5,
        "requiredBasic": 4,
        "requiredSignature": 1,
        "assigned": ["EMP005", "EMP003", "EMP007", "EMP015", "SIG003"],
        "overrides": []
      },
      {
        "date": "2026-08-16",
        "required": 4,
        "requiredBasic": 3,
        "requiredSignature": 1,
        "assigned": ["EMP017", "EMP011", "EMP020", "SIG001"],
        "overrides": []
      },
      {
        "date": "2026-08-22",
        "required": 5,
        "requiredBasic": 4,
        "requiredSignature": 1,
        "assigned": ["EMP001", "EMP004", "EMP008", "EMP002", "SIG002"],
        "overrides": []
      },
      {
        "date": "2026-08-23",
        "required": 4,
        "requiredBasic": 3,
        "requiredSignature": 1,
        "assigned": ["EMP006", "EMP021", "EMP013", "SIG001"],
        "overrides": [
          {
            "name": "EMP013",
            "submittedAt": "2026-07-24T10:12:02.948378+00:00",
            "reason": "Latest responder NA override"
          }
        ]
      },
      {
        "date": "2026-08-29",
        "required": 5,
        "requiredBasic": 4,
        "requiredSignature": 1,
        "assigned": ["EMP002", "EMP010", "EMP003", "EMP022", "SIG003"],
        "overrides": [
          {
            "name": "EMP022",
            "submittedAt": "2026-07-26T16:34:18.416134+00:00",
            "reason": "Latest responder NA override"
          }
        ]
      },
      {
        "date": "2026-08-30",
        "required": 4,
        "requiredBasic": 3,
        "requiredSignature": 1,
        "assigned": ["EMP015", "EMP005", "EMP019", "SIG002"],
        "overrides": [
          {
            "name": "EMP005",
            "submittedAt": "2026-07-23T17:43:27.744033+00:00",
            "reason": "Latest responder NA override"
          },
          {
            "name": "EMP019",
            "submittedAt": "2026-07-23T06:13:36.606876+00:00",
            "reason": "Latest responder NA override"
          }
        ]
      }
    ],
    "warnings": [
      "2026-08-02: EMP017 assigned by availability override",
      "2026-08-23: EMP013 assigned by availability override",
      "2026-08-29: EMP022 assigned by availability override",
      "2026-08-30: EMP005, EMP019 assigned by availability override"
    ]
  }'::jsonb;
begin
  select roster into prior
  from public.rosters
  where roster_month = date '2026-08-01';

  insert into public.rosters(roster_month, status, roster)
  values (date '2026-08-01', corrected_roster->>'status', corrected_roster)
  on conflict(roster_month)
  do update set
    status = excluded.status,
    roster = excluded.roster,
    generated_at = now();

  insert into public.audit_log(actor_name, action, details, before_data, after_data)
  values (
    'Codex safe roster correction',
    'ROSTER_SAVED',
    'Corrected August 2026 roster after removing EMP014 and enforcing max-stretch, max-2 basic load, previous-month target, and Sat/Sun balance rules; NA entries were not modified',
    prior,
    corrected_roster
  );
end $$;
