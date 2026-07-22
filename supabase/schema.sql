create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'employee' check (role in ('employee','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null check (employee_code ~ '^(EMP|SIG)[0-9]{3}$'),
  full_name text,
  coverage_group text not null default 'basic' check(coverage_group in ('basic','signature')),
  user_id uuid unique references public.profiles(user_id),
  active boolean not null default true
);
alter table public.team_members add column if not exists coverage_group text not null default 'basic';
do $$
begin
  alter table public.team_members drop constraint if exists team_members_employee_code_check;
  if not exists (select 1 from pg_constraint where conname='team_members_employee_code_check') then
    alter table public.team_members add constraint team_members_employee_code_check check(employee_code ~ '^(EMP|SIG)[0-9]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='team_members_coverage_group_check') then
    alter table public.team_members add constraint team_members_coverage_group_check check(coverage_group in ('basic','signature'));
  end if;
end $$;
insert into public.team_members(employee_code)
select 'EMP'||lpad(n::text,3,'0') from generate_series(1,22) n
on conflict(employee_code) do nothing;
insert into public.team_members(employee_code,coverage_group) values
('SIG001','signature'),('SIG002','signature'),('SIG003','signature'),('SIG004','signature')
on conflict(employee_code) do update set coverage_group=excluded.coverage_group;
update public.team_members set active=false where employee_code in ('EMP009','EMP012');
update public.team_members set full_name='Sanya Sachdeva', coverage_group='basic', active=true where employee_code='EMP001';
update public.team_members set full_name='Aarushi Garg', coverage_group='basic', active=true where employee_code='EMP002';
update public.team_members set full_name='Anmol Singh', coverage_group='basic', active=true where employee_code='EMP003';
update public.team_members set full_name='Charan Sai Kumar Reddy Gondesi', coverage_group='basic', active=true where employee_code='EMP004';
update public.team_members set full_name='Goutham Reddy Akula', coverage_group='basic', active=true where employee_code='EMP005';
update public.team_members set full_name='Hariprasad Natarajan', coverage_group='basic', active=true where employee_code='EMP006';
update public.team_members set full_name='Harish Kumar Thirumurugasakthivel', coverage_group='basic', active=true where employee_code='EMP007';
update public.team_members set full_name='Kishan Ravindranath', coverage_group='basic', active=true where employee_code='EMP008';
update public.team_members set full_name='Lakshmi R', coverage_group='basic', active=false where employee_code='EMP009';
update public.team_members set full_name='Naveen Kumar M', coverage_group='basic', active=true where employee_code='EMP010';
update public.team_members set full_name='Phiravin Arulmozhi', coverage_group='basic', active=true where employee_code='EMP011';
update public.team_members set full_name='Prabu N', coverage_group='basic', active=false where employee_code='EMP012';
update public.team_members set full_name='Rakshith L', coverage_group='basic', active=true where employee_code='EMP013';
update public.team_members set full_name='Renjith Gopalakrishna Pillai', coverage_group='basic', active=true where employee_code='EMP014';
update public.team_members set full_name='Sai Amrutha', coverage_group='basic', active=true where employee_code='EMP015';
update public.team_members set full_name='Shreya Jain', coverage_group='basic', active=true where employee_code='EMP016';
update public.team_members set full_name='Simran Vyas', coverage_group='basic', active=true where employee_code='EMP017';
update public.team_members set full_name='Sri Pavan Gurajala', coverage_group='basic', active=true where employee_code='EMP018';
update public.team_members set full_name='Sunil Tiwari', coverage_group='basic', active=true where employee_code='EMP019';
update public.team_members set full_name='Swetha Lakshme Sridharan', coverage_group='basic', active=true where employee_code='EMP020';
update public.team_members set full_name='Vritti Mehrotra', coverage_group='basic', active=true where employee_code='EMP021';
update public.team_members set full_name='Yokeswaran Yohadhandan', coverage_group='basic', active=true where employee_code='EMP022';
update public.team_members set full_name='Aneesh U', coverage_group='signature', active=true where employee_code='SIG001';
update public.team_members set full_name='Ankit Thapliyal', coverage_group='signature', active=true where employee_code='SIG002';
update public.team_members set full_name='Jagannath Sivaramakrishnan', coverage_group='signature', active=true where employee_code='SIG003';
update public.team_members set full_name='Sandeep Hangaragi', coverage_group='signature', active=true where employee_code='SIG004';

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
  request_type text not null default 'swap' check(request_type in ('swap','cover')),
  colleague_code text not null references public.team_members(employee_code),
  from_date date not null,
  to_date date,
  reason text,
  status text not null default 'awaiting-colleague' check(status in ('awaiting-colleague','colleague-approved','approved','rejected','revoked')),
  decided_by uuid references public.profiles(user_id),
  colleague_decided_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.swap_requests add column if not exists request_type text not null default 'swap';
alter table public.swap_requests alter column to_date drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='swap_requests_request_type_check') then
    alter table public.swap_requests add constraint swap_requests_request_type_check check(request_type in ('swap','cover'));
  end if;
end $$;
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

create table if not exists public.employee_access_codes (
  employee_code text primary key references public.team_members(employee_code) on delete cascade,
  salt text not null,
  code_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_access_codes (
  admin_name text primary key,
  salt text not null,
  code_hash text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.employee_access_codes(employee_code,salt,code_hash) values
('EMP001','937e30481fa9342b','37b6014351673a87686a27853c296c5c31dc764771110be17648977bc6d3c20d'),
('EMP002','14132909fcf6e878','f78cf391401f62530a62f7c0b69848fd25b177b91fcdc5f08a6a0a6f110363f8'),
('EMP003','5ed410ced088f53b','f262b254d55239e9c6db3c2dca4dbf468954df3fa97c7b66810c1a11fe11c844'),
('EMP004','e9c3f41286ed06a1','151c1a082091307d5023515c83f99023bfc77a842ef67b2a54d22e9a2ee868a2'),
('EMP005','d6ef3d2048c8bc94','3ef42338be6aa2d5b3168aac546d1b4c9bcee1e7e52eddbd4c55b15b26fc8c9c'),
('EMP006','b28113a046b54170','f1547cf00be13b2cc0f88d59e0f0a658dd67aaf4f243eb25556eb6e0f282c38c'),
('EMP007','9dd676a49b66f766','74e40b465bf2a54b05522406874df335bfa8858f0209ce918abea6ee7047bf96'),
('EMP008','87dd90d274610ba4','bd54a79bb84f760b3d5e32a161b620fa5265a5b6c15be01af52e5eb1cf2a9b0e'),
('EMP010','3e055927301a3291','8559a17859ce0f0ce6a26cc83c1e861d038ba1ba0c56cb93f16e530a808356bb'),
('EMP011','6aca68d67cfa2fef','7bfc8285adcc97c163b972b1a0ec3f444a989be579aa5d9a517c7d65b5061f88'),
('EMP013','935fea6014c6cc40','86cac2c5fb26038af1fc92a957e8177ad3a2b7a60fad9f21538752e5268fa134'),
('EMP014','a0919d766d022c9e','bb1296f20503386a9c817c678ec78d089c6fa96ad8edef2123e4695dad399352'),
('EMP015','8762656898c00f84','d60d1114c0cecc0503e6bc19614286d639d3b5781146839b7f91129294e1fbea'),
('EMP016','0be53d29671ac29b','c2563005699106ce2a1a2d7c561343c7384c78b0abc5b80aa7e52f0ada4f1ee7'),
('EMP017','9d49f75e73fa556a','961f37ad94caf73e74ca24241745842b602cb4c0db88741ebcb337e655ef312e'),
('EMP018','6ef2ba6c93aa8248','733eb0dfa162efc126f59592fb80c22ee4e8eed6f43a1808c91f0673000ef363'),
('EMP019','c851f18d664abe8b','b51e5499d4207a1706f1948f85c151eabe6901af8ba6b5d10bc2bfc38d01ad05'),
('EMP020','f5c4f5c2f94fd06c','bfe4e24fb86070a303d5d033e7c87d107453a405e83821f9169d0271616862c3'),
('EMP021','35f569a06eb68e38','4fc2bd21b6216b942810659d1e3b1eb22556ada0dc2ec545f51080ee55a2967a'),
('EMP022','55666d6c60221672','6826aeeb0f877c92f790d7185a8846d0eb26aa43c857e46b7f279f0f8a488874'),
('SIG001','af6320561bc04daa','d367f9f0cda0524661f8131d9b055207c4587a215162a180695d952aab8caf58'),
('SIG002','c5966078268acba2','c8c09b2fd901bde51832dd3afdf800a9f63323c315abca206800bae2d21a7499'),
('SIG003','9787702c8b9dcaff','bc186c62ffe839f4a12bc4666793bd0403e2c7bae595d4042bc8f521b8ca937c'),
('SIG004','ddd222a00ed9cf17','2400abdfe6793b7d244e411505ae545385231083e46a7806542649b8eec47b87')
on conflict(employee_code) do update set salt=excluded.salt,code_hash=excluded.code_hash,updated_at=now();

insert into public.admin_access_codes(admin_name,salt,code_hash,active) values
('Sanya Sachdeva','937e30481fa9342b','37b6014351673a87686a27853c296c5c31dc764771110be17648977bc6d3c20d',true),
('Naveen Kumar M','3e055927301a3291','8559a17859ce0f0ce6a26cc83c1e861d038ba1ba0c56cb93f16e530a808356bb',true),
('Simran Vyas','9d49f75e73fa556a','961f37ad94caf73e74ca24241745842b602cb4c0db88741ebcb337e655ef312e',true),
('ISHANT VARSHNEY','f2760464066b1a8b','b374b38461e3a1bd37497eafb14bc9d11235f8157a597729633f34b554c31af3',true),
('Saravanan Natarajan','85ca53f6f23fd3da','0ff62b21a946980acf6f86e17e05f16bde7ed6d8b76888487731e0b298da487d',true)
on conflict(admin_name) do update set salt=excluded.salt,code_hash=excluded.code_hash,active=excluded.active,updated_at=now();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where user_id=auth.uid() and role='admin' and active);
$$;
create or replace function public.current_member() returns public.team_members language sql stable security definer set search_path=public as $$
  select t from team_members t join profiles p on p.user_id=t.user_id where p.user_id=auth.uid() and p.active and t.active;
$$;
create or replace function public.verify_employee_access(p_employee_code text,p_access_code text) returns public.team_members language plpgsql stable security definer set search_path=public as $$
declare member team_members;
begin
  select t.* into member
  from team_members t
  join employee_access_codes c on c.employee_code=t.employee_code
  where t.employee_code=p_employee_code
    and t.active
    and encode(digest(c.salt||':'||upper(trim(coalesce(p_access_code,''))),'sha256'),'hex')=c.code_hash;
  if member.id is null then raise exception 'Invalid personal code'; end if;
  return member;
end $$;
create or replace function public.verify_admin_access(p_admin_name text,p_access_code text) returns text language plpgsql stable security definer set search_path=public as $$
declare verified_name text;
begin
  select admin_name into verified_name
  from admin_access_codes
  where admin_name=p_admin_name
    and active
    and encode(digest(salt||':'||upper(trim(coalesce(p_access_code,''))),'sha256'),'hex')=code_hash;
  if verified_name is null then raise exception 'Invalid admin code'; end if;
  return verified_name;
end $$;
create or replace function public.has_weekend_conflict(p_roster jsonb,p_code text,p_candidate date,p_excluded date default null) returns boolean language sql immutable as $$
  select exists(
    select 1 from jsonb_array_elements(p_roster->'assignments') item
    where (item->>'date')::date is distinct from p_excluded and (item->'assigned') ? p_code and (
      ((item->>'date')::date - case when extract(dow from (item->>'date')::date)=0 then 1 else 0 end) = (p_candidate - case when extract(dow from p_candidate)=0 then 1 else 0 end)
      or (extract(dow from (item->>'date')::date)=6 and extract(dow from p_candidate)=6 and abs((item->>'date')::date-p_candidate)=7)
    )
  );
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
  if not exists(select 1 from team_members where employee_code=p_employee_code and user_id is null and active) then raise exception 'That employee is already mapped or unavailable'; end if;
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
    select * into member from team_members where employee_code=req.employee_code and user_id is null and active for update;
    if member.id is null then raise exception 'That employee was already assigned'; end if;
    update team_members set user_id=req.user_id,full_name=req.full_name where id=member.id;
  end if;
  update identity_mapping_requests set status=case when p_approved then 'approved' else 'rejected' end,decided_at=now(),decided_by=auth.uid() where id=req.id;
  insert into audit_log(actor_id,actor_name,action,details,before_data,after_data)
  values(auth.uid(),(select full_name from team_members where user_id=auth.uid()),case when p_approved then 'IDENTITY_APPROVED' else 'IDENTITY_REJECTED' end,'Identity mapping decision',to_jsonb(req),jsonb_build_object('approved',p_approved,'employee_code',member.employee_code));
end $$;

create or replace function public.save_my_availability(p_employee_code text,p_month text,p_na_dates text[]) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; month_date date:=(p_month||'-01')::date; current_ist timestamp:=(now() at time zone 'Asia/Kolkata'); today_ist date:=current_ist::date; window_minute numeric; prior jsonb;
begin
  member:=current_member();
  if member.id is null or member.employee_code<>p_employee_code then raise exception 'Cannot save another employee account'; end if;
  window_minute:=((extract(day from current_ist)-1)*24*60)+(extract(hour from current_ist)*60)+extract(minute from current_ist);
  if window_minute < (((15-1)*24*60)+(11*60)) or window_minute >= (((28-1)*24*60)+(19*60)) or month_date<>date_trunc('month',today_ist+interval '1 month')::date then raise exception 'Submission window is closed'; end if;
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
declare member team_members; request_id uuid; request_type text:=coalesce(p_request->>'type','swap');
begin
  member:=current_member();
  if member.id is null or member.employee_code<>p_request->>'requester' then raise exception 'Requester does not match login'; end if;
  if not exists(select 1 from team_members colleague where colleague.employee_code=p_request->>'colleague' and colleague.active and colleague.coverage_group=member.coverage_group) then raise exception 'Swap and cover requests must stay within the same active roster group'; end if;
  if request_type not in ('swap','cover') then raise exception 'Unsupported request type'; end if;
  if request_type='swap' and nullif(p_request->>'toDate','') is null then raise exception 'Swap requires both dates'; end if;
  insert into swap_requests(id,requester_id,request_type,colleague_code,from_date,to_date,reason,status)
  values((p_request->>'id')::uuid,member.id,request_type,p_request->>'colleague',(p_request->>'fromDate')::date,nullif(p_request->>'toDate','')::date,p_request->>'reason','awaiting-colleague') returning id into request_id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,after_data)
  values(auth.uid(),member.employee_code,member.full_name,case when request_type='cover' then 'COVER_REQUESTED' else 'SWAP_REQUESTED' end,case when request_type='cover' then 'Cover request created' else 'Swap request created' end,p_request);
  return request_id;
end $$;
create or replace function public.decide_colleague_swap_request(p_request_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; req swap_requests; roster_row rosters; requester_code text; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; source_assigned jsonb; destination_assigned jsonb;
begin
  member:=current_member();
  select * into req from swap_requests where id=p_request_id and colleague_code=member.employee_code and status='awaiting-colleague' for update;
  if req.id is null then raise exception 'Colleague approval request not found'; end if;
  select employee_code into requester_code from team_members where id=req.requester_id;
  if not p_approved then
    update swap_requests set status='rejected',colleague_decided_at=now(),decided_at=now() where id=req.id;
    insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
    values(auth.uid(),member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_COLLEAGUE_REJECTED' else 'SWAP_COLLEAGUE_REJECTED' end,case when req.request_type='cover' then 'Colleague rejected cover request' else 'Colleague rejected swap request' end,to_jsonb(req),jsonb_build_object('approved',false));
    return;
  end if;
  select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
  if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster;
  select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
  if req.request_type='cover' then
    if not (source_assigned ? requester_code) then raise exception 'Requester is no longer assigned on source date'; end if;
    if source_assigned ? req.colleague_code then raise exception 'Employee already assigned on covered date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date) then raise exception 'Cover creates a weekend-spacing conflict'; end if;
  else
    select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
    if source_assigned ? req.colleague_code or destination_assigned ? requester_code then raise exception 'Employee already assigned on destination date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date,req.to_date) or has_weekend_conflict(roster_row.roster,requester_code,req.to_date,req.from_date) then raise exception 'Swap creates a weekend-spacing conflict'; end if;
  end if;
  for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
    assigned:=item->'assigned';
    if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
    if req.request_type='swap' and (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
    assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
  end loop;
  update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  update swap_requests set status='approved',colleague_decided_at=now(),decided_by=auth.uid(),decided_at=now() where id=req.id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_APPROVED' else 'SWAP_APPROVED' end,case when req.request_type='cover' then 'Colleague approved cover and roster updated' else 'Colleague approved swap and roster updated' end,prior,(select roster from rosters where roster_month=roster_row.roster_month));
end $$;
create or replace function public.revoke_swap_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; req swap_requests; roster_row rosters; requester_code text; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; source_assigned jsonb; destination_assigned jsonb;
begin
  member:=current_member(); select * into req from swap_requests where id=p_request_id and requester_id=member.id and status in ('awaiting-colleague','colleague-approved','approved') for update;
  if req.id is null then raise exception 'Revocable swap not found'; end if;
  if req.status='approved' then
    select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
    if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster; requester_code:=member.employee_code;
    select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
    if req.request_type='cover' then
      if not (source_assigned ? req.colleague_code) or source_assigned ? requester_code then raise exception 'Roster changed; approved cover cannot be safely reversed'; end if;
      if has_weekend_conflict(roster_row.roster,requester_code,req.from_date,req.from_date) then raise exception 'Reversal creates a weekend-spacing conflict'; end if;
    else
      select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
      if not (source_assigned ? req.colleague_code) or not (destination_assigned ? requester_code) or source_assigned ? requester_code or destination_assigned ? req.colleague_code then raise exception 'Roster changed; approved swap cannot be safely reversed'; end if;
      if has_weekend_conflict(roster_row.roster,requester_code,req.from_date,req.to_date) or has_weekend_conflict(roster_row.roster,req.colleague_code,req.to_date,req.from_date) then raise exception 'Reversal creates a weekend-spacing conflict'; end if;
    end if;
    for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
      assigned:=item->'assigned';
      if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
      if req.request_type='swap' and (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
      assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
    end loop;
    update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  end if;
  update swap_requests set status='revoked',decided_at=now() where id=req.id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_REVOKED' else 'SWAP_REVOKED' end,'Requester revoked '||req.status||' '||req.request_type,coalesce(prior,to_jsonb(req)),case when req.status='approved' then (select roster from rosters where roster_month=roster_row.roster_month) else jsonb_build_object('status','revoked') end);
end $$;
create or replace function public.decide_swap_request(p_request_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path=public as $$
declare admin_profile profiles; admin_member team_members; req swap_requests; roster_row rosters; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; requester_code text; source_assigned jsonb; destination_assigned jsonb;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  select * into admin_profile from profiles where user_id=auth.uid(); admin_member:=current_member();
  select * into req from swap_requests where id=p_request_id and status='colleague-approved' for update;
  if req.id is null then raise exception 'Pending request not found'; end if;
  select employee_code into requester_code from team_members where id=req.requester_id;
  if not p_approved then
    update swap_requests set status='rejected',decided_by=auth.uid(),decided_at=now() where id=req.id;
    insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data) values(auth.uid(),admin_member.employee_code,admin_member.full_name,case when req.request_type='cover' then 'COVER_REJECTED' else 'SWAP_REJECTED' end,case when req.request_type='cover' then 'Cover rejected' else 'Swap rejected' end,to_jsonb(req)); return;
  end if;
  select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
  if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster;
  select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
  if req.request_type='cover' then
    if not (source_assigned ? requester_code) then raise exception 'Requester is no longer assigned on source date'; end if;
    if source_assigned ? req.colleague_code then raise exception 'Employee already assigned on covered date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date) then raise exception 'Cover creates a weekend-spacing conflict'; end if;
  else
    select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
    if source_assigned ? req.colleague_code or destination_assigned ? requester_code then raise exception 'Employee already assigned on destination date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date,req.to_date) or has_weekend_conflict(roster_row.roster,requester_code,req.to_date,req.from_date) then raise exception 'Swap creates a weekend-spacing conflict'; end if;
  end if;
  for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
    assigned:=item->'assigned';
    if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
    if req.request_type='swap' and (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
    assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
  end loop;
  update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  update swap_requests set status='approved',decided_by=auth.uid(),decided_at=now() where id=req.id;
  insert into audit_log(actor_id,actor_code,actor_name,action,details,before_data,after_data)
  values(auth.uid(),admin_member.employee_code,admin_member.full_name,case when req.request_type='cover' then 'COVER_APPROVED' else 'SWAP_APPROVED' end,case when req.request_type='cover' then 'Approved cover '||req.id else 'Approved swap '||req.id end,prior,(select roster from rosters where roster_month=roster_row.roster_month));
end $$;

create or replace function public.get_roster_state() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:=jsonb_build_object('version',3,'availability','{}'::jsonb,'submissions','{}'::jsonb,'rosters','{}'::jsonb,'swapRequests','[]'::jsonb,'audit','[]'::jsonb,'team','[]'::jsonb); member team_members; row_data record;
begin
  member:=current_member(); if member.id is null then raise exception 'Approved account required'; end if;
  result:=jsonb_set(result,'{team}',coalesce((select jsonb_agg(jsonb_build_object('employee_code',employee_code,'full_name',full_name) order by employee_code) from team_members where active and full_name is not null),'[]'));
  result:=jsonb_set(result,'{availability}',coalesce((select jsonb_object_agg(employee_code,months) from (select employee_code,jsonb_object_agg(month_key,dates) months from (select t.employee_code,to_char(a.roster_month,'YYYY-MM') month_key,jsonb_object_agg(a.na_date::text,true order by a.na_date) dates from availability a join team_members t on t.id=a.employee_id where a.employee_id=member.id or is_admin() group by t.employee_code,a.roster_month) by_month group by employee_code) by_employee),'{}'::jsonb));
  result:=jsonb_set(result,'{submissions}',coalesce((select jsonb_object_agg(employee_code,months) from (select employee_code,jsonb_object_agg(month_key,jsonb_build_object('savedAt',saved_at)) months from (select t.employee_code,to_char(s.roster_month,'YYYY-MM') month_key,s.saved_at from submissions s join team_members t on t.id=s.employee_id where s.employee_id=member.id or is_admin()) by_month group by employee_code) by_employee),'{}'::jsonb));
  for row_data in select roster_month,roster from rosters where status in('published','finalized') or is_admin() loop result:=jsonb_set(result,array['rosters',to_char(row_data.roster_month,'YYYY-MM')],row_data.roster,true); end loop;
  result:=jsonb_set(result,'{swapRequests}',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'type',s.request_type,'requester',t.employee_code,'colleague',s.colleague_code,'fromDate',s.from_date,'toDate',s.to_date,'reason',s.reason,'status',s.status,'createdAt',s.created_at)) from swap_requests s join team_members t on t.id=s.requester_id where s.requester_id=member.id or s.colleague_code=member.employee_code or is_admin()),'[]'));
  if is_admin() then result:=jsonb_set(result,'{audit}',coalesce((select jsonb_agg(jsonb_build_object('id',id,'at',occurred_at,'actor',coalesce(actor_name,actor_code),'action',action,'details',details,'before',before_data,'after',after_data) order by occurred_at) from audit_log),'[]')); end if;
  return result;
end $$;

create or replace function public.open_get_roster_state() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:=jsonb_build_object('version',3,'availability','{}'::jsonb,'submissions','{}'::jsonb,'rosters','{}'::jsonb,'swapRequests','[]'::jsonb,'audit','[]'::jsonb,'team','[]'::jsonb); row_data record;
begin
  result:=jsonb_set(result,'{team}',coalesce((select jsonb_agg(jsonb_build_object('employee_code',employee_code,'full_name',full_name,'coverage_group',coverage_group) order by employee_code) from team_members where active and full_name is not null),'[]'));
  result:=jsonb_set(result,'{availability}',coalesce((select jsonb_object_agg(employee_code,months) from (select employee_code,jsonb_object_agg(month_key,dates) months from (select t.employee_code,to_char(a.roster_month,'YYYY-MM') month_key,jsonb_object_agg(a.na_date::text,true order by a.na_date) dates from availability a join team_members t on t.id=a.employee_id where t.active group by t.employee_code,a.roster_month) by_month group by employee_code) by_employee),'{}'::jsonb));
  result:=jsonb_set(result,'{submissions}',coalesce((select jsonb_object_agg(employee_code,months) from (select employee_code,jsonb_object_agg(month_key,jsonb_build_object('savedAt',saved_at)) months from (select t.employee_code,to_char(s.roster_month,'YYYY-MM') month_key,s.saved_at from submissions s join team_members t on t.id=s.employee_id where t.active) by_month group by employee_code) by_employee),'{}'::jsonb));
  for row_data in select roster_month,roster from rosters where status in('draft','needs-review','published','finalized') loop result:=jsonb_set(result,array['rosters',to_char(row_data.roster_month,'YYYY-MM')],roster,true); end loop;
  result:=jsonb_set(result,'{swapRequests}',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'type',s.request_type,'requester',t.employee_code,'colleague',s.colleague_code,'fromDate',s.from_date,'toDate',s.to_date,'reason',s.reason,'status',s.status,'createdAt',s.created_at)) from swap_requests s join team_members t on t.id=s.requester_id where t.active),'[]'));
  result:=jsonb_set(result,'{audit}',coalesce((select jsonb_agg(jsonb_build_object('id',id,'at',occurred_at,'actor',coalesce(actor_name,actor_code),'action',action,'details',details) order by occurred_at) from audit_log),'[]'));
  return result;
end $$;

drop function if exists public.open_save_availability(text,text,text[]);
create or replace function public.open_save_availability(p_employee_code text,p_access_code text,p_month text,p_na_dates text[]) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; month_date date:=(p_month||'-01')::date; current_ist timestamp:=(now() at time zone 'Asia/Kolkata'); today_ist date:=current_ist::date; window_minute numeric; prior jsonb;
begin
  member:=verify_employee_access(p_employee_code,p_access_code);
  window_minute:=((extract(day from current_ist)-1)*24*60)+(extract(hour from current_ist)*60)+extract(minute from current_ist);
  if window_minute < (((15-1)*24*60)+(11*60)) or window_minute >= (((28-1)*24*60)+(19*60)) or month_date<>date_trunc('month',today_ist+interval '1 month')::date then raise exception 'Submission window is closed'; end if;
  if exists(select 1 from unnest(p_na_dates)x where extract(isodow from x::date) not in (6,7) or x::date < month_date or x::date >= month_date + interval '1 month') then raise exception 'Only weekend dates in the roster month are allowed'; end if;
  select coalesce(jsonb_agg(na_date order by na_date),'[]') into prior from availability where employee_id=member.id and roster_month=month_date;
  delete from availability where employee_id=member.id and roster_month=month_date;
  insert into availability(employee_id,roster_month,na_date) select member.id,month_date,x::date from unnest(p_na_dates)x;
  insert into submissions(employee_id,roster_month) values(member.id,month_date) on conflict(employee_id,roster_month) do update set saved_at=now();
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(member.employee_code,member.full_name,'AVAILABILITY_SAVED','Availability saved for '||p_month,prior,to_jsonb(p_na_dates));
end $$;

drop function if exists public.open_save_roster(text,jsonb,text);
create or replace function public.open_save_roster(p_month text,p_roster jsonb,p_actor_name text,p_access_code text) returns void language plpgsql security definer set search_path=public as $$
declare month_date date:=(p_month||'-01')::date; prior jsonb; current_ist timestamp:=(now() at time zone 'Asia/Kolkata'); today_ist date:=current_ist::date; window_minute numeric; automatic_actor boolean;
begin
  p_actor_name:=coalesce(nullif(trim(p_actor_name),''),'Roster admin');
  automatic_actor:=p_actor_name='Automatic cutoff scheduler';
  if automatic_actor then
    window_minute:=((extract(day from current_ist)-1)*24*60)+(extract(hour from current_ist)*60)+extract(minute from current_ist);
    if window_minute < (((28-1)*24*60)+(19*60)) or month_date<>date_trunc('month',today_ist+interval '1 month')::date then raise exception 'Automatic roster save is not available before cutoff'; end if;
    if exists(select 1 from rosters where roster_month=month_date) then raise exception 'Roster already exists for this month'; end if;
  else
    p_actor_name:=verify_admin_access(p_actor_name,p_access_code);
  end if;
  select roster into prior from rosters where roster_month=month_date;
  insert into rosters(roster_month,status,roster) values(month_date,coalesce(p_roster->>'status','draft'),p_roster)
  on conflict(roster_month) do update set status=excluded.status,roster=excluded.roster,generated_at=now();
  insert into audit_log(actor_name,action,details,before_data,after_data)
  values(nullif(trim(p_actor_name),''),'ROSTER_SAVED','Roster saved for '||p_month,prior,p_roster);
end $$;

drop function if exists public.open_finalize_roster(text,text);
create or replace function public.open_finalize_roster(p_month text,p_actor_name text,p_access_code text) returns void language plpgsql security definer set search_path=public as $$
declare month_date date:=(p_month||'-01')::date; prior jsonb;
begin
  p_actor_name:=verify_admin_access(p_actor_name,p_access_code);
  select roster into prior from rosters where roster_month=month_date for update;
  if prior is null then raise exception 'Roster not found'; end if;
  update rosters set status='finalized',finalized_at=now(),roster=jsonb_set(jsonb_set(roster,'{status}','"finalized"'),'{finalizedAt}',to_jsonb(now())) where roster_month=month_date;
  insert into audit_log(actor_name,action,details,before_data,after_data)
  values(nullif(trim(p_actor_name),''),'ROSTER_FINALIZED','Finalized '||p_month,prior,(select roster from rosters where roster_month=month_date));
end $$;

drop function if exists public.open_create_swap_request(jsonb);
create or replace function public.open_create_swap_request(p_request jsonb,p_access_code text) returns uuid language plpgsql security definer set search_path=public as $$
declare member team_members; request_id uuid; request_type text:=coalesce(p_request->>'type','swap');
begin
  member:=verify_employee_access(p_request->>'requester',p_access_code);
  if not exists(select 1 from team_members colleague where colleague.employee_code=p_request->>'colleague' and colleague.active and colleague.coverage_group=member.coverage_group) then raise exception 'Swap and cover requests must stay within the same active roster group'; end if;
  if request_type not in ('swap','cover') then raise exception 'Unsupported request type'; end if;
  if request_type='swap' and nullif(p_request->>'toDate','') is null then raise exception 'Swap requires both dates'; end if;
  insert into swap_requests(id,requester_id,request_type,colleague_code,from_date,to_date,reason,status)
  values((p_request->>'id')::uuid,member.id,request_type,p_request->>'colleague',(p_request->>'fromDate')::date,nullif(p_request->>'toDate','')::date,p_request->>'reason','awaiting-colleague') returning id into request_id;
  insert into audit_log(actor_code,actor_name,action,details,after_data)
  values(member.employee_code,member.full_name,case when request_type='cover' then 'COVER_REQUESTED' else 'SWAP_REQUESTED' end,case when request_type='cover' then 'Cover request created' else 'Swap request created' end,p_request);
  return request_id;
end $$;

drop function if exists public.open_decide_colleague_swap_request(uuid,text,boolean);
create or replace function public.open_decide_colleague_swap_request(p_request_id uuid,p_colleague_code text,p_access_code text,p_approved boolean) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; req swap_requests; roster_row rosters; requester_code text; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; source_assigned jsonb; destination_assigned jsonb;
begin
  member:=verify_employee_access(p_colleague_code,p_access_code);
  select * into req from swap_requests where id=p_request_id and colleague_code=member.employee_code and status='awaiting-colleague' for update;
  if req.id is null then raise exception 'Colleague approval request not found'; end if;
  select employee_code into requester_code from team_members where id=req.requester_id;
  if not p_approved then
    update swap_requests set status='rejected',colleague_decided_at=now(),decided_at=now() where id=req.id;
    insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
    values(member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_COLLEAGUE_REJECTED' else 'SWAP_COLLEAGUE_REJECTED' end,case when req.request_type='cover' then 'Colleague rejected cover request' else 'Colleague rejected swap request' end,to_jsonb(req),jsonb_build_object('approved',false));
    return;
  end if;
  select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
  if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster;
  select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
  if req.request_type='cover' then
    if not (source_assigned ? requester_code) then raise exception 'Requester is no longer assigned on source date'; end if;
    if source_assigned ? req.colleague_code then raise exception 'Employee already assigned on covered date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date) then raise exception 'Cover creates a weekend-spacing conflict'; end if;
  else
    select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
    if source_assigned ? req.colleague_code or destination_assigned ? requester_code then raise exception 'Employee already assigned on destination date'; end if;
    if has_weekend_conflict(roster_row.roster,req.colleague_code,req.from_date,req.to_date) or has_weekend_conflict(roster_row.roster,requester_code,req.to_date,req.from_date) then raise exception 'Swap creates a weekend-spacing conflict'; end if;
  end if;
  for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
    assigned:=item->'assigned';
    if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=requester_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
    if req.request_type='swap' and (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(requester_code) else value end) from jsonb_array_elements(assigned)); end if;
    assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
  end loop;
  update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  update swap_requests set status='approved',colleague_decided_at=now(),decided_by=null,decided_at=now() where id=req.id;
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_APPROVED' else 'SWAP_APPROVED' end,case when req.request_type='cover' then 'Colleague approved cover and roster updated' else 'Colleague approved swap and roster updated' end,prior,(select roster from rosters where roster_month=roster_row.roster_month));
end $$;

drop function if exists public.open_revoke_swap_request(uuid,text);
create or replace function public.open_revoke_swap_request(p_request_id uuid,p_requester_code text,p_access_code text) returns void language plpgsql security definer set search_path=public as $$
declare member team_members; req swap_requests; roster_row rosters; prior jsonb; assignments jsonb:='[]'; item jsonb; assigned jsonb; source_assigned jsonb; destination_assigned jsonb;
begin
  member:=verify_employee_access(p_requester_code,p_access_code);
  select * into req from swap_requests where id=p_request_id and requester_id=member.id and status in ('awaiting-colleague','colleague-approved','approved') for update;
  if req.id is null then raise exception 'Revocable swap not found'; end if;
  if req.status='approved' then
    select * into roster_row from rosters where roster_month=date_trunc('month',req.from_date)::date for update;
    if roster_row.roster_month is null then raise exception 'Roster not found'; end if; prior:=roster_row.roster;
    select value->'assigned' into source_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.from_date::text;
    if req.request_type='cover' then
      if not (source_assigned ? req.colleague_code) or source_assigned ? member.employee_code then raise exception 'Roster changed; approved cover cannot be safely reversed'; end if;
      if has_weekend_conflict(roster_row.roster,member.employee_code,req.from_date,req.from_date) then raise exception 'Reversal creates a weekend-spacing conflict'; end if;
    else
      select value->'assigned' into destination_assigned from jsonb_array_elements(roster_row.roster->'assignments') where value->>'date'=req.to_date::text;
      if not (source_assigned ? req.colleague_code) or not (destination_assigned ? member.employee_code) or source_assigned ? member.employee_code or destination_assigned ? req.colleague_code then raise exception 'Roster changed; approved swap cannot be safely reversed'; end if;
      if has_weekend_conflict(roster_row.roster,member.employee_code,req.from_date,req.to_date) or has_weekend_conflict(roster_row.roster,req.colleague_code,req.to_date,req.from_date) then raise exception 'Reversal creates a weekend-spacing conflict'; end if;
    end if;
    for item in select * from jsonb_array_elements(roster_row.roster->'assignments') loop
      assigned:=item->'assigned';
      if (item->>'date')::date=req.from_date then assigned:=(select jsonb_agg(case when value#>>'{}'=req.colleague_code then to_jsonb(member.employee_code) else value end) from jsonb_array_elements(assigned)); end if;
      if req.request_type='swap' and (item->>'date')::date=req.to_date then assigned:=(select jsonb_agg(case when value#>>'{}'=member.employee_code then to_jsonb(req.colleague_code) else value end) from jsonb_array_elements(assigned)); end if;
      assignments:=assignments||jsonb_build_array(jsonb_set(item,'{assigned}',assigned));
    end loop;
    update rosters set roster=jsonb_set(roster,'{assignments}',assignments) where roster_month=roster_row.roster_month;
  end if;
  update swap_requests set status='revoked',decided_at=now() where id=req.id;
  insert into audit_log(actor_code,actor_name,action,details,before_data,after_data)
  values(member.employee_code,member.full_name,case when req.request_type='cover' then 'COVER_REVOKED' else 'SWAP_REVOKED' end,'Requester revoked '||req.status||' '||req.request_type,coalesce(prior,to_jsonb(req)),case when req.status='approved' then (select roster from rosters where roster_month=roster_row.roster_month) else jsonb_build_object('status','revoked') end);
end $$;

alter table profiles enable row level security; alter table team_members enable row level security; alter table identity_mapping_requests enable row level security;
alter table availability enable row level security; alter table submissions enable row level security; alter table rosters enable row level security;
alter table swap_requests enable row level security; alter table audit_log enable row level security; alter table employee_access_codes enable row level security; alter table admin_access_codes enable row level security;
revoke all on all tables in schema public from anon,authenticated;
grant execute on function my_profile(),request_identity_mapping(text,text),get_mapping_requests(),decide_identity_mapping(uuid,boolean),get_roster_state(),save_my_availability(text,text,text[]),save_roster(text,jsonb),finalize_roster(text),create_swap_request(jsonb),decide_colleague_swap_request(uuid,boolean),revoke_swap_request(uuid),decide_swap_request(uuid,boolean) to authenticated;
grant execute on function open_get_roster_state(),open_save_availability(text,text,text,text[]),open_save_roster(text,jsonb,text,text),open_finalize_roster(text,text,text),open_create_swap_request(jsonb,text),open_decide_colleague_swap_request(uuid,text,text,boolean),open_revoke_swap_request(uuid,text,text) to anon,authenticated;

-- Bootstrap the first administrator after their first Google login using the auth user UUID:
-- update profiles set role='admin' where user_id='<auth-user-uuid>';
-- update team_members set user_id='<auth-user-uuid>', full_name='<admin-name>' where employee_code='EMP001';
