-- 2026-06-15 안정화 패치
-- 기존 DB에는 이 파일을 Supabase SQL Editor에서 1회 실행하세요.

alter table public.employees add column if not exists monthly_salary numeric(12,0) not null default 0;
alter table public.employees add column if not exists work_days text[] not null default array['mon','tue','wed','thu','fri'];
alter table public.employees add column if not exists work_start time not null default '09:00';
alter table public.employees add column if not exists work_end time not null default '18:00';
alter table public.employees add column if not exists contract_type text not null default 'daily';
alter table public.employees add column if not exists contract_start date;
alter table public.employees add column if not exists contract_end date;

create table if not exists public.weekly_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_start date not null,
  work_days text[] not null default array['mon','tue','wed','thu','fri'],
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  note text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, week_start)
);

create table if not exists public.employee_absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  unpaid boolean not null default false,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now()
);

alter table public.weekly_schedule_overrides enable row level security;
alter table public.employee_absences enable row level security;

drop policy if exists weekly_schedule_overrides_admin_all on public.weekly_schedule_overrides;
create policy weekly_schedule_overrides_admin_all on public.weekly_schedule_overrides
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists employee_absences_admin_all on public.employee_absences;
create policy employee_absences_admin_all on public.employee_absences
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists comp_delete_pending_self on public.comp_time_requests;
create policy comp_delete_pending_self on public.comp_time_requests
for delete to authenticated using (employee_id = public.current_employee_id() and status = 'pending');

create or replace function public.recheck_in(
  p_log_id uuid,
  p_workplace_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_ip_address text,
  p_device_fingerprint_hash text,
  p_device_info jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee public.employees%rowtype;
  v_log public.attendance_logs%rowtype;
  v_workplace public.workplaces%rowtype;
  v_device jsonb;
  v_device_status text;
  v_distance double precision;
  v_status text;
begin
  select * into v_employee
  from public.employees
  where user_id = auth.uid() and is_active = true and employment_status = 'active';
  if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if;

  select * into v_log
  from public.attendance_logs
  where id = p_log_id and employee_id = v_employee.id;
  if not found then raise exception '재출근 처리할 출근 기록이 없습니다.'; end if;

  if (v_log.check_in_time at time zone 'Asia/Seoul')::date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception '당일 출근 기록만 재출근 처리할 수 있습니다.';
  end if;

  select * into v_workplace from public.workplaces where id = p_workplace_id;
  if not found then raise exception '근무지를 찾을 수 없습니다.'; end if;

  v_device := public.register_device(p_device_fingerprint_hash, p_device_info);
  v_device_status := v_device->>'device_status';
  v_distance := public.calculate_distance_m(p_lat, p_lng, v_workplace.lat, v_workplace.lng);

  if v_workplace.type = 'remote' then
    v_status := '재택';
  elsif v_workplace.approval_status <> 'approved' or v_workplace.is_active <> true then
    v_status := '관리자 확인 필요';
  elsif v_device_status <> 'approved' then
    v_status := '기기 확인 필요';
  elsif p_accuracy_m is not null and p_accuracy_m > 200 then
    v_status := '위치 정확도 낮음';
  elsif v_distance is null then
    v_status := '위치 확인 필요';
  elsif v_distance <= v_workplace.radius_m then
    if v_workplace.type in ('special_school','external_education','other_field') then
      v_status := '외근';
    else
      v_status := '정상출근';
    end if;
  else
    v_status := '위치 확인 필요';
  end if;

  update public.attendance_logs
  set workplace_id = v_workplace.id,
      check_in_time = now(),
      check_out_time = null,
      check_in_lat = p_lat,
      check_in_lng = p_lng,
      check_in_accuracy_m = p_accuracy_m,
      check_in_distance_m = v_distance,
      check_in_ip = p_ip_address,
      check_out_lat = null,
      check_out_lng = null,
      check_out_accuracy_m = null,
      check_out_distance_m = null,
      check_out_ip = null,
      device_fingerprint_hash = p_device_fingerprint_hash,
      device_status = v_device_status,
      status = v_status,
      updated_at = now()
  where id = v_log.id
  returning * into v_log;

  update public.workplaces set visit_count = visit_count + 1, last_used_at = now() where id = v_workplace.id;
  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, after_data)
  values(v_employee.id, 'recheck_in', 'attendance_logs', v_log.id, to_jsonb(v_log));

  return jsonb_build_object('attendance_log_id', v_log.id, 'attendance_status', v_status, 'device_status', v_device_status, 'distance_m', v_distance);
end;
$$;

create or replace function public.close_attendance_log(
  p_log_id uuid,
  p_status text default null,
  p_device_fingerprint_hash text default null,
  p_device_info jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee public.employees%rowtype;
  v_log public.attendance_logs%rowtype;
  v_after public.attendance_logs%rowtype;
  v_is_admin boolean;
begin
  select * into v_employee
  from public.employees
  where user_id = auth.uid() and is_active = true and employment_status = 'active';
  if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if;

  v_is_admin := public.is_admin();

  select * into v_log from public.attendance_logs where id = p_log_id;
  if not found then raise exception '퇴근 처리할 출근 기록이 없습니다.'; end if;
  if v_log.employee_id <> v_employee.id and not v_is_admin then
    raise exception '본인의 출근 기록만 퇴근 처리할 수 있습니다.';
  end if;

  if v_log.check_out_time is not null then
    return jsonb_build_object('attendance_log_id', v_log.id, 'attendance_status', v_log.status, 'already_closed', true);
  end if;

  update public.attendance_logs
  set check_out_time = now(),
      device_fingerprint_hash = coalesce(p_device_fingerprint_hash, device_fingerprint_hash),
      status = coalesce(p_status, nullif(v_log.status, ''), '관리자 확인 필요'),
      updated_at = now()
  where id = v_log.id
  returning * into v_after;

  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data)
  values(v_employee.id, 'close_attendance_log', 'attendance_logs', v_log.id, to_jsonb(v_log), to_jsonb(v_after));

  return jsonb_build_object('attendance_log_id', v_after.id, 'attendance_status', v_after.status, 'already_closed', false);
end;
$$;

create or replace function public.confirm_attendance_log(
  p_log_id uuid,
  p_status text default '확인 완료'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.attendance_logs%rowtype;
  v_after public.attendance_logs%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  v_admin := public.current_employee_id();
  select * into v_before from public.attendance_logs where id = p_log_id;
  if not found then raise exception '근태 기록을 찾을 수 없습니다.'; end if;
  update public.attendance_logs
  set status = coalesce(nullif(p_status,''), '확인 완료'), updated_at = now()
  where id = p_log_id
  returning * into v_after;
  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data)
  values(v_admin, 'confirm_attendance_log', 'attendance_logs', p_log_id, to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('ok', true, 'attendance_status', v_after.status);
end;
$$;

create or replace function public.update_my_attendance_status(
  p_log_id uuid,
  p_status text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid;
  v_before public.attendance_logs%rowtype;
  v_after public.attendance_logs%rowtype;
begin
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception '활성화된 직원 정보가 없습니다.'; end if;
  if p_status not in ('외근','재택','정상출근') then raise exception '허용되지 않은 근무형태입니다.'; end if;
  select * into v_before from public.attendance_logs where id = p_log_id and employee_id = v_employee_id;
  if not found then raise exception '오늘 출근 기록을 찾을 수 없습니다.'; end if;
  if (v_before.check_in_time at time zone 'Asia/Seoul')::date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 출근 기록만 근무형태를 변경할 수 있습니다.';
  end if;
  update public.attendance_logs set status = p_status, updated_at = now() where id = p_log_id returning * into v_after;
  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data)
  values(v_employee_id, 'update_my_attendance_status', 'attendance_logs', p_log_id, to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('ok', true, 'attendance_status', v_after.status);
end;
$$;

-- 추가근무 승인 적립 중복 방지 및 기존 중복 정리
with duplicate_comp_requests as (
  select
    id,
    row_number() over (
      partition by employee_id, work_date, start_time, end_time, hours, status
      order by created_at, id
    ) as rn
  from public.comp_time_requests
  where status in ('pending','approved')
)
delete from public.leave_adjustments a
using duplicate_comp_requests d
where a.source_type = 'comp_time_requests'
  and a.source_id = d.id
  and d.rn > 1;

with duplicate_comp_requests as (
  select
    id,
    row_number() over (
      partition by employee_id, work_date, start_time, end_time, hours, status
      order by created_at, id
    ) as rn
  from public.comp_time_requests
  where status in ('pending','approved')
)
delete from public.comp_time_requests c
using duplicate_comp_requests d
where c.id = d.id and d.rn > 1;

with ranked_comp_adjustments as (
  select
    id,
    row_number() over (
      partition by source_type, source_id, adjustment_type
      order by created_at, id
    ) as rn
  from public.leave_adjustments
  where source_type = 'comp_time_requests'
    and source_id is not null
    and adjustment_type = 'comp_time_earned'
)
delete from public.leave_adjustments a
using ranked_comp_adjustments r
where a.id = r.id and r.rn > 1;

create unique index if not exists leave_adjustments_comp_time_source_unique
on public.leave_adjustments(source_type, source_id, adjustment_type)
where source_type = 'comp_time_requests'
  and source_id is not null
  and adjustment_type = 'comp_time_earned';

create unique index if not exists comp_time_requests_active_unique
on public.comp_time_requests(
  employee_id,
  work_date,
  coalesce(start_time, '00:00'::time),
  coalesce(end_time, '00:00'::time),
  hours,
  status
)
where status in ('pending','approved');

create or replace function public.review_comp_time_request(
  p_request_id uuid,
  p_status text,
  p_review_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.comp_time_requests%rowtype;
  v_after public.comp_time_requests%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if p_status not in ('approved','rejected') then raise exception '허용되지 않은 처리 상태입니다.'; end if;

  v_admin := public.current_employee_id();

  select * into v_before from public.comp_time_requests where id = p_request_id;
  if not found then raise exception '추가근무 신청 내역이 없습니다.'; end if;

  update public.comp_time_requests
  set status = p_status,
      reviewed_by = v_admin,
      reviewed_at = now(),
      review_note = p_review_note
  where id = p_request_id
  returning * into v_after;

  if p_status = 'approved' then
    insert into public.leave_adjustments(
      employee_id, adjustment_type, adjustment_days, source_type, source_id, reason, created_by
    )
    select
      v_after.employee_id,
      'comp_time_earned',
      v_after.converted_days,
      'comp_time_requests',
      v_after.id,
      coalesce(v_after.reason, '추가근무 대체휴가 적립'),
      v_admin
    where not exists (
      select 1
      from public.leave_adjustments
      where source_type = 'comp_time_requests'
        and source_id = v_after.id
        and adjustment_type = 'comp_time_earned'
    );
  else
    delete from public.leave_adjustments
    where source_type = 'comp_time_requests'
      and source_id = v_after.id
      and adjustment_type = 'comp_time_earned';
  end if;

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
  values(v_admin,'review_comp_time_request','comp_time_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note);

  return jsonb_build_object('ok',true);
end;
$$;
