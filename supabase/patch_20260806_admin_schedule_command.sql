drop policy if exists work_time_change_requests_admin_insert on public.work_time_change_requests;

create policy work_time_change_requests_admin_insert
on public.work_time_change_requests
for insert
to authenticated
with check (public.is_admin());
