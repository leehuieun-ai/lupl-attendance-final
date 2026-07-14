-- 직원 팀 일정 화면용 읽기 전용 스냅샷
-- Supabase SQL Editor에서 1회 실행하세요.

create or replace function public.team_schedule_snapshot()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select case
    when public.current_employee_id() is null then jsonb_build_object(
      'employees', '[]'::jsonb,
      'weekly_schedule_overrides', '[]'::jsonb,
      'work_time_change_requests', '[]'::jsonb,
      'employee_absences', '[]'::jsonb,
      'employee_schedule_events', '[]'::jsonb,
      'attendance_requests', '[]'::jsonb,
      'comp_time_requests', '[]'::jsonb
    )
    else jsonb_build_object(
      'employees', coalesce((
        select jsonb_agg(to_jsonb(e) order by e.employee_no)
        from (
          select
            id, employee_no, name, joined_at, employment_status, is_active,
            work_start_date, work_days, work_start, work_end, schedule_title, schedule_note,
            contract_type, contract_start, contract_end, department, position,
            weekly_work_days, daily_work_hours, monthly_standard_hours
          from public.employees
          where is_active = true and employment_status = 'active'
        ) e
      ), '[]'::jsonb),
      'weekly_schedule_overrides', coalesce((
        select jsonb_agg(to_jsonb(o) - 'note' - 'created_by' order by o.week_start desc)
        from public.weekly_schedule_overrides o
        where exists (
          select 1 from public.employees e
          where e.id = o.employee_id and e.is_active = true and e.employment_status = 'active'
        )
      ), '[]'::jsonb),
      'work_time_change_requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'employee_id', w.employee_id,
          'old_work_days', w.old_work_days,
          'old_work_start', w.old_work_start,
          'old_work_end', w.old_work_end,
          'old_break_start', w.old_break_start,
          'old_break_end', w.old_break_end,
          'new_work_days', w.new_work_days,
          'new_work_start', w.new_work_start,
          'new_work_end', w.new_work_end,
          'new_break_start', w.new_break_start,
          'new_break_end', w.new_break_end,
          'periods', w.periods,
          'status', w.status,
          'created_at', w.created_at
        ) order by w.created_at desc)
        from public.work_time_change_requests w
        where w.status = 'approved'
          and exists (
            select 1 from public.employees e
            where e.id = w.employee_id and e.is_active = true and e.employment_status = 'active'
          )
      ), '[]'::jsonb),
      'employee_absences', '[]'::jsonb,
      'employee_schedule_events', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.start_date asc)
        from public.employee_schedule_events s
        where exists (
          select 1 from public.employees e
          where e.id = s.employee_id and e.is_active = true and e.employment_status = 'active'
        )
      ), '[]'::jsonb),
      'attendance_requests', coalesce((
        select jsonb_agg(to_jsonb(r) - 'reason' - 'review_note' order by r.start_date asc)
        from public.attendance_requests r
        where r.status = 'approved'
          and exists (
            select 1 from public.employees e
            where e.id = r.employee_id and e.is_active = true and e.employment_status = 'active'
          )
      ), '[]'::jsonb),
      'comp_time_requests', coalesce((
        select jsonb_agg(to_jsonb(c) - 'reason' - 'review_note' order by c.work_date asc)
        from public.comp_time_requests c
        where c.status in ('pending','approved')
          and exists (
            select 1 from public.employees e
            where e.id = c.employee_id and e.is_active = true and e.employment_status = 'active'
          )
      ), '[]'::jsonb)
    )
  end;
$$;

grant execute on function public.team_schedule_snapshot() to authenticated;
