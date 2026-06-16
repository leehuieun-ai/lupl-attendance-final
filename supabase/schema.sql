-- 러플 근태관리 시스템 BigTech Final Schema
create extension if not exists pgcrypto;
create table if not exists public.employees (id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id) on delete cascade, employee_no text not null unique, name text not null, phone text, internal_email text unique, role text not null default 'employee' check (role in ('admin','employee')), device_limit int not null default 3 check (device_limit between 1 and 3), joined_at date default current_date, employment_status text not null default 'active' check (employment_status in ('active','inactive')), is_active boolean not null default true, leave_policy text not null default 'anniversary' check (leave_policy in ('anniversary','fiscal_year')), created_at timestamptz not null default now());
create table if not exists public.workplaces (id uuid primary key default gen_random_uuid(), name text not null, type text not null check (type in ('office','special_school','external_education','remote','other_field')), address text, kakao_place_id text, lat double precision, lng double precision, radius_m int not null default 100, ip_hint text, wifi_ssid_hint text, approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')), requested_by uuid references public.employees(id), approved_by uuid references public.employees(id), is_active boolean not null default false, visit_count int not null default 0, last_used_at timestamptz, memo text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.registered_devices (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, fingerprint_hash text not null, device_info jsonb not null default '{}'::jsonb, status text not null default 'pending' check (status in ('pending','approved','rejected')), last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(employee_id,fingerprint_hash));
create table if not exists public.attendance_logs (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, workplace_id uuid references public.workplaces(id), check_in_time timestamptz not null default now(), check_out_time timestamptz, check_in_lat double precision, check_in_lng double precision, check_in_accuracy_m double precision, check_out_lat double precision, check_out_lng double precision, check_out_accuracy_m double precision, check_in_distance_m double precision, check_out_distance_m double precision, check_in_ip text, check_out_ip text, device_fingerprint_hash text, device_status text, status text not null default '정상출근', exception_reason text, auto_checkout_candidate boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.break_logs (id uuid primary key default gen_random_uuid(), attendance_log_id uuid not null references public.attendance_logs(id) on delete cascade, employee_id uuid not null references public.employees(id) on delete cascade, break_start timestamptz not null default now(), break_end timestamptz, created_at timestamptz not null default now());
create table if not exists public.attendance_requests (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, request_type text not null check (request_type in ('annual','half_am','half_pm','hourly','sick','official','remote','field','time_fix','special','substitute','compensatory','comp_leave_use')), start_date date not null, end_date date not null, amount_days numeric(6,2), amount_hours numeric(6,2), reason text, status text not null default 'pending' check (status in ('pending','approved','rejected')), reviewed_by uuid references public.employees(id), reviewed_at timestamptz, review_note text, created_at timestamptz not null default now());
create table if not exists public.comp_time_requests (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, work_date date not null, start_time time, end_time time, hours numeric(6,2) not null, converted_days numeric(6,2) not null, reason text, status text not null default 'pending' check (status in ('pending','approved','rejected')), reviewed_by uuid references public.employees(id), reviewed_at timestamptz, review_note text, created_at timestamptz not null default now());
create table if not exists public.leave_adjustments (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, adjustment_type text not null check (adjustment_type in ('add','subtract','carryover','expire','cancel_use','comp_time_earned')), adjustment_days numeric(6,2) not null, source_type text, source_id uuid, reason text, created_by uuid references public.employees(id), created_at timestamptz not null default now());
create table if not exists public.monthly_closings (id uuid primary key default gen_random_uuid(), month text not null unique, status text not null default 'open' check (status in ('open','reviewed','closed')), closed_by uuid references public.employees(id), closed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.privacy_consents (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, consent_location boolean not null default true, consent_device boolean not null default true, consent_version text not null default '2026-01', signature_data text, device_fingerprint_hash text, device_info jsonb not null default '{}'::jsonb, is_active boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), actor_employee_id uuid references public.employees(id), action text not null, target_table text, target_id uuid, before_data jsonb, after_data jsonb, reason text, created_at timestamptz not null default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), employee_id uuid references public.employees(id) on delete cascade, type text not null, title text not null, body text, status text not null default 'pending', created_at timestamptz not null default now());
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.employees where user_id=auth.uid() and role='admin' and is_active=true and employment_status='active'); $$;
create or replace function public.current_employee_id() returns uuid language sql stable security definer set search_path = public as $$ select id from public.employees where user_id=auth.uid() and is_active=true and employment_status='active' limit 1; $$;
create or replace function public.calculate_distance_m(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision) returns double precision language plpgsql immutable as $$ declare r double precision:=6371000; p1 double precision; p2 double precision; dp double precision; dl double precision; a double precision; c double precision; begin if lat1 is null or lng1 is null or lat2 is null or lng2 is null then return null; end if; p1:=radians(lat1);p2:=radians(lat2);dp:=radians(lat2-lat1);dl:=radians(lng2-lng1);a:=sin(dp/2)*sin(dp/2)+cos(p1)*cos(p2)*sin(dl/2)*sin(dl/2);c:=2*atan2(sqrt(a),sqrt(1-a));return r*c; end; $$;
create or replace function public.register_device(p_fingerprint_hash text,p_device_info jsonb) returns jsonb language plpgsql security definer set search_path = public as $$ declare v_employee public.employees%rowtype; v_existing public.registered_devices%rowtype; v_approved_count int; v_status text; begin select * into v_employee from public.employees where user_id=auth.uid() and is_active=true and employment_status='active'; if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if; select * into v_existing from public.registered_devices where employee_id=v_employee.id and fingerprint_hash=p_fingerprint_hash; if found then update public.registered_devices set last_seen_at=now(), device_info=coalesce(p_device_info, device_info) where id=v_existing.id; return jsonb_build_object('device_id',v_existing.id,'device_status',v_existing.status,'device_limit',v_employee.device_limit); end if; select count(*) into v_approved_count from public.registered_devices where employee_id=v_employee.id and status='approved'; if v_approved_count < v_employee.device_limit then v_status:='approved'; else v_status:='pending'; end if; insert into public.registered_devices(employee_id,fingerprint_hash,device_info,status) values(v_employee.id,p_fingerprint_hash,coalesce(p_device_info,'{}'::jsonb),v_status) returning * into v_existing; return jsonb_build_object('device_id',v_existing.id,'device_status',v_existing.status,'device_limit',v_employee.device_limit); end; $$;
create or replace function public.check_in(p_workplace_id uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision,p_ip_address text,p_device_fingerprint_hash text,p_device_info jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_employee public.employees%rowtype; v_workplace public.workplaces%rowtype; v_device jsonb; v_device_status text; v_distance double precision; v_status text; v_open_count int; v_log public.attendance_logs%rowtype; begin select * into v_employee from public.employees where user_id=auth.uid() and is_active=true and employment_status='active'; if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if; select count(*) into v_open_count from public.attendance_logs where employee_id=v_employee.id and check_out_time is null; if v_open_count>0 then raise exception '아직 퇴근 처리되지 않은 출근 기록이 있습니다.'; end if; select * into v_workplace from public.workplaces where id=p_workplace_id; if not found then raise exception '근무지를 찾을 수 없습니다.'; end if; v_device:=public.register_device(p_device_fingerprint_hash,p_device_info); v_device_status:=v_device->>'device_status'; v_distance:=public.calculate_distance_m(p_lat,p_lng,v_workplace.lat,v_workplace.lng); if v_workplace.type='remote' then v_status:='재택'; elsif v_workplace.approval_status<>'approved' then v_status:='관리자 확인 필요'; elsif v_device_status<>'approved' then v_status:='기기 확인 필요'; elsif p_accuracy_m is not null and p_accuracy_m>200 then v_status:='위치 정확도 낮음'; elsif v_distance is null then v_status:='위치 확인 필요'; elsif v_distance<=v_workplace.radius_m then if v_workplace.type in ('special_school','external_education','other_field') then v_status:='외근'; else v_status:='정상출근'; end if; else v_status:='위치 확인 필요'; end if; insert into public.attendance_logs(employee_id,workplace_id,check_in_lat,check_in_lng,check_in_accuracy_m,check_in_distance_m,check_in_ip,device_fingerprint_hash,device_status,status) values(v_employee.id,v_workplace.id,p_lat,p_lng,p_accuracy_m,v_distance,p_ip_address,p_device_fingerprint_hash,v_device_status,v_status) returning * into v_log; update public.workplaces set visit_count=visit_count+1,last_used_at=now() where id=v_workplace.id; insert into public.audit_logs(actor_employee_id,action,target_table,target_id,after_data) values(v_employee.id,'check_in','attendance_logs',v_log.id,to_jsonb(v_log)); return jsonb_build_object('attendance_log_id',v_log.id,'attendance_status',v_status,'device_status',v_device_status,'distance_m',v_distance); end; $$;
create or replace function public.check_out(p_lat double precision,p_lng double precision,p_accuracy_m double precision,p_ip_address text,p_device_fingerprint_hash text,p_device_info jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_employee public.employees%rowtype; v_log public.attendance_logs%rowtype; v_workplace public.workplaces%rowtype; v_device jsonb; v_device_status text; v_distance double precision; v_status text; begin select * into v_employee from public.employees where user_id=auth.uid() and is_active=true and employment_status='active'; if not found then raise exception '활성화된 직원 정보가 없습니다.'; end if; select * into v_log from public.attendance_logs where employee_id=v_employee.id and check_out_time is null order by check_in_time desc limit 1; if not found then raise exception '퇴근 처리할 출근 기록이 없습니다.'; end if; select * into v_workplace from public.workplaces where id=v_log.workplace_id; v_device:=public.register_device(p_device_fingerprint_hash,p_device_info); v_device_status:=v_device->>'device_status'; v_distance:=public.calculate_distance_m(p_lat,p_lng,v_workplace.lat,v_workplace.lng); if v_device_status<>'approved' then v_status:='기기 확인 필요'; elsif p_accuracy_m is not null and p_accuracy_m>200 then v_status:='위치 정확도 낮음'; elsif v_workplace.type<>'remote' and (v_distance is null or v_distance>v_workplace.radius_m) then v_status:='위치 확인 필요'; else v_status:=v_log.status; end if; update public.attendance_logs set check_out_time=now(),check_out_lat=p_lat,check_out_lng=p_lng,check_out_accuracy_m=p_accuracy_m,check_out_distance_m=v_distance,check_out_ip=p_ip_address,device_status=v_device_status,status=v_status,updated_at=now() where id=v_log.id returning * into v_log; insert into public.audit_logs(actor_employee_id,action,target_table,target_id,after_data) values(v_employee.id,'check_out','attendance_logs',v_log.id,to_jsonb(v_log)); return jsonb_build_object('attendance_log_id',v_log.id,'attendance_status',v_status,'device_status',v_device_status,'distance_m',v_distance); end; $$;
create or replace function public.review_attendance_request(p_request_id uuid,p_status text,p_review_note text default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_admin uuid; v_before public.attendance_requests%rowtype; v_after public.attendance_requests%rowtype; begin if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if; v_admin:=public.current_employee_id(); select * into v_before from public.attendance_requests where id=p_request_id; if not found then raise exception '신청 내역이 없습니다.'; end if; update public.attendance_requests set status=p_status,reviewed_by=v_admin,reviewed_at=now(),review_note=p_review_note where id=p_request_id returning * into v_after; insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason) values(v_admin,'review_attendance_request','attendance_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note); return jsonb_build_object('ok',true); end; $$;
create or replace function public.review_comp_time_request(p_request_id uuid,p_status text,p_review_note text default null) returns jsonb language plpgsql security definer set search_path=public as $$ declare v_admin uuid; v_before public.comp_time_requests%rowtype; v_after public.comp_time_requests%rowtype; begin if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if; v_admin:=public.current_employee_id(); select * into v_before from public.comp_time_requests where id=p_request_id; if not found then raise exception '추가근무 신청 내역이 없습니다.'; end if; update public.comp_time_requests set status=p_status,reviewed_by=v_admin,reviewed_at=now(),review_note=p_review_note where id=p_request_id returning * into v_after; if p_status='approved' then insert into public.leave_adjustments(employee_id,adjustment_type,adjustment_days,source_type,source_id,reason,created_by) values(v_after.employee_id,'comp_time_earned',v_after.converted_days,'comp_time_requests',v_after.id,coalesce(v_after.reason,'추가근무 대체휴가 적립'),v_admin); end if; insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason) values(v_admin,'review_comp_time_request','comp_time_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note); return jsonb_build_object('ok',true); end; $$;
alter table public.employees enable row level security; alter table public.workplaces enable row level security; alter table public.registered_devices enable row level security; alter table public.attendance_logs enable row level security; alter table public.break_logs enable row level security; alter table public.attendance_requests enable row level security; alter table public.comp_time_requests enable row level security; alter table public.leave_adjustments enable row level security; alter table public.monthly_closings enable row level security; alter table public.privacy_consents enable row level security; alter table public.audit_logs enable row level security; alter table public.notifications enable row level security;
create policy employees_select_self_admin on public.employees for select to authenticated using (user_id=auth.uid() or public.is_admin()); create policy employees_admin_update on public.employees for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy workplaces_select_auth on public.workplaces for select to authenticated using (true); create policy workplaces_insert_auth on public.workplaces for insert to authenticated with check (public.current_employee_id() is not null); create policy workplaces_admin_update on public.workplaces for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy devices_select_self_admin on public.registered_devices for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy devices_admin_update on public.registered_devices for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy logs_select_self_admin on public.attendance_logs for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin());
create policy break_select_self_admin on public.break_logs for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy break_insert_self on public.break_logs for insert to authenticated with check (employee_id=public.current_employee_id()); create policy break_update_self_admin on public.break_logs for update to authenticated using (employee_id=public.current_employee_id() or public.is_admin()) with check (employee_id=public.current_employee_id() or public.is_admin());
create policy req_select_self_admin on public.attendance_requests for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy req_insert_self on public.attendance_requests for insert to authenticated with check (employee_id=public.current_employee_id()); create policy req_admin_update on public.attendance_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy comp_select_self_admin on public.comp_time_requests for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy comp_insert_self on public.comp_time_requests for insert to authenticated with check (employee_id=public.current_employee_id()); create policy comp_admin_update on public.comp_time_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy adj_select_self_admin on public.leave_adjustments for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy adj_admin_all on public.leave_adjustments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy closing_admin_all on public.monthly_closings for all to authenticated using (public.is_admin()) with check (public.is_admin()); create policy closing_select_auth on public.monthly_closings for select to authenticated using (true);
create policy privacy_select_self_admin on public.privacy_consents for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin()); create policy privacy_insert_self on public.privacy_consents for insert to authenticated with check (employee_id=public.current_employee_id());
create policy audit_select_admin on public.audit_logs for select to authenticated using (public.is_admin()); create policy notifications_select_self_admin on public.notifications for select to authenticated using (employee_id=public.current_employee_id() or public.is_admin());

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
  elsif v_workplace.approval_status <> 'approved' then
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
