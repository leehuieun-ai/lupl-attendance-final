-- Issue #30: make rejected work-time signature deletion reliable.

drop policy if exists work_time_change_requests_admin_delete_rejected on public.work_time_change_requests;
create policy work_time_change_requests_admin_delete_rejected on public.work_time_change_requests
for delete to authenticated using (public.is_admin() and status = 'rejected');

create or replace function public.delete_rejected_work_time_change_request(
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_admin uuid;
  v_before public.work_time_change_requests%rowtype;
begin
  if not public.is_admin() then raise exception '관리자만 삭제할 수 있습니다.'; end if;
  v_admin := public.current_employee_id();

  select * into v_before
  from public.work_time_change_requests
  where id = p_request_id
    and status = 'rejected';

  if not found then raise exception '삭제할 반려 요청이 없습니다.'; end if;

  delete from public.work_time_change_requests
  where id = p_request_id
    and status = 'rejected';

  insert into public.audit_logs(actor_employee_id,action,target_table,target_id,before_data,reason)
  values(v_admin,'delete_rejected_work_time_change_request','work_time_change_requests',p_request_id,to_jsonb(v_before),'반려 근무시간 변경 요청 삭제');

  return jsonb_build_object('ok',true);
end;
$$;

grant execute on function public.delete_rejected_work_time_change_request(uuid) to authenticated;
notify pgrst, 'reload schema';
