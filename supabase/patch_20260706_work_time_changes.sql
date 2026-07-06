-- 2026-07-06 근무시간 변경 요청/서명 및 추가근무 중복 대기 정리
-- Supabase SQL Editor에서 1회 실행하세요.

create table if not exists public.work_time_change_consents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  consent_version text not null,
  notice_text text not null,
  detail_text text,
  signature_data text,
  device_fingerprint_hash text,
  device_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists work_time_change_consents_employee_version_unique
on public.work_time_change_consents(employee_id, consent_version);

create table if not exists public.work_time_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  old_work_days text[] not null default array['mon','tue','wed','thu','fri'],
  old_work_start time not null default '09:00',
  old_work_end time not null default '18:00',
  old_break_start time not null default '12:00',
  old_break_end time not null default '13:00',
  new_work_days text[] not null default array['mon','tue','wed','thu','fri'],
  new_work_start time not null default '09:00',
  new_work_end time not null default '18:00',
  new_break_start time not null default '12:00',
  new_break_end time not null default '13:00',
  periods jsonb not null default '[]'::jsonb,
  total_calendar_days int not null default 0,
  total_work_days int not null default 0,
  weekly_work_hours numeric(6,2) not null default 0,
  reason text,
  legal_notice_version text not null default '2026-07',
  document_text text,
  signature_data text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.employees(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.work_time_change_consents enable row level security;
alter table public.work_time_change_requests enable row level security;

drop policy if exists work_time_change_consents_select_self_admin on public.work_time_change_consents;
create policy work_time_change_consents_select_self_admin on public.work_time_change_consents
for select to authenticated using (employee_id = public.current_employee_id() or public.is_admin());

drop policy if exists work_time_change_consents_insert_self on public.work_time_change_consents;
create policy work_time_change_consents_insert_self on public.work_time_change_consents
for insert to authenticated with check (employee_id = public.current_employee_id());

drop policy if exists work_time_change_consents_update_self on public.work_time_change_consents;
create policy work_time_change_consents_update_self on public.work_time_change_consents
for update to authenticated using (employee_id = public.current_employee_id()) with check (employee_id = public.current_employee_id());

drop policy if exists work_time_change_requests_select_self_admin on public.work_time_change_requests;
create policy work_time_change_requests_select_self_admin on public.work_time_change_requests
for select to authenticated using (employee_id = public.current_employee_id() or public.is_admin());

drop policy if exists work_time_change_requests_insert_self on public.work_time_change_requests;
create policy work_time_change_requests_insert_self on public.work_time_change_requests
for insert to authenticated with check (employee_id = public.current_employee_id() and status = 'pending');

drop policy if exists work_time_change_requests_admin_update on public.work_time_change_requests;
create policy work_time_change_requests_admin_update on public.work_time_change_requests
for update to authenticated using (public.is_admin()) with check (public.is_admin());

update public.comp_time_requests p
set status = 'rejected',
    reviewed_at = coalesce(p.reviewed_at, now()),
    review_note = coalesce(p.review_note, '동일한 추가근무 신청이 이미 승인되어 자동 정리됨')
where p.status = 'pending'
  and exists (
    select 1
    from public.comp_time_requests a
    where a.id <> p.id
      and a.status = 'approved'
      and a.employee_id = p.employee_id
      and a.work_date = p.work_date
      and coalesce(a.start_time, '00:00'::time) = coalesce(p.start_time, '00:00'::time)
      and coalesce(a.end_time, '00:00'::time) = coalesce(p.end_time, '00:00'::time)
      and a.hours = p.hours
  );

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
  v_duplicate_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if p_status not in ('approved','rejected') then raise exception '허용되지 않은 처리 상태입니다.'; end if;

  v_admin := public.current_employee_id();

  select * into v_before from public.comp_time_requests where id = p_request_id;
  if not found then raise exception '추가근무 신청 내역이 없습니다.'; end if;

  if v_before.status <> 'pending' then
    return jsonb_build_object('ok', true, 'already_reviewed', true, 'status', v_before.status);
  end if;

  if p_status = 'approved' then
    select a.id into v_duplicate_id
    from public.comp_time_requests a
    where a.id <> v_before.id
      and a.status = 'approved'
      and a.employee_id = v_before.employee_id
      and a.work_date = v_before.work_date
      and coalesce(a.start_time, '00:00'::time) = coalesce(v_before.start_time, '00:00'::time)
      and coalesce(a.end_time, '00:00'::time) = coalesce(v_before.end_time, '00:00'::time)
      and a.hours = v_before.hours
    limit 1;

    if v_duplicate_id is not null then
      update public.comp_time_requests
      set status = 'rejected',
          reviewed_by = v_admin,
          reviewed_at = now(),
          review_note = coalesce(p_review_note, '동일한 추가근무 신청이 이미 승인되어 중복 대기건을 정리했습니다.')
      where id = p_request_id
      returning * into v_after;

      insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
      values(v_admin,'review_comp_time_request_duplicate','comp_time_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note);

      return jsonb_build_object('ok', true, 'deduped', true, 'duplicate_id', v_duplicate_id);
    end if;
  end if;

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

create or replace function public.review_work_time_change_request(
  p_request_id uuid,
  p_status text,
  p_review_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.work_time_change_requests%rowtype;
  v_after public.work_time_change_requests%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if p_status not in ('approved','rejected') then raise exception '허용되지 않은 처리 상태입니다.'; end if;

  v_admin := public.current_employee_id();

  select * into v_before from public.work_time_change_requests where id = p_request_id;
  if not found then raise exception '근무시간 변경 요청 내역이 없습니다.'; end if;

  update public.work_time_change_requests
  set status = p_status,
      reviewed_by = v_admin,
      reviewed_at = now(),
      review_note = p_review_note,
      updated_at = now()
  where id = p_request_id
  returning * into v_after;

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
  values(v_admin,'review_work_time_change_request','work_time_change_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note);

  return jsonb_build_object('ok',true);
end;
$$;
