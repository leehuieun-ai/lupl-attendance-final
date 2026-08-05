alter table public.employees
  add column if not exists is_unpaid boolean not null default false;

update public.employees
set is_unpaid = true,
    no_annual_leave = true
where position = '인턴';

update public.employees e
set employee_no = '26081001',
    internal_email = '26081001@lupl.local'
where e.name = '조하빈'
  and e.employee_no is distinct from '26081001'
  and not exists (
    select 1
    from public.employees other_employee
    where other_employee.employee_no = '26081001'
      and other_employee.id <> e.id
  );
