-- Special volunteer collection for 8/9 Aug 2026 case-demand weekend.
-- Safe scope: creates one new table and two RPC functions only.
-- It does not update/delete availability, submissions, rosters, team_members, swap_requests, or access codes.

create table if not exists public.special_weekend_volunteers (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  employee_id uuid not null references public.team_members(id),
  volunteer_date date not null,
  saved_at timestamptz not null default now(),
  unique(event_key, employee_id, volunteer_date)
);

create or replace function public.open_get_special_weekend_volunteers(p_event_key text) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_key',v.event_key,
    'employee_code',t.employee_code,
    'full_name',t.full_name,
    'coverage_group',t.coverage_group,
    'volunteer_date',v.volunteer_date::text,
    'saved_at',v.saved_at
  ) order by v.volunteer_date,t.full_name),'[]'::jsonb)
  from special_weekend_volunteers v
  join team_members t on t.id=v.employee_id
  where v.event_key=p_event_key and t.active;
$$;

create or replace function public.open_save_special_weekend_volunteer(p_event_key text,p_employee_code text,p_access_code text,p_dates text[]) returns void language plpgsql security definer set search_path=public as $$
declare
  member team_members;
  allowed_dates date[]:=array['2026-08-08'::date,'2026-08-09'::date];
  requested_dates date[];
  requested_date date;
  prior jsonb;
  current_ist timestamp:=(now() at time zone 'Asia/Kolkata');
begin
  if p_event_key <> 'aug-2026-case-demand' then raise exception 'Unknown special volunteer event'; end if;
  if current_ist >= timestamp '2026-08-07 19:00:00' then raise exception 'Special volunteer collection is closed'; end if;
  member:=verify_employee_access(p_employee_code,p_access_code);
  requested_dates:=coalesce((select array_agg(distinct value::date) from unnest(coalesce(p_dates,array[]::text[])) value),array[]::date[]);
  foreach requested_date in array requested_dates loop
    if not requested_date = any(allowed_dates) then raise exception 'This special request only accepts 8 Aug and 9 Aug'; end if;
  end loop;
  select open_get_special_weekend_volunteers(p_event_key) into prior;
  delete from special_weekend_volunteers where event_key=p_event_key and employee_id=member.id;
  foreach requested_date in array requested_dates loop
    insert into special_weekend_volunteers(event_key,employee_id,volunteer_date) values(p_event_key,member.id,requested_date);
  end loop;
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(member.employee_code,member.full_name,'SPECIAL_VOLUNTEER_SAVED','Special weekend volunteer nomination saved for '||member.full_name,prior,open_get_special_weekend_volunteers(p_event_key));
end $$;

alter table special_weekend_volunteers enable row level security;

grant execute on function open_get_special_weekend_volunteers(text),open_save_special_weekend_volunteer(text,text,text,text[]) to anon,authenticated;
