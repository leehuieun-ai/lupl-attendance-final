-- 2026-06-18 employee work start date and payroll basis patch
-- Run once in Supabase SQL Editor for existing deployments.

alter table public.employees add column if not exists work_start_date date;
alter table public.employees add column if not exists hourly_wage numeric(12,0) not null default 0;
alter table public.employees add column if not exists annual_salary numeric(12,0) not null default 0;
alter table public.employees add column if not exists weekly_work_days numeric(4,2) not null default 5;
alter table public.employees add column if not exists daily_work_hours numeric(4,2) not null default 8;
alter table public.employees add column if not exists monthly_standard_hours numeric(6,2) not null default 209;

update public.employees
set work_start_date = coalesce(work_start_date, joined_at),
    weekly_work_days = coalesce(nullif(weekly_work_days, 0), greatest(1, coalesce(array_length(work_days, 1), 5))),
    daily_work_hours = coalesce(nullif(daily_work_hours, 0), 8),
    monthly_standard_hours = coalesce(nullif(monthly_standard_hours, 0), round((coalesce(nullif(weekly_work_days, 0), greatest(1, coalesce(array_length(work_days, 1), 5))) * coalesce(nullif(daily_work_hours, 0), 8) * 4.345)::numeric, 1)),
    annual_salary = case when coalesce(annual_salary, 0) = 0 and coalesce(monthly_salary, 0) > 0 then monthly_salary * 12 else annual_salary end,
    hourly_wage = case
      when coalesce(hourly_wage, 0) = 0 and coalesce(monthly_salary, 0) > 0 and coalesce(monthly_standard_hours, 0) > 0
      then round(monthly_salary / monthly_standard_hours)
      else hourly_wage
    end;
