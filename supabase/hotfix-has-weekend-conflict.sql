-- Safe hotfix: updates only the database-side conflict checker used by swap/cover approvals.
-- It does not modify any saved NA dates, submissions, rosters, team members, or access codes.

create or replace function public.has_weekend_conflict(
  p_roster jsonb,
  p_code text,
  p_candidate date,
  p_excluded date default null
) returns boolean
language sql
immutable
as $$
  select exists(
    select 1
    from jsonb_array_elements(p_roster->'assignments') item
    where (item->>'date')::date is distinct from p_excluded
      and (item->'assigned') ? p_code
      and (
        -- Same Saturday/Sunday weekend.
        ((item->>'date')::date - case when extract(dow from (item->>'date')::date)=0 then 1 else 0 end)
          = (p_candidate - case when extract(dow from p_candidate)=0 then 1 else 0 end)

        -- Sunday followed by the next Saturday creates a 7-day continuous stretch.
        or (
          extract(dow from (item->>'date')::date)=0
          and extract(dow from p_candidate)=6
          and p_candidate-(item->>'date')::date=6
        )
        or (
          extract(dow from (item->>'date')::date)=6
          and extract(dow from p_candidate)=0
          and (item->>'date')::date-p_candidate=6
        )
      )
  );
$$;
