-- 2026-07-09 출퇴근 기록 정정 요청/근로자 확인
-- Supabase SQL Editor에서 1회 실행하세요.

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  attendance_log_id uuid references public.attendance_logs(id) on delete set null,
  work_date date not null,
  correction_type text not null check (correction_type in ('check_in','check_out','both')),
  old_check_in_time timestamptz,
  old_check_out_time timestamptz,
  requested_check_in_time timestamptz,
  requested_check_out_time timestamptz,
  reason text not null,
  evidence_note text,
  legal_notice_version text not null default '2026-07',
  document_text text not null,
  status text not null default 'pending' check (status in ('pending','signed','objected','cancelled')),
  requested_by uuid references public.employees(id),
  requested_at timestamptz not null default now(),
  signed_at timestamptz,
  signature_data text,
  signer_note text,
  device_fingerprint_hash text,
  device_info jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_correction_requests_employee_status_idx
on public.attendance_correction_requests(employee_id, status, work_date desc);

create index if not exists attendance_correction_requests_log_idx
on public.attendance_correction_requests(attendance_log_id);

alter table public.attendance_correction_requests enable row level security;

drop policy if exists attendance_corrections_select_self_admin on public.attendance_correction_requests;
create policy attendance_corrections_select_self_admin on public.attendance_correction_requests
for select to authenticated using (employee_id = public.current_employee_id() or public.is_admin());

drop policy if exists attendance_corrections_admin_insert on public.attendance_correction_requests;
create policy attendance_corrections_admin_insert on public.attendance_correction_requests
for insert to authenticated with check (public.is_admin() and status = 'pending');

drop policy if exists attendance_corrections_admin_update on public.attendance_correction_requests;
create policy attendance_corrections_admin_update on public.attendance_correction_requests
for update to authenticated
using (public.is_admin() and status = 'pending')
with check (public.is_admin() and status in ('pending','cancelled'));

create or replace function public.sign_attendance_correction_request(
  p_request_id uuid,
  p_signature_data text,
  p_signer_note text default null,
  p_device_fingerprint_hash text default null,
  p_device_info jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid;
  v_before public.attendance_correction_requests%rowtype;
  v_after public.attendance_correction_requests%rowtype;
  v_log_before public.attendance_logs%rowtype;
  v_log_after public.attendance_logs%rowtype;
  v_log_id uuid;
begin
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception '활성화된 직원 정보가 없습니다.'; end if;
  if coalesce(length(p_signature_data),0) < 100 then raise exception '서명을 입력해주세요.'; end if;

  select * into v_before
  from public.attendance_correction_requests
  where id = p_request_id
  for update;

  if not found then raise exception '출퇴근 기록 정정 요청을 찾을 수 없습니다.'; end if;
  if v_before.employee_id <> v_employee_id then raise exception '본인의 정정 요청만 서명할 수 있습니다.'; end if;
  if v_before.status <> 'pending' then raise exception '이미 처리된 정정 요청입니다.'; end if;

  if v_before.attendance_log_id is null then
    if v_before.requested_check_in_time is null then
      raise exception '출근 기록이 없는 정정은 출근 시각이 필요합니다.';
    end if;
    if v_before.requested_check_out_time is not null and v_before.requested_check_out_time <= v_before.requested_check_in_time then
      raise exception '퇴근 시각은 출근 시각보다 늦어야 합니다.';
    end if;

    insert into public.attendance_logs(
      employee_id, check_in_time, check_out_time, device_fingerprint_hash, status, exception_reason
    )
    values(
      v_before.employee_id,
      v_before.requested_check_in_time,
      v_before.requested_check_out_time,
      p_device_fingerprint_hash,
      '출퇴근 기록 정정',
      concat_ws(E'\n', '직원 서명 후 관리자 정정 요청 반영', v_before.reason)
    )
    returning * into v_log_after;

    v_log_id := v_log_after.id;

    insert into public.audit_logs(actor_employee_id, action, target_table, target_id, after_data, reason)
    values(v_employee_id, 'insert_attendance_log_by_correction', 'attendance_logs', v_log_id, to_jsonb(v_log_after), v_before.reason);
  else
    select * into v_log_before
    from public.attendance_logs
    where id = v_before.attendance_log_id
      and employee_id = v_before.employee_id
    for update;

    if not found then raise exception '정정할 출퇴근 기록을 찾을 수 없습니다.'; end if;
    if coalesce(v_before.requested_check_out_time, v_log_before.check_out_time) is not null
      and coalesce(v_before.requested_check_out_time, v_log_before.check_out_time) <= coalesce(v_before.requested_check_in_time, v_log_before.check_in_time) then
      raise exception '퇴근 시각은 출근 시각보다 늦어야 합니다.';
    end if;

    update public.attendance_logs
    set check_in_time = coalesce(v_before.requested_check_in_time, check_in_time),
        check_out_time = coalesce(v_before.requested_check_out_time, check_out_time),
        device_fingerprint_hash = coalesce(p_device_fingerprint_hash, device_fingerprint_hash),
        status = '출퇴근 기록 정정',
        exception_reason = concat_ws(E'\n', nullif(exception_reason,''), '직원 서명 후 출퇴근 기록 정정: ' || v_before.reason),
        updated_at = now()
    where id = v_before.attendance_log_id
    returning * into v_log_after;

    v_log_id := v_log_after.id;

    insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data, reason)
    values(v_employee_id, 'update_attendance_log_by_correction', 'attendance_logs', v_log_id, to_jsonb(v_log_before), to_jsonb(v_log_after), v_before.reason);
  end if;

  update public.attendance_correction_requests
  set status = 'signed',
      signed_at = now(),
      signature_data = p_signature_data,
      signer_note = p_signer_note,
      device_fingerprint_hash = p_device_fingerprint_hash,
      device_info = coalesce(p_device_info, '{}'::jsonb),
      attendance_log_id = coalesce(attendance_log_id, v_log_id),
      applied_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_after;

  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data, reason)
  values(v_employee_id, 'sign_attendance_correction_request', 'attendance_correction_requests', p_request_id, to_jsonb(v_before), to_jsonb(v_after), p_signer_note);

  return jsonb_build_object('ok', true, 'attendance_log_id', v_log_id);
end;
$$;

create or replace function public.object_attendance_correction_request(
  p_request_id uuid,
  p_signer_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee_id uuid;
  v_before public.attendance_correction_requests%rowtype;
  v_after public.attendance_correction_requests%rowtype;
begin
  v_employee_id := public.current_employee_id();
  if v_employee_id is null then raise exception '활성화된 직원 정보가 없습니다.'; end if;

  select * into v_before
  from public.attendance_correction_requests
  where id = p_request_id
  for update;

  if not found then raise exception '출퇴근 기록 정정 요청을 찾을 수 없습니다.'; end if;
  if v_before.employee_id <> v_employee_id then raise exception '본인의 정정 요청만 처리할 수 있습니다.'; end if;
  if v_before.status <> 'pending' then raise exception '이미 처리된 정정 요청입니다.'; end if;

  update public.attendance_correction_requests
  set status = 'objected',
      signer_note = p_signer_note,
      updated_at = now()
  where id = p_request_id
  returning * into v_after;

  insert into public.audit_logs(actor_employee_id, action, target_table, target_id, before_data, after_data, reason)
  values(v_employee_id, 'object_attendance_correction_request', 'attendance_correction_requests', p_request_id, to_jsonb(v_before), to_jsonb(v_after), p_signer_note);

  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
