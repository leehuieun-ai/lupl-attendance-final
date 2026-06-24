-- 2026-06-24 allow administrators to register and approve employee overtime atomically

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
  if not exists(select 1 from public.employees where id=p_employee_id and is_active=true) then
    raise exception '활성 직원을 찾을 수 없습니다.';
  end if;

  v_admin := public.current_employee_id();

  insert into public.comp_time_requests(
    employee_id,work_date,start_time,end_time,hours,converted_days,reason,status,
    reviewed_by,reviewed_at,review_note
  ) values(
    p_employee_id,p_work_date,p_start_time,p_end_time,p_hours,round(p_hours/8,2),
    p_reason,'approved',v_admin,now(),'관리자 직접 등록'
  ) returning * into v_request;

  insert into public.leave_adjustments(
    employee_id,adjustment_type,adjustment_days,source_type,source_id,reason,created_by
  ) values(
    p_employee_id,'comp_time_earned',v_request.converted_days,'comp_time_requests',
    v_request.id,coalesce(p_reason,'관리자 등록 추가근무'),v_admin
  );

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,after_data,reason)
  values(v_admin,'admin_grant_comp_time','comp_time_requests',v_request.id,to_jsonb(v_request),p_reason);

  return jsonb_build_object('ok',true,'request_id',v_request.id,'converted_days',v_request.converted_days);
end;
$$;
