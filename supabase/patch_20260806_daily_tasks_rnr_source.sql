alter table public.daily_tasks
add column if not exists source_rnr_entry_id uuid references public.rnr_entries(id) on delete set null;

create index if not exists daily_tasks_rnr_source_idx
on public.daily_tasks(source_rnr_entry_id, task_date desc)
where source_rnr_entry_id is not null;
