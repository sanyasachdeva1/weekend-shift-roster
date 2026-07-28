-- Safe hotfix: make swap/cover colleague approval flexible after roster generation.
-- Roster generation still follows the max-stretch and fairness rules in roster-engine.js.
-- Swap/cover approval keeps only safety checks for same-group flow and duplicate same-date assignment.
-- This does not modify saved NA dates, submissions, existing rosters, team members, or access codes.

create or replace function public.open_decide_colleague_swap_request(
  p_request_id uuid,
  p_colleague_code text,
  p_access_code text,
  p_approved boolean
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  member team_members;
  req swap_requests;
  roster_row rosters;
  requester_code text;
  prior jsonb;
  assignments jsonb:='[]';
  item jsonb;
  assigned jsonb;
  source_assigned jsonb;
  destination_assigned jsonb;
begin
  member:=verify_employee_access(p_colleague_code,p_access_code);
  select * into req
  from swap_requests
  where id=p_request_id and colleague_code=member.employee_code and status='awaiting-colleague'
  for update;
  if req.id is null then raise exception 'Colleague approval request not found'; end if;

  select employee_code into requester_code from team_members where id=req.requester_id;

  if not p_approved then
    update swap_requests set status='rejected',colleague_decided_at=now(),decided_at=now() where id=req.id;
    insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
    values(
      member.employee_code,
      member.full_name,
      case when req.request_type='cover' then 'COVER_COLLEAGUE_REJECTED' else 'SWAP_COLLEAGUE_REJECTED' end,
      case when req.request_type='cover' then 'Colleague rejected cover request' else 'Colleague rejected swap request' end,
      to_jsonb(req),
      jsonb_build_object('approved',false)
    );
    return;
  end if;

  select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
  if roster_row.roster_month is null then raise exception 'Roster not found'; end if;
  prior:=roster_row.roster;

  select value->'assigned' into source_assigned
  from jsonb_array_elements(roster_row.roster->'assignments')
  where value->>'date'=req.from_date::text;

  if req.request_type='cover' then
    if not (source_assigned ? requester_code) then raise exception 'Requester is no longer assigned on source date'; end if;
    if source_assigned ? req.colleague_code then raise exception 'Employee already assigned on covered date'; end if;
  else
    select value->'assigned' into destination_assigned
    from jsonb_array_elements(roster_row.roster->'assignments')
    where value->>'date'=req.to_date::text;
    if source_assigned ? req.colleague_code or destination_assigned ? requester_code then
      raise exception 'Employee already assigned on destination date';
    end if;
  end if;

  for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
    assigned:=item->'assigned';
    if (item->>'date')::date=req.from_date then
      assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned));
    end if;
    if req.request_type='swap' and (item->>'date')::date=req.to_date then
      assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned));
    end if;
    assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
  end loop;

  update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  update swap_requests set status='approved',colleague_decided_at=now(),decided_by=null,decided_at=now() where id=req.id;
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(
    member.employee_code,
    member.full_name,
    case when req.request_type='cover' then 'COVER_APPROVED' else 'SWAP_APPROVED' end,
    case when req.request_type='cover' then 'Colleague approved cover and roster updated' else 'Colleague approved swap and roster updated' end,
    prior,
    (select roster from rosters where roster_month=roster_row.roster_month)
  );
end $$;

create or replace function public.open_revoke_swap_request(
  p_request_id uuid,
  p_requester_code text,
  p_access_code text
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  member team_members;
  req swap_requests;
  roster_row rosters;
  prior jsonb;
  assignments jsonb:='[]';
  item jsonb;
  assigned jsonb;
  source_assigned jsonb;
  destination_assigned jsonb;
begin
  member:=verify_employee_access(p_requester_code,p_access_code);
  select * into req
  from swap_requests
  where id=p_request_id and requester_id=member.id and status in ('awaiting-colleague','colleague-approved','approved')
  for update;
  if req.id is null then raise exception 'Revocable swap not found'; end if;

  if req.status='approved' then
    select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
    if roster_row.roster_month is null then raise exception 'Roster not found'; end if;
    prior:=roster_row.roster;

    select value->'assigned' into source_assigned
    from jsonb_array_elements(roster_row.roster->'assignments')
    where value->>'date'=req.from_date::text;

    if req.request_type='cover' then
      if not (source_assigned ? req.colleague_code) or source_assigned ? member.employee_code then
        raise exception 'Roster changed; approved cover cannot be safely reversed';
      end if;
    else
      select value->'assigned' into destination_assigned
      from jsonb_array_elements(roster_row.roster->'assignments')
      where value->>'date'=req.to_date::text;
      if not (source_assigned ? req.colleague_code)
        or not (destination_assigned ? member.employee_code)
        or source_assigned ? member.employee_code
        or destination_assigned ? req.colleague_code
      then
        raise exception 'Roster changed; approved swap cannot be safely reversed';
      end if;
    end if;

    for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
      assigned:=item->'assigned';
      if (item->>'date')::date=req.from_date then
        assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(member.employee_code) else value end) from jsonb_array_elements(assigned));
      end if;
      if req.request_type='swap' and (item->>'date')::date=req.to_date then
        assigned:=(select jsonb_agg(case when value#>>'{}'=member.employee_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned));
      end if;
      assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
    end loop;
    update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  end if;

  update swap_requests set status='revoked',decided_at=now() where id=req.id;
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(
    member.employee_code,
    member.full_name,
    case when req.request_type='cover' then 'COVER_REVOKED' else 'SWAP_REVOKED' end,
    'Requester revoked '||req.status||' '||req.request_type,
    coalesce(prior,to_jsonb(req)),
    case when req.status='approved' then (select roster from rosters where roster_month=roster_row.roster_month) else jsonb_build_object('status','revoked') end
  );
end $$;
