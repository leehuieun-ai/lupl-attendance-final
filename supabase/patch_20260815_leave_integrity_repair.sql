-- 2026-08-15 leave integrity repair
-- Supabase SQL Editor에서 1회 실행하세요. 반복 실행해도 같은 결과가 되도록 작성했습니다.

-- 1) 승인된 연차/반차/시간차/휴가 신청 중 amount_days 또는 amount_hours가 비어 있는 과거 데이터 보정
with normalized_leave as (
  select
    ar.id,
    ar.request_type,
    ar.amount_days,
    ar.amount_hours,
    greatest(ar.start_date, coalesce(e.contract_start, e.work_start_date, e.joined_at, ar.start_date)) as bounded_start,
    least(ar.end_date, coalesce(e.contract_end, ar.end_date)) as bounded_end
  from public.attendance_requests ar
  join public.employees e on e.id = ar.employee_id
  where ar.status = 'approved'
    and ar.request_type in ('annual','half_am','half_pm','hourly','special','substitute','compensatory','comp_leave_use')
), calculated_leave as (
  select
    id,
    request_type,
    case
      when request_type in ('half_am','half_pm') then 0.5::numeric
      when request_type in ('hourly','comp_leave_use') then coalesce(nullif(amount_hours,0) / 8, nullif(amount_days,0), 0)::numeric
      when bounded_start > bounded_end then 0::numeric
      else greatest(0, (
        select count(*)::numeric
        from generate_series(bounded_start, bounded_end, interval '1 day') as d(day)
        where extract(isodow from d.day) < 6
      ))
    end as fixed_days,
    case
      when request_type in ('half_am','half_pm') then 4::numeric
      when request_type in ('hourly','comp_leave_use') then coalesce(nullif(amount_hours,0), nullif(amount_days,0) * 8, 0)::numeric
      else null::numeric
    end as fixed_hours
  from normalized_leave
)
update public.attendance_requests ar
set amount_days = case
      when ar.amount_days is null or ar.amount_days <= 0 then c.fixed_days
      else ar.amount_days
    end,
    amount_hours = case
      when c.fixed_hours is not null and (ar.amount_hours is null or ar.amount_hours <= 0) then c.fixed_hours
      else ar.amount_hours
    end
from calculated_leave c
where ar.id = c.id
  and (
    ar.amount_days is null
    or ar.amount_days <= 0
    or (c.fixed_hours is not null and (ar.amount_hours is null or ar.amount_hours <= 0))
  );

-- 2) 승인된 추가근무인데 대체휴가 적립 기록이 없는 경우 보정
insert into public.leave_adjustments(
  employee_id,
  adjustment_type,
  adjustment_days,
  source_type,
  source_id,
  reason,
  created_by
)
select
  c.employee_id,
  'comp_time_earned',
  c.converted_days,
  'comp_time_requests',
  c.id,
  coalesce(c.reason, '추가근무 대체휴가 적립 자동 보정'),
  c.reviewed_by
from public.comp_time_requests c
where c.status = 'approved'
  and coalesce(c.converted_days, 0) > 0
  and not exists (
    select 1
    from public.leave_adjustments a
    where a.source_type = 'comp_time_requests'
      and a.source_id = c.id
      and a.adjustment_type = 'comp_time_earned'
  );

-- 3) 반려된 추가근무인데 적립 기록이 남아 있는 경우 제거
delete from public.leave_adjustments a
using public.comp_time_requests c
where a.source_type = 'comp_time_requests'
  and a.source_id = c.id
  and a.adjustment_type = 'comp_time_earned'
  and c.status = 'rejected';

-- 4) leave_adjustments는 있는데 원본 추가근무/휴가 신청이 없는 경우 제거
delete from public.leave_adjustments a
where a.source_type = 'comp_time_requests'
  and not exists (
    select 1
    from public.comp_time_requests c
    where c.id = a.source_id
  );

delete from public.leave_adjustments a
where a.source_type = 'attendance_requests'
  and not exists (
    select 1
    from public.attendance_requests r
    where r.id = a.source_id
  );

-- 5) 승인된 휴가인데 직원 근무 일정에는 휴가/근무 안 함으로 반영되지 않는 경우 보정
with approved_leave as (
  select
    ar.id,
    ar.employee_id,
    ar.request_type,
    greatest(ar.start_date, coalesce(e.contract_start, e.work_start_date, e.joined_at, ar.start_date)) as start_date,
    least(ar.end_date, coalesce(e.contract_end, ar.end_date)) as end_date,
    ar.reviewed_by
  from public.attendance_requests ar
  join public.employees e on e.id = ar.employee_id
  where ar.status = 'approved'
    and ar.request_type in ('annual','half_am','half_pm','hourly','sick','official','special','substitute','compensatory','comp_leave_use')
), schedule_rows as (
  select *
  from approved_leave
  where start_date <= end_date
)
insert into public.employee_schedule_events(
  employee_id,
  title,
  event_type,
  start_date,
  end_date,
  note,
  created_by
)
select
  s.employee_id,
  case s.request_type
    when 'annual' then '승인 휴가: 연차'
    when 'half_am' then '승인 휴가: 오전 반차'
    when 'half_pm' then '승인 휴가: 오후 반차'
    when 'hourly' then '승인 휴가: 시간차'
    when 'comp_leave_use' then '승인 휴가: 보상휴가'
    else '승인 휴가'
  end,
  'unavailable',
  s.start_date,
  s.end_date,
  'attendance_requests 승인 내역 기준 자동 보정',
  s.reviewed_by
from schedule_rows s
where not exists (
  select 1
  from public.employee_schedule_events ev
  where ev.employee_id = s.employee_id
    and ev.event_type = 'unavailable'
    and ev.start_date = s.start_date
    and ev.end_date = s.end_date
);

-- 6) 보정 후 남은 의심 건수 확인
select 'approved_leave_missing_amount' as check_name, count(*)::int as remaining_count
from public.attendance_requests
where status = 'approved'
  and request_type in ('annual','half_am','half_pm','hourly','special','substitute','compensatory','comp_leave_use')
  and (amount_days is null or amount_days <= 0)
union all
select 'approved_comp_without_adjustment', count(*)::int
from public.comp_time_requests c
where c.status = 'approved'
  and coalesce(c.converted_days, 0) > 0
  and not exists (
    select 1 from public.leave_adjustments a
    where a.source_type = 'comp_time_requests'
      and a.source_id = c.id
      and a.adjustment_type = 'comp_time_earned'
  )
union all
select 'rejected_comp_with_adjustment', count(*)::int
from public.leave_adjustments a
join public.comp_time_requests c on c.id = a.source_id
where a.source_type = 'comp_time_requests'
  and a.adjustment_type = 'comp_time_earned'
  and c.status = 'rejected'
union all
select 'orphan_comp_adjustment', count(*)::int
from public.leave_adjustments a
where a.source_type = 'comp_time_requests'
  and not exists (select 1 from public.comp_time_requests c where c.id = a.source_id)
union all
select 'approved_leave_without_schedule_event', count(*)::int
from public.attendance_requests ar
where ar.status = 'approved'
  and ar.request_type in ('annual','half_am','half_pm','hourly','sick','official','special','substitute','compensatory','comp_leave_use')
  and not exists (
    select 1
    from public.employee_schedule_events ev
    where ev.employee_id = ar.employee_id
      and ev.event_type = 'unavailable'
      and ev.start_date <= ar.end_date
      and ev.end_date >= ar.start_date
  );
