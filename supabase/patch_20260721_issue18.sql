-- Issue #18: keep overtime/comp-time precision down to one-minute entries.
alter table public.comp_time_requests
  alter column hours type numeric(8,4),
  alter column converted_days type numeric(8,4);

alter table public.comp_time_requests
  add column if not exists actual_overtime_hours numeric(8,4);

alter table public.comp_time_requests
  alter column actual_overtime_hours type numeric(8,4);

alter table public.leave_adjustments
  alter column adjustment_days type numeric(8,4);

update public.comp_time_requests
set converted_days = round(hours / 8, 4)
where hours is not null
  and abs(coalesce(converted_days, 0) - round(hours / 8, 4)) > 0.0001;

update public.leave_adjustments adjustment
set adjustment_days = request.converted_days
from public.comp_time_requests request
where adjustment.source_type = 'comp_time_requests'
  and adjustment.source_id = request.id
  and adjustment.adjustment_type = 'comp_time_earned'
  and abs(coalesce(adjustment.adjustment_days, 0) - request.converted_days) > 0.0001;

create or replace function public.admin_grant_comp_time(
  p_employee_id uuid,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_hours numeric,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_request public.comp_time_requests%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 등록할 수 있습니다.'; end if;
  if p_hours is null or p_hours <= 0 then raise exception '추가근무 시간은 0보다 커야 합니다.'; end if;
  if not exists(select 1 from public.employees where id=p_employee_id and is_active=true) then raise exception '활성 직원을 찾을 수 없습니다.'; end if;
  v_admin := public.current_employee_id();
  insert into public.comp_time_requests(employee_id,work_date,start_time,end_time,hours,converted_days,reason,status,reviewed_by,reviewed_at,review_note)
  values(p_employee_id,p_work_date,p_start_time,p_end_time,p_hours,round(p_hours/8,4),p_reason,'approved',v_admin,now(),'관리자 직접 등록')
  returning * into v_request;
  insert into public.leave_adjustments(employee_id,adjustment_type,adjustment_days,source_type,source_id,reason,created_by)
  values(p_employee_id,'comp_time_earned',v_request.converted_days,'comp_time_requests',v_request.id,coalesce(p_reason,'관리자 등록 추가근무'),v_admin);
  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,after_data,reason)
  values(v_admin,'admin_grant_comp_time','comp_time_requests',v_request.id,to_jsonb(v_request),p_reason);
  return jsonb_build_object('ok',true,'request_id',v_request.id,'converted_days',v_request.converted_days);
end;
$$;

create or replace function public.review_comp_time_attendance(
  p_request_id uuid,
  p_status text,
  p_scheduled_end time,
  p_review_note text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.comp_time_requests%rowtype;
  v_after public.comp_time_requests%rowtype;
  v_log public.attendance_logs%rowtype;
  v_log_before public.attendance_logs%rowtype;
  v_scheduled_end timestamptz;
  v_actual_hours numeric(8,4);
begin
  if not public.is_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if p_status not in ('approved','rejected') then raise exception '허용되지 않은 처리 상태입니다.'; end if;

  v_admin := public.current_employee_id();
  select * into v_before from public.comp_time_requests where id=p_request_id;
  if not found then raise exception '추가근무 신청 내역이 없습니다.'; end if;
  if v_before.work_date < date '2026-06-24' then raise exception '2026년 6월 24일 이전 기록은 기존 승인 방식으로 처리해주세요.'; end if;

  select * into v_log
  from public.attendance_logs
  where employee_id=v_before.employee_id
    and (check_in_time at time zone 'Asia/Seoul')::date=v_before.work_date
    and check_out_time is not null
  order by check_in_time desc
  limit 1;
  if not found then raise exception '퇴근 완료 기록이 없어 처리할 수 없습니다.'; end if;

  v_log_before := v_log;
  v_scheduled_end := timezone('Asia/Seoul', v_before.work_date::timestamp + p_scheduled_end);
  v_actual_hours := greatest(0,round((extract(epoch from (v_log.check_out_time-v_scheduled_end))/3600)::numeric,4));

  if p_status='approved' then
    if v_actual_hours<=0 then raise exception '예정 퇴근시간 이후의 초과근무가 없습니다.'; end if;
    update public.comp_time_requests
    set status='approved', hours=v_actual_hours, actual_overtime_hours=v_actual_hours,
        converted_days=round(v_actual_hours/8,4), attendance_log_id=v_log.id,
        reviewed_by=v_admin, reviewed_at=now(),
        review_note=coalesce(p_review_note,'실제 퇴근시간 기준 승인')
    where id=p_request_id returning * into v_after;

    insert into public.leave_adjustments(employee_id,adjustment_type,adjustment_days,source_type,source_id,reason,created_by)
    select v_after.employee_id,'comp_time_earned',v_after.converted_days,'comp_time_requests',
           v_after.id,coalesce(v_after.reason,'실제 초과근무 대체휴가 적립'),v_admin
    where not exists (
      select 1 from public.leave_adjustments
      where source_type='comp_time_requests' and source_id=v_after.id and adjustment_type='comp_time_earned'
    );

    update public.attendance_logs
    set original_check_out_time=coalesce(original_check_out_time,check_out_time),
        scheduled_check_out_time=v_scheduled_end, overtime_review_status='approved',
        overtime_reviewed_by=v_admin, overtime_reviewed_at=now(), updated_at=now()
    where id=v_log.id;
  else
    update public.comp_time_requests
    set status='rejected', actual_overtime_hours=v_actual_hours, attendance_log_id=v_log.id,
        reviewed_by=v_admin, reviewed_at=now(), review_note=coalesce(p_review_note,'초과근무 인정 안 함')
    where id=p_request_id returning * into v_after;

    delete from public.leave_adjustments
    where source_type='comp_time_requests' and source_id=v_after.id and adjustment_type='comp_time_earned';

    update public.attendance_logs
    set original_check_out_time=coalesce(original_check_out_time,check_out_time),
        scheduled_check_out_time=v_scheduled_end, check_out_time=least(check_out_time,v_scheduled_end),
        overtime_review_status='rejected', overtime_reviewed_by=v_admin, overtime_reviewed_at=now(),
        status='관리자 강제퇴근',
        exception_reason=concat_ws(E'\n',nullif(exception_reason,''),'초과근무 인정 안 함. 실제 퇴근 기록 별도 보존'),
        updated_at=now()
    where id=v_log.id;
  end if;

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
  values(v_admin,'review_comp_time_attendance','comp_time_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),p_review_note);
  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
  select v_admin,'review_overtime_checkout','attendance_logs',v_log.id,to_jsonb(v_log_before),to_jsonb(l),p_review_note
  from public.attendance_logs l where l.id=v_log.id;

  return jsonb_build_object('ok',true,'status',p_status,'actual_overtime_hours',v_actual_hours,'scheduled_check_out_time',v_scheduled_end);
end;
$$;
