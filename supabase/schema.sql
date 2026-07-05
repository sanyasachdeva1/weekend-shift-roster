create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'employee' check (role in ('employee','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null check (employee_code ~ '^EMP[0-9]{3}$'),
  full_name text,
  user_id uuid unique references public.profiles(user_id),
  active boolean not null default true
);
insert into public.team_members(employee_code)
select 'EMP'||lpad(n::text,3,'0') from generate_series(1,22) n
on conflict(employee_code) do nothing;

create table if not exists public.identity_mapping_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  employee_code text not null references public.team_members(employee_code),
  full_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(user_id)
);
create unique index if not exists one_pending_identity_per_user on public.identity_mapping_requests(user_id) where status='pending';

create table if not exists public.availability (
  employee_id uuid not null references public.team_members(id),
  roster_month date not null,
  na_date date not null,
  saved_at timestamptz not null default now(),
  primary key(employee_id,roster_month,na_date)
);
create table if not exists public.submissions (
  employee_id uuid not null references public.team_members(id),
  roster_month date not null,
  saved_at timestamptz not null default now(),
  primary key(employee_id,roster_month)
);
create table if not exists public.rosters (
  roster_month date primary key,
  status text not null check(status in ('draft','needs-review','published','finalized')),
  roster jsonb not null,
  generated_by uuid references public.profiles(user_id),
  generated_at timestamptz not null default now(),
  finalized_at timestamptz
);
create table if not exists public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.team_members(id),
  colleague_code text not null references public.team_members(employee_code),
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
  decided_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(user_id),
  actor_code text,
  actor_name text,
  action text not null,
  details text not null,
  before_data jsonb,
  after_data jsonb
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where user_id=auth.uid() and role='admin' and active);
$$;
create or replace function public.current_member() returns public.team_members language sql stable security definer set search_path=public as $$
  select t from team_members t join profiles p on p.user_id=t.user_id where p.user_id=auth.uid() and p.active and t.active;
$$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(user_id) values(new.id) on conflict do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.my_profile() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('role',p.role,'active',p.active,'employee_code',t.employee_code,'full_name',t.full_name)
  from profiles p left join team_members t on t.user_id=p.user_id where p.user_id=auth.uid();
$$;
create or replace function public.request_identity_mapping(p_employee_code text,p_full_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare p profiles; request_id uuid;
begin
  select * into p from profiles where user_id=auth.uid() and active;
  if p.user_id is null then raise exception 'Authenticated profile required'; end if;
  if exists(select 1 from team_members where user_id=auth.uid()) then raise exception 'Account already mapped'; end if;
  if not exists(select 1 from team_members where employee_code=p_employee_code and user_id is null) then raise exception 'That employee is already mapped or unavailable'; end if;
  if length(trim(p_full_name)) not between 3 and 120 then raise exception 'Enter a valid full name'; end if;
  insert into identity_mapping_requests(user_id,employee_code,full_name) values(auth.uid(),p_employee_code,trim(p_full_name)) returning id into request_id;
  return request_id;
end $$;
create or replace function public.get_mapping_requests() returns jsonb language sql stable security definer set search_path=public as $$
  select case when is_admin() then coalesce(jsonb_agg(to_jsonb(r) order by created_at),'[]') else '[]'::jsonb end
  from identity_mapping_requests r where status='pending';
$$;
create or replace function public.decide_identity_mapping(p_request_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path=public as $$
declare admin_profile profiles; req identity_mapping_requests; member team_members;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  select * into admin_profile from profiles where user_id=auth.uid();
  select * into req from identity_mapping_requests where id=p_request_id and status='pending' for update;
  if req.id is null then raise exception 'Pending mapping not found'; end if;
  if p_approved then
    select * into member from team_members where employee_code=req.employee_code and user_id is null for update;
    if member.id is null then raise exception 'That employee was already assigned'; end if;
    update team_members set user_id=req.user_id,full_name=req.full_name where id=member.id;
  end if;
  update identity_mapping_requests set status=case when p_approved then 'approved' else 'rejected' end,decided_at=now(),decided_by=auth.uid() where id=req.id;
  insert into audit_log(actor_id,actor_name,action,details,before_data,after_data)
  values(auth.uid(),(select full_name from team_members where user_id=auth.uid()),case when p_approved then 'IDENTITY_APPROVED' else 'IDENTITY_REJECTED' end,'Identity mapping decision',to_jsonb(req),jsonb_build_object('approved',p_approved,'employee_code',member.employee_code));
end $$;

create or replace function public.save_my_availability(p_employee_code text,p_month text,p_na_dates text[]) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; month_date date:=(p_month||'-01')::date; today_ist date:=(now() at time zone 'Asia/Kolkata')::date; prior jsonb;
begin
  member:=current_member();
  if member.id is null or member.employee_code<>p_employee_code then raise exception 'Cannot save another employee account'; end if;
  if extract(day from today_ist) not between 15 and 28 or month_date<>date_trunc('month',today_ist+interval '1 month')::date then raise exception 'Submission window is closed'; end if;
  select coalesce(jsonb_agg(na_date order by na_date),'[]') into prior from availability where employee_id=member.id and roster_month=month_date;
  delete from availability where employee_id=member.id and roster_month=month_date;
  insert into availability(employee_id,roster_month,na_date) select member.id,month_date,x::date from unnest(p_na_dates)x;
  insert into submissions(employee_id,roster_month) values(member.id,month_date) on conflict(employee_id,roster_month) do update set saved_at=now();
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,'AVAILABILITY_SAVED','Availability saved for '||p_month,prior,to_jsonb(p_na_dates));
end $$;

create or replace function public.save_roster(p_month text,p_roster jsonb) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; month_date date:=(p_month||'-01')::date; prior jsonb;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  member:=current_member(); select roster into prior from rosters where roster_month=month_date;
  insert into rosters(roster_month,status,roster,generated_by) values(month_date,coalesce(p_roster->>'status','draft'),p_roster,auth.uid())
  on conflict(roster_month) do update set status=excluded.status,roster=excluded.roster,generated_by=auth.uid(),generated_at=now();
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,'ROSTER_SAVED','Roster saved for '||p_month,prior,p_roster);
end $$;
create or replace function public.finalize_roster(p_month text) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; month_date date:=(p_month||'-01')::date; prior jsonb;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  member:=current_member(); select roster into prior from rosters where roster_month=month_date for update;
  if prior is null then raise exception 'Roster not found'; end if;
  update rosters set status='finalized',finalized_at=now(),roster=jsonb_set(jsonb_set(roster,'{status}','"finalized"'),'{finalizedAt}',to_jsonb(now())) where roster_month=month_date;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,'ROSTER_FINALIZED','Finalized '||p_month,prior,(select roster from rosters where roster_month=month_date));
end $$;

create or replace function public.create_swap_request(p_request jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare member team_members; request_id uuid;
begin
  member:=current_member();
  if member.id is null or member.employee_code<>p_request->>'requester' then raise exception 'Requester does not match login'; end if;
  insert into swap_requests(id,requester_id,colleague_code,from_date,to_date,reason)
  values((p_request->>'id')::uuid,member.id,p_request->>'colleague',(p_request->>'fromDate')::date,(p_request->>'toDate')::date,p_request->>'reason') returning id into request_id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,after_data)
  values(auth.uid(),member.employee_code,member.full_name,'SWAP_REQUESTED','Swap request created',p_request);
  return request_id;
end $$;
create or replace function public.revoke_swap_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; req swap_requests; roster_row rosters; requester_code text; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; source_assigned jsonb; destination_assigned jsonb;
begin
  member:=current_member(); select * into req from swap_requests where id=p_request_id and requester_id=member.id and status in ('pending','approved') for update;
  if req.id is null then raise exception 'Revocable swap not found'; end if;
  if req.status='approved' then
    select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
    if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster; requester_code:=member.employee_code;
    select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
    select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
    if not (source_assigned ? req.colleague_code) or not (destination_assigned ? requester_code) or source_assigned ? requester_code or destination_assigned ? req.colleague_code then raise exception 'Roster changed; approved swap cannot be safely reversed'; end if;
    for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
      assigned:=item->'assigned';
      if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
      if (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
      assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
    end loop;
    update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  end if;
  update swap_requests set status='revoked',decided_at=now() where id=req.id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,'SWAP_REVOKED','Requester revoked '||req.status||' swap',coalesce(prior,to_jsonb(req)),case when req.status='approved' then (select roster from rosters where roster_month=roster_row.roster_month) else jsonb_build_object('status','revoked') end);
end $$;
create or replace function public.decide_swap_request(p_request_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path=public as $$
declare admin_profile profiles; admin_member team_members; req swap_requests; roster_row rosters; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; requester_code text; source_assigned jsonb; destination_assigned jsonb; colleague_id uuid;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  select * into admin_profile from profiles where user_id=auth.uid(); admin_member:=current_member();
  select * into req from swap_requests where id=p_request_id and status='pending' for update;
  if req.id is null then raise exception 'Pending request not found'; end if;
  select employee_code into requester_code from team_members where id=req.requester_id;
  if not p_approved then
    update swap_requests set status='rejected',decided_by=auth.uid(),decided_at=now() where id=req.id;
    insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data) values(auth.uid(),admin_member.employee_code,admin_member.full_name,'SWAP_REJECTED','Swap rejected',to_jsonb(req)); return;
  end if;
  select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
  if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster;
  select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
  select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
  select id into colleague_id from team_members where employee_code=req.colleague_code;
  if source_assigned ? req.colleague_code or destination_assigned ? requester_code then raise exception 'Employee already assigned on destination date'; end if;
  if exists(select 1 from availability where employee_id=colleague_id and na_date=req.from_date) or exists(select 1 from availability where employee_id=req.requester_id and na_date=req.to_date) then raise exception 'Swap conflicts with submitted NA'; end if;
  for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
    assigned:=item->'assigned';
    if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
    if (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
    assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
  end loop;
  update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  update swap_requests set status='approved',decided_by=auth.uid(),decided_at=now() where id=req.id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),admin_member.employee_code,admin_member.full_name,'SWAP_APPROVED','Approved swap '||req.id,prior,(select roster from rosters where roster_month=roster_row.roster_month));
end $$;

create or replace function public.get_roster_state() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:=jsonb_build_object('version',3,'availability','{}','submissions','{}','rosters','{}','swapRequests','[]','audit','[]','team','[]'); member team_members; row_data record;
begin
  member:=current_member(); if member.id is null then raise exception 'Approved account required'; end if;
  result:=jsonb_set(result,'{team}',coalesce((select jsonb_agg(jsonb_build_object('employee_code',employee_code,'full_name',full_name) order by employee_code) from team_members where active and full_name is not null),'[]'));
  for row_data in select t.employee_code,a.roster_month,jsonb_object_agg(a.na_date::text,true) dates from availability a join team_members t on t.id=a.employee_id where a.employee_id=member.id or is_admin() group by t.employee_code,a.roster_month loop result:=jsonb_set(result,array['availability',row_data.employee_code,to_char(row_data.roster_month,'YYYY-MM')],row_data.dates,true); end loop;
  for row_data in select t.employee_code,s.roster_month,s.saved_at from submissions s join team_members t on t.id=s.employee_id where s.employee_id=member.id or is_admin() loop result:=jsonb_set(result,array['submissions',row_data.employee_code,to_char(row_data.roster_month,'YYYY-MM')],jsonb_build_object('savedAt',row_data.saved_at),true); end loop;
  for row_data in select roster_month,roster from rosters where status in('published','finalized') or is_admin() loop result:=jsonb_set(result,array['rosters',to_char(row_data.roster_month,'YYYY-MM')],row_data.roster,true); end loop;
  result:=jsonb_set(result,'{swapRequests}',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'requester',t.employee_code,'colleague',s.colleague_code,'fromDate',s.from_date,'toDate',s.to_date,'reason',s.reason,'status',s.status,'createdAt',s.created_at)) from swap_requests s join team_members t on t.id=s.requester_id where s.requester_id=member.id or is_admin()),'[]'));
  if is_admin() then result:=jsonb_set(result,'{audit}',coalesce((select jsonb_agg(jsonb_build_object('id',id,'at',occurred_at,'actor',coalesce(actor_name,actor_code),'action',action,'details',details,'before',before_data,'after',after_data) order by occurred_at) from audit_log),'[]')); end if;
  return result;
end $$;

alter table profiles enable row level security; alter table team_members enable row level security; alter table identity_mapping_requests enable row level security;
alter table availability enable row level security; alter table submissions enable row level security; alter table rosters enable row level security;
alter table swap_requests enable row level security; alter table audit_log enable row level security;
revoke all on all tables in schema public from anon,authenticated;
grant execute on function my_profile(),request_identity_mapping(text,text),get_mapping_requests(),decide_identity_mapping(uuid,boolean),get_roster_state(),save_my_availability(text,text,text[]),save_roster(text,jsonb),finalize_roster(text),create_swap_request(jsonb),revoke_swap_request(uuid),decide_swap_request(uuid,boolean) to authenticated;

-- Bootstrap the first administrator after their first Google login using the auth user UUID:
-- update profiles set role='admin' where user_id='<auth-user-uuid>';
-- update team_members set user_id='<auth-user-uuid>', full_name='<admin-name>' where employee_code='EMP001';
