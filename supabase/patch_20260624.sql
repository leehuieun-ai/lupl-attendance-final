-- 2026-06-24 employee visual schedule board

create table if not exists public.employee_schedule_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  event_type text not null default 'info'
    check (event_type in ('work','am_only','pm_only','unavailable','info')),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  note text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_schedule_events_date_check check (end_date >= start_date)
);

create unique index if not exists employee_schedule_events_seed_unique
on public.employee_schedule_events(employee_id,title,start_date,end_date,event_type);

alter table public.employee_schedule_events enable row level security;

drop policy if exists employee_schedule_events_admin_all on public.employee_schedule_events;
create policy employee_schedule_events_admin_all
on public.employee_schedule_events
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 2026-06-24에 등록된 유동 근무 직원의 전달 일정
insert into public.employee_schedule_events(employee_id,title,event_type,start_date,end_date,note,created_by)
select e.id,'계절학기','info','2026-06-24','2026-07-14','계절 시험일 주간 출근 불가능',a.id
from public.employees e
left join public.employees a on a.employee_no='22061201'
where e.employee_no='26062401'
on conflict do nothing;

insert into public.employee_schedule_events(employee_id,title,event_type,start_date,end_date,note,created_by)
select e.id,'네이버교육','am_only','2026-06-29','2026-07-08','교육 기간 동안 오후 근무 불가능',a.id
from public.employees e
left join public.employees a on a.employee_no='22061201'
where e.employee_no='26062401'
on conflict do nothing;

insert into public.employee_schedule_events(employee_id,title,event_type,start_date,end_date,note,created_by)
select e.id,'해외봉사','unavailable','2026-07-27','2026-08-17','해외봉사 기간 출근 불가능',a.id
from public.employees e
left join public.employees a on a.employee_no='22061201'
where e.employee_no='26062401'
on conflict do nothing;

insert into public.employee_schedule_events(employee_id,title,event_type,start_date,end_date,note,created_by)
select e.id,'출근 불가','unavailable','2026-07-03','2026-07-03','출근 불가 전달일',a.id
from public.employees e
left join public.employees a on a.employee_no='22061201'
where e.employee_no='26062401'
on conflict do nothing;

insert into public.employee_schedule_events(employee_id,title,event_type,start_date,end_date,note,created_by)
select e.id,'출근 불가','unavailable','2026-07-14','2026-07-14','출근 불가 전달일',a.id
from public.employees e
left join public.employees a on a.employee_no='22061201'
where e.employee_no='26062401'
on conflict do nothing;
