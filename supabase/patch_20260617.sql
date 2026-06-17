-- 2026-06-17 workplace search/approval and employee schedule patch
-- Run once in Supabase SQL Editor for existing deployments.

alter table public.workplaces add column if not exists visibility text not null default 'public';
alter table public.workplaces drop constraint if exists workplaces_visibility_check;
alter table public.workplaces add constraint workplaces_visibility_check check (visibility in ('public','private'));

alter table public.employees add column if not exists work_days text[] not null default array['mon','tue','wed','thu','fri'];
alter table public.employees add column if not exists work_start time not null default '09:00';
alter table public.employees add column if not exists work_end time not null default '18:00';
alter table public.employees add column if not exists work_start_date date;
alter table public.employees add column if not exists monthly_salary numeric(12,0) not null default 0;
alter table public.employees add column if not exists hourly_wage numeric(12,0) not null default 0;
alter table public.employees add column if not exists annual_salary numeric(12,0) not null default 0;
alter table public.employees add column if not exists weekly_work_days numeric(4,2) not null default 5;
alter table public.employees add column if not exists daily_work_hours numeric(4,2) not null default 8;
alter table public.employees add column if not exists monthly_standard_hours numeric(6,2) not null default 209;

create or replace function public.check_in(
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
  v_workplace public.workplaces%rowtype;
  v_device jsonb;
  v_device_status text;
  v_distance double precision;
  v_status text;
  v_open_count int;
  v_log public.attendance_logs%rowtype;
begin
  select * into v_employee
  from public.employees
  where user_id=auth.uid() and is_active=true and employment_status='active';
  if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if;

  select count(*) into v_open_count
  from public.attendance_logs
  where employee_id=v_employee.id and check_out_time is null;
  if v_open_count>0 then raise exception '아직 퇴근 처리되지 않은 출근 기록이 있습니다.'; end if;

  select * into v_workplace from public.workplaces where id=p_workplace_id;
  if not found then raise exception '근무지를 찾을 수 없습니다.'; end if;

  v_device:=public.register_device(p_device_fingerprint_hash,p_device_info);
  v_device_status:=v_device->>'device_status';
  v_distance:=public.calculate_distance_m(p_lat,p_lng,v_workplace.lat,v_workplace.lng);

  if v_workplace.type='remote' then
    v_status:='재택';
  elsif v_workplace.approval_status<>'approved' or v_workplace.is_active<>true then
    v_status:='관리자 확인 필요';
  elsif v_device_status<>'approved' then
    v_status:='기기 확인 필요';
  elsif p_accuracy_m is not null and p_accuracy_m>200 then
    v_status:='위치 정확도 낮음';
  elsif v_distance is null then
    v_status:='위치 확인 필요';
  elsif v_distance<=v_workplace.radius_m then
    if v_workplace.type in ('special_school','external_education','other_field') then
      v_status:='외근';
    else
      v_status:='정상출근';
    end if;
  else
    v_status:='위치 확인 필요';
  end if;

  insert into public.attendance_logs(
    employee_id,workplace_id,check_in_lat,check_in_lng,check_in_accuracy_m,check_in_distance_m,
    check_in_ip,device_fingerprint_hash,device_status,status
  )
  values(
    v_employee.id,v_workplace.id,p_lat,p_lng,p_accuracy_m,v_distance,
    p_ip_address,p_device_fingerprint_hash,v_device_status,v_status
  )
  returning * into v_log;

  update public.workplaces
  set visit_count=visit_count+1,last_used_at=now(),updated_at=now()
  where id=v_workplace.id;

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,after_data)
  values(v_employee.id,'check_in','attendance_logs',v_log.id,to_jsonb(v_log));

  return jsonb_build_object(
    'attendance_log_id',v_log.id,
    'attendance_status',v_status,
    'device_status',v_device_status,
    'distance_m',v_distance
  );
end;
$$;

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

  update public.workplaces set visit_count = visit_count + 1, last_used_at = now(), updated_at = now() where id = v_workplace.id;
  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, after_data)
  values(v_employee.id, 'recheck_in', 'attendance_logs', v_log.id, to_jsonb(v_log));

  return jsonb_build_object('attendance_log_id', v_log.id, 'attendance_status', v_status, 'device_status', v_device_status, 'distance_m', v_distance);
end;
$$;
