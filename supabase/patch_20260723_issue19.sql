create or replace function public.cancel_work_time_change_request(
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_employee uuid;
  v_before public.work_time_change_requests%rowtype;
  v_after public.work_time_change_requests%rowtype;
begin
  v_employee := public.current_employee_id();
  if v_employee is null then raise exception '직원 정보를 찾을 수 없습니다.'; end if;

  select * into v_before
  from public.work_time_change_requests
  where id = p_request_id
    and employee_id = v_employee
    and status = 'pending';

  if not found then raise exception '철회할 승인 대기 요청이 없습니다.'; end if;

  update public.work_time_change_requests
  set status = 'rejected',
      review_note = '근로자 신청 철회',
      updated_at = now()
  where id = p_request_id
  returning * into v_after;

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,after_data,reason)
  values(v_employee,'cancel_work_time_change_request','work_time_change_requests',p_request_id,to_jsonb(v_before),to_jsonb(v_after),'근로자 신청 철회');

  return jsonb_build_object('ok',true);
end;
$$;
