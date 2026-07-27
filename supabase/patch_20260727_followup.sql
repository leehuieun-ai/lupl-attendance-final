-- 2026-07-27 follow-up: RNR attachments, GitHub issue traces, work-time request correction

alter table public.rnr_entries add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.daily_tasks add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.improvement_requests add column if not exists github_issue_number int;
alter table public.improvement_requests add column if not exists github_issue_url text;
alter table public.improvement_requests add column if not exists github_issue_title text;
alter table public.improvement_requests add column if not exists github_sent_at timestamptz;

update public.work_time_change_requests r
set
  new_work_days = array['fri']::text[],
  new_work_start = '13:00'::time,
  new_work_end = '17:00'::time,
  total_calendar_days = 1,
  total_work_days = 1,
  weekly_work_hours = 4.0,
  updated_at = now()
where r.status = 'pending'
  and r.periods @> '[{"start_date":"2026-07-24","end_date":"2026-07-24"}]'::jsonb
  and r.new_work_days = '{}'::text[]
  and r.new_work_start = '01:00'::time
  and r.new_work_end = '05:00'::time;

notify pgrst, 'reload schema';
