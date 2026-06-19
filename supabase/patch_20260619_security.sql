-- 2026-06-19 security hardening patch
-- Run once in Supabase SQL Editor for existing deployments.

drop policy if exists workplaces_select_auth on public.workplaces;
create policy workplaces_select_auth on public.workplaces
for select to authenticated
using (
  visibility = 'public'
  or requested_by = public.current_employee_id()
  or public.is_admin()
);
