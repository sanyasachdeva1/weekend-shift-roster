create or replace function public.open_get_roster_state() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  result jsonb:=jsonb_build_object(
    'version',3,
    'availability','{}'::jsonb,
    'submissions','{}'::jsonb,
    'rosters','{}'::jsonb,
    'swapRequests','[]'::jsonb,
    'audit','[]'::jsonb,
    'team','[]'::jsonb
  );
  row_data record;
begin
  result:=jsonb_set(result,'{team}',coalesce((
    select jsonb_agg(jsonb_build_object('employee_code',employee_code,'full_name',full_name,'coverage_group',coverage_group) order by employee_code)
    from team_members
    where active and full_name is not null
  ),'[]'));
  result:=jsonb_set(result,'{availability}',coalesce((
    select jsonb_object_agg(employee_code,months)
    from (
      select employee_code,jsonb_object_agg(month_key,dates) months
      from (
        select t.employee_code,to_char(a.roster_month,'YYYY-MM') month_key,jsonb_object_agg(a.na_date::text,true order by a.na_date) dates
        from availability a
        join team_members t on t.id=a.employee_id
        where t.active
        group by t.employee_code,a.roster_month
      ) by_month
      group by employee_code
    ) by_employee
  ),'{}'::jsonb));
  result:=jsonb_set(result,'{submissions}',coalesce((
    select jsonb_object_agg(employee_code,months)
    from (
      select employee_code,jsonb_object_agg(month_key,jsonb_build_object('savedAt',saved_at)) months
      from (
        select t.employee_code,to_char(s.roster_month,'YYYY-MM') month_key,s.saved_at
        from submissions s
        join team_members t on t.id=s.employee_id
        where t.active
      ) by_month
      group by employee_code
    ) by_employee
  ),'{}'::jsonb));
  for row_data in select roster_month,roster from rosters where status in('draft','needs-review','published','finalized') loop
    result:=jsonb_set(result,array['rosters',to_char(row_data.roster_month,'YYYY-MM')],row_data.roster,true);
  end loop;
  result:=jsonb_set(result,'{swapRequests}',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'type',s.request_type,'requester',t.employee_code,'colleague',s.colleague_code,'fromDate',s.from_date,'toDate',s.to_date,'reason',s.reason,'status',s.status,'createdAt',s.created_at))
    from swap_requests s
    join team_members t on t.id=s.requester_id
    where t.active
  ),'[]'));
  result:=jsonb_set(result,'{audit}',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'at',occurred_at,'actor',coalesce(actor_name,actor_code),'action',action,'details',details) order by occurred_at)
    from audit_log
  ),'[]'));
  return result;
end $$;

grant execute on function public.open_get_roster_state() to anon, authenticated;
