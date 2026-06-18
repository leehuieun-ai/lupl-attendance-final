-- 2026-06-18 employee work start date and payroll basis patch
-- Run once in Supabase SQL Editor for existing deployments.

alter table public.employees add column if not exists work_start_date date;
alter table public.employees add column if not exists hourly_wage numeric(12,0) not null default 0;
alter table public.employees add column if not exists annual_salary numeric(12,0) not null default 0;
alter table public.employees add column if not exists weekly_work_days numeric(4,2) not null default 5;
alter table public.employees add column if not exists daily_work_hours numeric(4,2) not null default 8;
alter table public.employees add column if not exists monthly_standard_hours numeric(6,2) not null default 209;

update public.employees
set work_start_date = coalesce(work_start_date, joined_at),
    weekly_work_days = coalesce(nullif(weekly_work_days, 0), greatest(1, coalesce(array_length(work_days, 1), 5))),
    daily_work_hours = coalesce(nullif(daily_work_hours, 0), 8),
    monthly_standard_hours = coalesce(nullif(monthly_standard_hours, 0), round((coalesce(nullif(weekly_work_days, 0), greatest(1, coalesce(array_length(work_days, 1), 5))) * coalesce(nullif(daily_work_hours, 0), 8) * 4.345)::numeric, 1)),
    annual_salary = case when coalesce(annual_salary, 0) = 0 and coalesce(monthly_salary, 0) > 0 then monthly_salary * 12 else annual_salary end,
    hourly_wage = case
      when coalesce(hourly_wage, 0) = 0 and coalesce(monthly_salary, 0) > 0 and coalesce(monthly_standard_hours, 0) > 0
      then round(monthly_salary / monthly_standard_hours)
      else hourly_wage
    end;

-- 이름이 명확한 기존 집 근무지는 재택으로 보정합니다.
update public.workplaces
set type = 'remote',
    visibility = 'private',
    updated_at = now()
where visibility = 'private'
  and (
    name like '%집%'
    or name like '%자택%'
    or name like '%재택%'
    or lower(name) like '%home%'
  )
  and type <> 'remote';

-- 동일 장소가 여러 번 등록된 경우 최신 행만 활성 상태로 유지합니다.
with ranked_workplaces as (
  select
    id,
    row_number() over (
      partition by case
        when nullif(kakao_place_id,'') is not null then 'kakao:' || kakao_place_id
        when visibility='private' then 'private:'
          || coalesce(requested_by::text,'')
          || ':' || lower(trim(name))
        else 'manual:'
          || coalesce(requested_by::text,'')
          || ':' || lower(trim(name))
          || ':' || coalesce(round(lat::numeric,5)::text,'')
          || ':' || coalesce(round(lng::numeric,5)::text,'')
      end
      order by updated_at desc, created_at desc
    ) as row_no
  from public.workplaces
  where approval_status='approved' and is_active=true
)
update public.workplaces w
set approval_status='rejected',
    is_active=false,
    memo=concat_ws(E'\n',nullif(w.memo,''),'중복 근무지 자동 보관'),
    updated_at=now()
from ranked_workplaces r
where w.id=r.id
  and r.row_no>1;

-- 같은 직원의 동일한 물리 기기가 브라우저 저장소 변경 등으로 여러 번 등록된 경우
-- 최근 접속 행 하나만 유지합니다.
with ranked_devices as (
  select
    id,
    row_number() over (
      partition by employee_id,
        coalesce(device_info->>'platform', ''),
        coalesce(device_info->>'screen', ''),
        coalesce(device_info->>'hardwareConcurrency', ''),
        coalesce(device_info->>'language', ''),
        coalesce(device_info->>'timezone', '')
      order by last_seen_at desc, created_at desc
    ) as row_no
  from public.registered_devices
)
delete from public.registered_devices d
using ranked_devices r
where d.id = r.id
  and r.row_no > 1;

create or replace function public.register_device(p_fingerprint_hash text,p_device_info jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_existing public.registered_devices%rowtype;
  v_approved_count int;
  v_status text;
begin
  select * into v_employee
  from public.employees
  where user_id=auth.uid() and is_active=true and employment_status='active';
  if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if;

  select * into v_existing
  from public.registered_devices
  where employee_id=v_employee.id and fingerprint_hash=p_fingerprint_hash;

  if not found then
    select * into v_existing
    from public.registered_devices
    where employee_id=v_employee.id
      and coalesce(device_info->>'platform','')=coalesce(p_device_info->>'platform','')
      and coalesce(device_info->>'screen','')=coalesce(p_device_info->>'screen','')
      and coalesce(device_info->>'hardwareConcurrency','')=coalesce(p_device_info->>'hardwareConcurrency','')
      and coalesce(device_info->>'language','')=coalesce(p_device_info->>'language','')
      and coalesce(device_info->>'timezone','')=coalesce(p_device_info->>'timezone','')
    order by last_seen_at desc
    limit 1;
  end if;

  if found then
    update public.registered_devices
    set fingerprint_hash=p_fingerprint_hash,
        last_seen_at=now(),
        device_info=coalesce(p_device_info,device_info)
    where id=v_existing.id
    returning * into v_existing;
    return json_build_object('device_id',v_existing.id,'device_status',v_existing.status,'device_limit',v_employee.device_limit);
  end if;

  select count(*) into v_approved_count
  from public.registered_devices
  where employee_id=v_employee.id and status='approved';
  v_status:=case when v_employee.role='admin' or v_approved_count<v_employee.device_limit then 'approved' else 'pending' end;

  insert into public.registered_devices(employee_id,fingerprint_hash,device_info,status)
  values(v_employee.id,p_fingerprint_hash,coalesce(p_device_info,'{}'::jsonb),v_status)
  returning * into v_existing;

  return json_build_object('device_id',v_existing.id,'device_status',v_existing.status,'device_limit',v_employee.device_limit);
end;
$$;
