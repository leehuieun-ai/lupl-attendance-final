ChatGPT








출퇴근_관리_프로그램_사용자 메뉴얼.pdf
PDF
혹시 이거 보고 우리 회사만의 근태 시스템을 만들 수 있을까? 어떤 컴퓨터로 로그인 했는지, gps 도 확인할수 있고 말이야. 깃허브로 만들고싶어 

몇 초 동안 생각함
네, 만들 수 있습니다. 다만 GPS·접속 컴퓨터 기록은 개인정보/위치정보에 해당하므로 근로자 동의, 수집 목적 고지, 보관기간, 관리자 접근권한을 먼저 정해두고 만드는 게 안전합니다.

올려주신 매뉴얼 기준으로 기존 프로그램은 PC 기반 출퇴근 입력, 사업장/근로자 설정, 근무시간 조정, PDF·Excel 다운로드, 근로자용 JSON 업로드 구조를 갖고 있습니다. 특히 모바일 사용은 제한된다고 되어 있어, 러플용으로는 웹/PWA 기반 근태 시스템으로 새로 만드는 방향이 더 적합합니다. 


러플용으로 만들면 구조는 이렇게 가면 좋습니다.

러플 근태 시스템 기본 기능

1. 직원 로그인
  - 이름 / 사번 / 비밀번호 또는 구글 로그인
  - 출근 버튼
  - 퇴근 버튼
  - 오늘 근무 상태 확인

2. 출퇴근 기록
  - 출근 시간
  - 퇴근 시간
  - 총 근무시간
  - 휴게시간
  - 지각 / 조퇴 / 결근 / 재택 / 외근 표시
  - 관리자 수정 이력 저장

3. 위치 확인
  - 출근·퇴근 시 GPS 좌표 저장
  - 지정 근무지 반경 내 출근 여부 확인
  - 예: 라운지 반경 100m 이내면 정상 출근
  - 외근·교육 장소는 별도 위치 등록 가능

4. 접속 기기 확인
  - 로그인한 기기 정보 저장
  - 브라우저 정보
  - 운영체제
  - IP 주소
  - 기기 고유 식별용 device fingerprint
  - 동일 직원이 다른 컴퓨터에서 출근 시 관리자 알림

5. 관리자 페이지
  - 직원 등록
  - 근무지 등록
  - 근무시간 설정
  - 출퇴근 현황 캘린더
  - 월별 근무표 다운로드
  - 수정 이력 확인
  - 비정상 출근 기록 확인

6. 출력 기능
  - 근로자별 월간 근태표
  - 관리자용 전체 근무표
  - 급여 정산용 Excel
  - PDF 다운로드
기술 구조는 GitHub에 올릴 거면 이렇게 추천드립니다.

추천 개발 구조

Frontend
- React
- TypeScript
- Tailwind CSS
- PWA 적용

Backend / DB
- Supabase
  - Auth
  - Database
  - Row Level Security
  - Edge Functions

주요 API
- Geolocation API: GPS 위치 확인
- User-Agent Parser: 접속 기기 확인
- IP 확인 API: 접속 IP 저장
- Device Fingerprint: 동일 기기 여부 판단

배포
- GitHub
- Vercel 또는 Netlify
- Supabase 연동
러플에 맞는 핵심 화면은 이 정도면 충분합니다.

러플 근태 시스템 화면 구성

1. 직원 출퇴근 화면
  - 오늘 날짜
  - 현재 시간
  - 근무 상태
  - 출근하기
  - 퇴근하기
  - 현재 위치 확인 상태
  - 접속 기기 정보

2. 관리자 대시보드
  - 오늘 출근자
  - 미출근자
  - 지각자
  - 외근자
  - 재택근무자
  - 비정상 위치 출근자
  - 다른 기기 접속자

3. 직원 관리
  - 이름
  - 사번
  - 직무
  - 근무 형태
  - 기본 근무지
  - 기본 출퇴근 시간

4. 근무지 관리
  - 라운지
  - 이룸고
  - 광명학교
  - 외부 교육장
  - 재택
  - 기타 외근지

5. 근태 기록 관리
  - 일별 보기
  - 주별 보기
  - 월별 보기
  - 직원별 필터
  - 상태별 필터
  - Excel/PDF 다운로드
주의할 점은 있습니다.

반드시 정해야 하는 개인정보 기준

1. GPS는 출근·퇴근 버튼을 누르는 순간에만 수집
2. 실시간 위치 추적은 하지 않음
3. 기기 정보는 근태 부정 방지 목적으 로만 사용
4. 관리자 외 열람 제한
5. 보관기간 설정
  - 예: 근태기록 3년
  - 위치·기기 로그 1년
6. 직원 동의 문구 필수
7. 수정 이력은 삭제하지 않고 별도 보관
제 생각에는 처음부터 너무 크게 만들기보다 1차 MVP로 아래 기능만 먼저 만들면 됩니다.

1차 MVP 범위

- 직원 로그인
- 출근 / 퇴근 버튼
- GPS 좌표 저장
- 접속 기기 정보 저장
- 관리자 출퇴근 현황 확인
- 월별 Excel 다운로드
- 관리자 근태 수정
- 수정 사유 기록
깃허브로 만들려면 제가 바로 다음 단계에서 러버블/깃허브에 붙여넣을 수 있는 개발 프롬프트로 정리해드릴 수 있습니다.


안된다는데 

없는데? 

image(98).png
지그 ㅁ이상태야

image(99).png
image(100).png


붙여넣은 텍스트 (1)(13).txt
문서
자 이게 클로드 그거야. 

1-뭐가 더 좋아 
2-a
3-a 토글로 하거나 좀 좋게 바꿔봐  비활성화 메뉴 따로 만들어도 될듯 
4-a
5-b,c,d
6-a,d
7-b
8-b,d
9-b
10-d
11-b
12-c
13-d
14-3대 하자 왜냐면 사무실 pc, 개인 노트북, 폰 이잇으니까 
15-c
16-c
17-d
18-c
19-d
20-a
21-b,c,
22-c
23-c
24-c 직원이 폰도 기기로 등록해놨는다 했을 때, 하나의 기기가 다른 기기와 벗어났을 때 자동 퇴근 되데 그 다음날 관리자 확인 필요하도록 해줄래? 일단 근데 이거는 사무실 출근했을 경우 
25-a 보고서도 있으면 좋을 것 같아 
26-c, d
27- d
28-d
29-d
30-d, 모바일에서는 출퇴근 버튼 중심으로 해줘. 

근데 맨 처음부터 너무 가벼운 중심을 잡으면 안되니까 그러닊 ㅏ자전거에 캠핑카 붙이지 말고, 애초에 뼈대 자체를 튼튼하게 캠핑카로 만들어. 

기존에 근태관리 하는 saas들 확인하고 부족한 부분 개선하고 알겠지? 

image(102).png
그럼 ㅇ기서 기존에 있는 저거 삭제 하고 바꾸는거 어캐함 

여기서 어떻게 해 

생성 됐어 

이거 봐바

 이거 맞아?



image(109).png
생성 되어잇는거같은데?

image(110).png
비밀번호 리셋 ㅇ청햇더니 메일왓고 메일 들어가니까 이렇게 떠 


image(111).png


image(113).png

image(114).png

아 비번은 알았는데 로그인 하니까 그 사번으로 이렇게 뜸

image(116).png
image(117).png


붙여넣은 텍스트 (1)(14).txt
문서

image(119).png
image(120).png
너 딱 3분 안에 해결해라 계속 똥개훈련 시키지 말고 ㅡㅡ

image(139).png

붙여넣은 텍스트 (1)(18).txt
문서
너랑 말하고 이렇게 또 디벨롭 했거든. ㄴ데 마지막으로 이 부분만 확인해주면돼 

일단 지금 뜬 근무지 RLS 오류랑 추가근무 삭제 안 되는 문제는 DB 권한/삭제 함수 문제라서, 아래 SQL부터 실행하시면 됩니다.

급여 천단위 쉼표랑 주간 스케줄 “몇 월 몇째주” 표시는 src/App.tsx 현재 파일을 봐야 정확히 통으로 드릴 수 있습니다. 이전 개발 기록상 급여계산, 주간 스케줄, 추가근무 승인/삭제가 전부 App.tsx 쪽에 들어간 상태라서, 지금 파일 없이 제가 임의로 전체 코드를 주면 또 다른 기능이 덮여서 깨질 수 있습니다. 

 


먼저 Supabase SQL Editor에서 이거 그대로 실행하세요.

-- 1. 관리자/현재 직원 확인 함수 보강
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.employees
  where user_id = auth.uid()
    and is_active = true
    and employment_status = 'active'
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees
    where user_id = auth.uid()
      and role = 'admin'
      and is_active = true
      and employment_status = 'active'
  );
$$;


-- 2. workplaces에 필요한 컬럼이 없으면 추가
alter table public.workplaces
add column if not exists requested_by uuid references public.employees(id);

alter table public.workplaces
add column if not exists visibility text default 'public';

alter table public.workplaces
add column if not exists is_active boolean default false;

alter table public.workplaces
add column if not exists approval_status text default 'pending';


-- 3. 기존 workplaces 정책 정리
drop policy if exists workplaces_select_auth on public.workplaces;
drop policy if exists workplaces_insert_auth on public.workplaces;
drop policy if exists workplaces_admin_update on public.workplaces;
drop policy if exists workplaces_select_visible on public.workplaces;
drop policy if exists workplaces_insert_pending_self on public.workplaces;
drop policy if exists workplaces_admin_update_all on public.workplaces;
drop policy if exists workplaces_admin_delete_all on public.workplaces;

alter table public.workplaces enable row level security;


-- 4. 직원은 공개 근무지 + 본인이 요청한 근무지만 볼 수 있음
create policy workplaces_select_visible
on public.workplaces
for select
to authenticated
using (
  public.is_admin()
  or visibility = 'public'
  or requested_by = public.current_employee_id()
);


-- 5. 직원이 현재 장소 입력 시 승인대기 근무지로 저장 가능
create policy workplaces_insert_pending_self
on public.workplaces
for insert
to authenticated
with check (
  public.is_admin()
  or requested_by = public.current_employee_id()
);


-- 6. 근무지 승인/반려/수정은 관리자만
create policy workplaces_admin_update_all
on public.workplaces
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());


create policy workplaces_admin_delete_all
on public.workplaces
for delete
to authenticated
using (public.is_admin());


-- 7. 재택/관리자 개인 장소는 직원에게 안 보이게 정리
update public.workplaces
set visibility = 'private'
where type = 'remote';

update public.workplaces
set visibility = 'public'
where visibility is null;


-- 8. 추가근무 대체휴가 삭제용 관리자 함수
create or replace function public.delete_comp_time_request_admin(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_target public.comp_time_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception '관리자만 삭제할 수 있습니다.';
  end if;

  v_admin := public.current_employee_id();

  select *
  into v_target
  from public.comp_time_requests
  where id = p_request_id;

  if not found then
    raise exception '삭제할 추가근무 적립 내역을 찾을 수 없습니다.';
  end if;

  delete from public.leave_adjustments
  where source_type = 'comp_time_requests'
    and source_id = p_request_id;

  delete from public.comp_time_requests
  where id = p_request_id;

  insert into public.audit_logs (
    actor_employee_id,
    action,
    target_table,
    target_id,
    before_data,
    reason
  )
  values (
    v_admin,
    'delete_comp_time_request_admin',
    'comp_time_requests',
    p_request_id,
    to_jsonb(v_target),
    '관리자 추가근무 대체휴가 적립 내역 삭제'
  );

  return jsonb_build_object('ok', true);
end;
$$;


-- 9. 추가근무/연차 조정 테이블 RLS 보강
alter table public.comp_time_requests enable row level security;
alter table public.leave_adjustments enable row level security;

drop policy if exists comp_admin_delete on public.comp_time_requests;
drop policy if exists leave_adjustments_admin_delete on public.leave_adjustments;

create policy comp_admin_delete
on public.comp_time_requests
for delete
to authenticated
using (public.is_admin());

create policy leave_adjustments_admin_delete
on public.leave_adjustments
for delete
to authenticated
using (public.is_admin());
이 SQL 실행 후에도 추가근무 삭제 버튼이 그대로 안 먹으면, 프론트가 아직 직접 delete()를 때리고 있는 상태일 가능성이 큽니다. 그 경우 src/App.tsx에서 삭제 버튼 함수를 아래 RPC로 바꿔야 합니다.

await supabase.rpc("delete_comp_time_request_admin", {
  p_request_id: id,
});
다음으로 제가 수정해야 할 파일은 src/App.tsx 하나입니다.
그 파일 전체를 보내주시면 아래 4개를 한 번에 반영해서 src/App.tsx 통째 코드블록으로 드리겠습니다.

- 추가근무 적립 내역 삭제 버튼이 RPC 함수로 삭제되게 수정
- 급여계산 월급/공제/실수령액에 1,000 단위 쉼표 적용
- 주간 스케줄 변경에서 날짜 선택 시 “2026년 6월 2째주” 표시
- 이번주만이 아니라 선택한 날짜 기준 주간 스케줄 변경 가능


붙여넣은 텍스트 (1)(19).txt
문서
어ㅗ 추가근무 삭제 되 ㅎㅎ 

좋습니다. 그럼 추가근무 삭제는 해결 완료로 두고 건드리지 않겠습니다.

지금 업로드된 src/App.tsx 기준으로 확인해보면, 현재 파일에는 LeavePage, WorkplacePage, AdminPage, ReportsPage는 있는데, 급여계산 화면/주간 스케줄 변경 화면 코드가 들어있지 않습니다. 현재 ReportsPage도 근태/추가근무 Excel 다운로드 중심으로만 구성되어 있습니다. 


그래서 남은 작업은 이렇게 나눠야 합니다.

완료
- 추가근무 적립 내역 삭제

아직 확인 필요
- 현재장소 "사무실" 입력 시 workplaces RLS 오류
- 급여계산 월급 예시 천단위 쉼표
- 주간 스케줄 변경 날짜 선택 시 몇 월 몇째주 표시
- 이번주 외 다른 주 스케줄 변경
일단 현재장소 RLS 오류는 SQL로 처리하면 되고, App.tsx는 안 건드려도 됩니다. 아래 SQL 실행하세요.

drop policy if exists workplaces_insert_pending_self on public.workplaces;

create policy workplaces_insert_pending_self
on public.workplaces
for insert
to authenticated
with check (
  public.is_admin()
  or requested_by = public.current_employee_id()
);

drop policy if exists workplaces_select_visible on public.workplaces;

create policy workplaces_select_visible
on public.workplaces
for select
to authenticated
using (
  public.is_admin()
  or is_active = true
  or requested_by = public.current_employee_id()
);

drop policy if exists workplaces_admin_update_all on public.workplaces;

create policy workplaces_admin_update_all
on public.workplaces
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
그리고 급여계산/주간 스케줄 변경은 지금 올려주신 App.tsx 안에 해당 코드가 없어서, 제가 임의로 수정하면 새 화면을 만들어야 합니다. 기존에 이미 만들어둔 급여계산/스케줄 화면이 있는 파일을 올려주시면 그 파일만 수정해서 통째 코드블록으로 드리겠습니다.

찾아볼 파일명은 보통 아래 중 하나입니다.

src/App.tsx
src/pages/admin/Employees.tsx
src/pages/admin/Schedule.tsx
src/pages/admin/Payroll.tsx
src/components/PayrollCalculator.tsx
현재 올려주신 파일 기준으로는 RLS는 SQL만 실행, 급여/스케줄은 해당 화면이 들어있는 파일 추가로 필요입니다.


image(141).png
image(142).png
image(143).png
이게 다야

네. 지금 구조는 src/App.tsx 한 파일에 화면이 거의 다 들어간 구조라서, 급여계산/주간 스케줄은 App.tsx에 추가하는 게 맞습니다. 현재 파일에는 급여계산/주간 스케줄 화면이 아직 없습니다. 


추가근무 삭제는 해결됐으니 안 건드립니다.

먼저 Supabase SQL Editor에서 아래 SQL 실행하세요.
이게 현재장소 사무실 입력 시 workplaces RLS 오류랑 주간 스케줄 저장 테이블을 같이 해결합니다.

-- 현재 로그인한 직원/관리자 확인 함수
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.employees
  where user_id = auth.uid()
    and is_active = true
    and employment_status = 'active'
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees
    where user_id = auth.uid()
      and role = 'admin'
      and is_active = true
      and employment_status = 'active'
  );
$$;

-- workplaces RLS 오류 해결
alter table public.workplaces
add column if not exists requested_by uuid references public.employees(id);

alter table public.workplaces
add column if not exists visibility text default 'public';

alter table public.workplaces
add column if not exists is_active boolean default false;

alter table public.workplaces
add column if not exists approval_status text default 'pending';

alter table public.workplaces enable row level security;

drop policy if exists workplaces_select_visible on public.workplaces;
drop policy if exists workplaces_insert_pending_self on public.workplaces;
drop policy if exists workplaces_admin_update_all on public.workplaces;
drop policy if exists workplaces_admin_delete_all on public.workplaces;

create policy workplaces_select_visible
on public.workplaces
for select
to authenticated
using (
  public.is_admin()
  or is_active = true
  or requested_by = public.current_employee_id()
);

create policy workplaces_insert_pending_self
on public.workplaces
for insert
to authenticated
with check (
  public.is_admin()
  or requested_by = public.current_employee_id()
);

create policy workplaces_admin_update_all
on public.workplaces
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy workplaces_admin_delete_all
on public.workplaces
for delete
to authenticated
using (public.is_admin());

-- 주간 스케줄 변경 저장 테이블
create table if not exists public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  work_date date not null,
  day_label text not null,
  start_time text,
  end_time text,
  memo text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_schedules_work_date_key
on public.weekly_schedules(work_date);

alter table public.weekly_schedules enable row level security;

drop policy if exists weekly_schedules_select_auth on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_insert on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_update on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_delete on public.weekly_schedules;

create policy weekly_schedules_select_auth
on public.weekly_schedules
for select
to authenticated
using (true);

create policy weekly_schedules_admin_insert
on public.weekly_schedules
for insert
to authenticated
with check (public.is_admin());

create policy weekly_schedules_admin_update
on public.weekly_schedules
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy weekly_schedules_admin_delete
on public.weekly_schedules
for delete
to authenticated
using (public.is_admin());
이제 src/App.tsx만 수정하면 됩니다.

1. type Tab 이 줄 교체
기존:

type Tab = "home" | "leave" | "workplaces" | "admin" | "reports";
아래로 교체하세요.

type Tab = "home" | "leave" | "workplaces" | "admin" | "reports" | "payrollSchedule";
2. todayIso() 아래에 이 함수들 추가
function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(n || 0));
}

function parseMoney(v: string) {
  return Number(String(v).replace(/[^\d]/g, "")) || 0;
}

function formatMoneyInput(v: string) {
  const n = parseMoney(v);
  return n ? formatNumber(n) : "";
}

function toLocalDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getMonday(dateIso: string) {
  const d = toLocalDate(dateIso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function getWeekOfMonth(dateIso: string) {
  const d = toLocalDate(dateIso);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const firstDayOffset = (firstDay.getDay() + 6) % 7;
  return Math.ceil((d.getDate() + firstDayOffset) / 7);
}

function getKoreanWeekLabel(dateIso: string) {
  const d = toLocalDate(dateIso);
  const week = getWeekOfMonth(dateIso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${week}째주`;
}

function getWeekRange(dateIso: string) {
  const monday = getMonday(dateIso);
  const sunday = addDays(monday, 6);

  return {
    start: toIsoDate(monday),
    end: toIsoDate(sunday),
    label: `${monday.getMonth() + 1}/${monday.getDate()} ~ ${sunday.getMonth() + 1}/${sunday.getDate()}`,
  };
}

function makeDefaultScheduleRows(dateIso: string) {
  const monday = getMonday(dateIso);
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];

  return dayLabels.map((dayLabel, index) => {
    const d = addDays(monday, index);

    return {
      work_date: toIsoDate(d),
      day_label: dayLabel,
      start_time: index >= 5 ? "" : "09:00",
      end_time: index >= 5 ? "" : "18:00",
      memo: index >= 5 ? "휴무" : "",
    };
  });
}
3. 상단 탭에 버튼 추가
reports 버튼 바로 아래에 추가하세요.

{isAdmin && (
  <button
    className={`tab ${tab === "payrollSchedule" ? "active" : ""}`}
    onClick={() => setTab("payrollSchedule")}
  >
    급여·스케줄
  </button>
)}
그리고 화면 렌더링 부분에 아래 줄도 추가하세요.

{tab === "payrollSchedule" && isAdmin && <PayrollSchedulePage employee={employee} />}
4. function ReportsPage() 아래, function DataTable() 위에 이 컴포넌트 추가
function PayrollSchedulePage({ employee }: { employee: any }) {
  const [salaryText, setSalaryText] = useState("2,500,000");
  const [deductionRateText, setDeductionRateText] = useState("9.4");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [scheduleRows, setScheduleRows] = useState<any[]>(makeDefaultScheduleRows(todayIso()));
  const [message, setMessage] = useState("");

  const monthlySalary = parseMoney(salaryText);
  const deductionRate = Number(deductionRateText) || 0;
  const expectedDeduction = monthlySalary * (deductionRate / 100);
  const expectedNetPay = monthlySalary - expectedDeduction;
  const week = getWeekRange(selectedDate);
  const weekLabel = getKoreanWeekLabel(selectedDate);

  async function loadSchedule(dateIso = selectedDate) {
    const range = getWeekRange(dateIso);

    const { data, error } = await supabase
      .from("weekly_schedules")
      .select("*")
      .gte("work_date", range.start)
      .lte("work_date", range.end)
      .order("work_date", { ascending: true });

    if (error) {
      setMessage(error.message);
      setScheduleRows(makeDefaultScheduleRows(dateIso));
      return;
    }

    if (data && data.length > 0) {
      const defaults = makeDefaultScheduleRows(dateIso);
      const merged = defaults.map((row) => {
        const saved = data.find((item) => item.work_date === row.work_date);
        return saved
          ? {
              work_date: saved.work_date,
              day_label: saved.day_label,
              start_time: saved.start_time ?? "",
              end_time: saved.end_time ?? "",
              memo: saved.memo ?? "",
            }
          : row;
      });

      setScheduleRows(merged);
    } else {
      setScheduleRows(makeDefaultScheduleRows(dateIso));
    }
  }

  useEffect(() => {
    loadSchedule(selectedDate);
  }, [selectedDate]);

  function updateScheduleRow(index: number, patch: Record<string, any>) {
    setScheduleRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function saveSchedule() {
    setMessage("");

    const payload = scheduleRows.map((row) => ({
      week_start: week.start,
      work_date: row.work_date,
      day_label: row.day_label,
      start_time: row.start_time || null,
      end_time: row.end_time || null,
      memo: row.memo || null,
      created_by: employee.id,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("weekly_schedules")
      .upsert(payload, { onConflict: "work_date" });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(`${weekLabel} 주간 스케줄이 저장되었습니다.`);
      await loadSchedule(selectedDate);
    }
  }

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="grid two">
        <section className="card">
          <h2 className="card-title">급여 계산</h2>
          <p className="subtle">
            월급 입력값과 예시 금액은 천단위 쉼표로 표시됩니다.
          </p>

          <div className="form-row">
            <label className="label">월급</label>
            <input
              className="input"
              value={salaryText}
              onChange={(e) => setSalaryText(formatMoneyInput(e.target.value))}
              placeholder="예: 2,500,000"
            />
          </div>

          <div className="form-row">
            <label className="label">예상 공제율(%)</label>
            <input
              className="input"
              type="number"
              step="0.1"
              value={deductionRateText}
              onChange={(e) => setDeductionRateText(e.target.value)}
              placeholder="예: 9.4"
            />
          </div>

          <div className="grid three">
            <div className="metric">
              <div className="metric-value">{formatNumber(monthlySalary)}</div>
              <div className="metric-label">월급 예시</div>
            </div>
            <div className="metric">
              <div className="metric-value">{formatNumber(expectedDeduction)}</div>
              <div className="metric-label">예상 공제</div>
            </div>
            <div className="metric">
              <div className="metric-value">{formatNumber(expectedNetPay)}</div>
              <div className="metric-label">예상 실수령</div>
            </div>
          </div>

          <div className="alert" style={{ marginTop: 16 }}>
            예시: 월급 {formatNumber(monthlySalary)}원 기준, 예상 공제액은{" "}
            {formatNumber(expectedDeduction)}원, 예상 실수령액은{" "}
            {formatNumber(expectedNetPay)}원입니다.
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">주간 스케줄 변경</h2>
          <p className="subtle">
            날짜를 선택하면 해당 날짜가 포함된 주차가 표시되며,
            이번주 외 다른 주도 변경할 수 있습니다.
          </p>

          <div className="form-row">
            <label className="label">변경할 주 기준 날짜</label>
            <input
              className="input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          <div className="alert">
            선택된 주: <b>{weekLabel}</b>
            <br />
            기간: {week.label}
          </div>

          <button className="button" onClick={saveSchedule}>
            이 주 스케줄 저장
          </button>
        </section>
      </section>

      <section className="card">
        <h2 className="card-title">{weekLabel} 스케줄</h2>
        <p className="subtle">
          날짜별 출근/퇴근 시간을 수정하고 저장하면 해당 주 스케줄로 기록됩니다.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>요일</th>
                <th>날짜</th>
                <th>출근</th>
                <th>퇴근</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((row, index) => (
                <tr key={row.work_date}>
                  <td>{row.day_label}</td>
                  <td>{row.work_date}</td>
                  <td>
                    <input
                      className="input"
                      type="time"
                      value={row.start_time ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { start_time: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="time"
                      value={row.end_time ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { end_time: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={row.memo ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { memo: e.target.value })
                      }
                      placeholder="예: 휴무, 외근, 단축근무"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button" onClick={saveSchedule}>
            {weekLabel} 저장
          </button>
          <button
            className="button ghost"
            onClick={() => setScheduleRows(makeDefaultScheduleRows(selectedDate))}
          >
            기본값으로 되돌리기
          </button>
        </div>
      </section>
    </div>
  );
}
이렇게 하면 됩니다.

해결되는 것

- 현재장소 "사무실" 입력 시 workplaces RLS 오류 해결
- 급여계산 월급/예시 금액 천단위 쉼표 표시
- 날짜 선택 시 "2026년 6월 2째주" 형태 표시
- 이번주가 아니라 선택한 날짜 기준의 다른 주도 스케줄 변경 가능
수정 후 GitHub 커밋하면 Vercel 자동 배포됩니다.


아니.. 이렇게 수정할거 많으면 그냥 app 파일 통째로 다시 줘.. 

네. 아래 src/App.tsx 전체 교체용입니다.
기존 App.tsx 기준으로 급여·스케줄 탭까지 합쳐서 넣었습니다. 


import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
  calculateAdjustmentDays,
  calculateCompTimeEarnedDays,
  calculateLeaveEntitlement,
  calculateUsedDays,
} from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab =
  | "home"
  | "leave"
  | "workplaces"
  | "admin"
  | "reports"
  | "payrollSchedule";

const workplaceTypeLabels: Record<string, string> = {
  office: "사무실",
  special_school: "특수학교",
  external_education: "외부 교육장",
  remote: "재택",
  other_field: "기타 외근지",
};

const requestTypeLabels: Record<string, string> = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  hourly: "시간차",
  sick: "병가",
  official: "공가",
  remote: "재택",
  field: "외근",
  time_fix: "근무시간 수정 요청",
  special: "특별휴가",
  substitute: "대체휴가",
  compensatory: "보상휴가",
  comp_leave_use: "추가근무 대체휴가 사용",
};

function internalEmail(no: string) {
  return `${no.trim().toLowerCase()}@lupl.local`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(n || 0));
}

function parseMoney(v: string) {
  return Number(String(v).replace(/[^\d]/g, "")) || 0;
}

function formatMoneyInput(v: string) {
  const n = parseMoney(v);
  return n ? formatNumber(n) : "";
}

function toLocalDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonday(dateIso: string) {
  const d = toLocalDate(dateIso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function getWeekOfMonth(dateIso: string) {
  const d = toLocalDate(dateIso);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const firstDayOffset = (firstDay.getDay() + 6) % 7;
  return Math.ceil((d.getDate() + firstDayOffset) / 7);
}

function getKoreanWeekLabel(dateIso: string) {
  const d = toLocalDate(dateIso);
  const week = getWeekOfMonth(dateIso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${week}째주`;
}

function getWeekRange(dateIso: string) {
  const monday = getMonday(dateIso);
  const sunday = addDays(monday, 6);

  return {
    start: toIsoDate(monday),
    end: toIsoDate(sunday),
    label: `${monday.getMonth() + 1}/${monday.getDate()} ~ ${
      sunday.getMonth() + 1
    }/${sunday.getDate()}`,
  };
}

function makeDefaultScheduleRows(dateIso: string) {
  const monday = getMonday(dateIso);
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];

  return dayLabels.map((dayLabel, index) => {
    const d = addDays(monday, index);

    return {
      work_date: toIsoDate(d),
      day_label: dayLabel,
      start_time: index >= 5 ? "" : "09:00",
      end_time: index >= 5 ? "" : "18:00",
      memo: index >= 5 ? "휴무" : "",
    };
  });
}

function formatDateTime(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
}

function badgeClass(s?: string | null) {
  if (!s) return "";
  if (["approved", "정상출근", "외근", "재택", "active"].includes(s)) {
    return "good";
  }
  if (["rejected", "반려", "inactive"].includes(s)) {
    return "bad";
  }
  return "warn";
}

async function fetchCurrentEmployee() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return { session: null, employee: null };

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  return { session, employee: data };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [consent, setConsent] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetchCurrentEmployee();
    setSession(r.session);
    setEmployee(r.employee);

    if (r.employee) {
      const { data } = await supabase
        .from("privacy_consents")
        .select("*")
        .eq("employee_id", r.employee.id)
        .eq("is_active", true)
        .maybeSingle();

      setConsent(data);
    } else {
      setConsent(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setEmployee(null);
    setConsent(null);
  }

  if (loading) return <div className="container">불러오는 중입니다.</div>;
  if (!session) return <LoginPage />;

  if (!employee) {
    return (
      <div className="container">
        <section className="card auth-card">
          <h1 className="card-title">직원 정보가 없습니다</h1>
          <p className="subtle">
            관리자 계정의 employees.user_id 연결을 확인해주세요.
          </p>
          <button className="button full" onClick={signOut}>
            로그아웃
          </button>
        </section>
      </div>
    );
  }

  if (!employee.is_active || employee.employment_status !== "active") {
    return <InactivePage signOut={signOut} />;
  }

  if (!consent) {
    return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;
  }

  const isAdmin = employee.role === "admin";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="logo">L</div>
            <div>
              <h1>러플 근태관리</h1>
              <p>
                {employee.name} · {isAdmin ? "관리자" : "직원"} · 기기{" "}
                {employee.device_limit ?? 3}대
              </p>
            </div>
          </div>
          <button className="button ghost" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="container">
        <nav className="tabs">
          <button
            className={`tab ${tab === "home" ? "active" : ""}`}
            onClick={() => setTab("home")}
          >
            출퇴근
          </button>
          <button
            className={`tab ${tab === "leave" ? "active" : ""}`}
            onClick={() => setTab("leave")}
          >
            연차·대체휴가
          </button>
          <button
            className={`tab ${tab === "workplaces" ? "active" : ""}`}
            onClick={() => setTab("workplaces")}
          >
            근무지
          </button>
          {isAdmin && (
            <button
              className={`tab ${tab === "admin" ? "active" : ""}`}
              onClick={() => setTab("admin")}
            >
              관리자
            </button>
          )}
          {isAdmin && (
            <button
              className={`tab ${tab === "reports" ? "active" : ""}`}
              onClick={() => setTab("reports")}
            >
              보고서
            </button>
          )}
          {isAdmin && (
            <button
              className={`tab ${tab === "payrollSchedule" ? "active" : ""}`}
              onClick={() => setTab("payrollSchedule")}
            >
              급여·스케줄
            </button>
          )}
        </nav>

        {tab === "home" && <HomePage employee={employee} />}
        {tab === "leave" && <LeavePage employee={employee} />}
        {tab === "workplaces" && <WorkplacePage employee={employee} />}
        {tab === "admin" && isAdmin && <AdminPage />}
        {tab === "reports" && isAdmin && <ReportsPage />}
        {tab === "payrollSchedule" && isAdmin && (
          <PayrollSchedulePage employee={employee} />
        )}
      </main>
    </div>
  );
}

function LoginPage() {
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function login() {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: internalEmail(employeeNo),
      password,
    });

    if (error) setMessage("사번 또는 비밀번호를 확인해주세요.");
  }

  return (
    <div className="container">
      <section className="card auth-card">
        <div className="logo" style={{ marginBottom: 18 }}>
          L
        </div>
        <h1 className="card-title">러플 근태관리 로그인</h1>
        <p className="subtle">
          관리자가 생성한 사번으로 로그인합니다. 초기 비밀번호는 lupl +
          휴대폰 뒷번호 4자리입니다.
        </p>
        {message && <div className="alert error">{message}</div>}
        <div className="form-row">
          <label className="label">사번</label>
          <input
            className="input"
            value={employeeNo}
            onChange={(e) => setEmployeeNo(e.target.value)}
            placeholder="예: 20220612001"
          />
        </div>
        <div className="form-row">
          <label className="label">비밀번호</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="button full" onClick={login}>
          로그인
        </button>
      </section>
    </div>
  );
}

function InactivePage({ signOut }: { signOut: () => void }) {
  return (
    <div className="container">
      <section className="card auth-card">
        <h1 className="card-title">비활성 계정입니다</h1>
        <p className="subtle">
          관리자에게 계정 활성화를 요청해주세요. 기존 근태 기록은 보존됩니다.
        </p>
        <button className="button full" onClick={signOut}>
          로그아웃
        </button>
      </section>
    </div>
  );
}

function ConsentGate({
  employee,
  onDone,
  signOut,
}: {
  employee: any;
  onDone: () => void;
  signOut: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [msg, setMsg] = useState("");

  function ctx() {
    const c = canvasRef.current;
    if (!c) return null;
    const x = c.getContext("2d");
    if (!x) return null;
    x.lineWidth = 2.4;
    x.lineCap = "round";
    x.strokeStyle = "#111827";
    return x;
  }

  function point(e: any) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const p = e.touches?.[0] ?? e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }

  function start(e: any) {
    setDrawing(true);
    const c = ctx();
    const p = point(e);
    c?.beginPath();
    c?.moveTo(p.x, p.y);
  }

  function move(e: any) {
    if (!drawing) return;
    e.preventDefault();
    const c = ctx();
    const p = point(e);
    c?.lineTo(p.x, p.y);
    c?.stroke();
  }

  function end() {
    setDrawing(false);
  }

  function clear() {
    const c = canvasRef.current;
    const x = ctx();
    if (c && x) x.clearRect(0, 0, c.width, c.height);
  }

  async function submit() {
    setMsg("");
    if (!agree1 || !agree2) return setMsg("동의 항목을 모두 체크해주세요.");
    const canvas = canvasRef.current;
    const signature = canvas?.toDataURL("image/png");
    if (!signature || signature.length < 1200) return setMsg("서명을 입력해주세요.");

    const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

    const { error } = await supabase.from("privacy_consents").insert({
      employee_id: employee.id,
      consent_location: true,
      consent_device: true,
      consent_version: "2026-01",
      signature_data: signature,
      device_fingerprint_hash: fingerprintHash,
      device_info: deviceInfo,
      is_active: true,
    });

    if (error) setMsg(error.message);
    else onDone();
  }

  return (
    <div className="container">
      <section className="card" style={{ maxWidth: 860, margin: "28px auto" }}>
        <h1 className="card-title">개인정보 수집·이용 및 위치정보 동의서</h1>
        <p className="subtle">
          주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를
          수집·이용합니다.
        </p>
        <div className="alert" style={{ marginTop: 16 }}>
          위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며,
          실시간 위치 추적은 하지 않습니다.
        </div>
        {msg && <div className="alert error">{msg}</div>}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={agree1}
            onChange={(e) => setAgree1(e.target.checked)}
          />{" "}
          개인정보 및 위치정보 수집·이용에 동의합니다.
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={agree2}
            onChange={(e) => setAgree2(e.target.checked)}
          />{" "}
          위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을
          확인했습니다.
        </label>
        <div style={{ marginTop: 18 }}>
          <label className="label">서명</label>
          <canvas
            ref={canvasRef}
            width={760}
            height={180}
            className="signature-pad"
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button" onClick={submit}>
            동의하고 시작
          </button>
          <button className="button secondary" onClick={clear}>
            서명 다시 쓰기
          </button>
          <button className="button ghost" onClick={signOut}>
            로그아웃
          </button>
        </div>
      </section>
    </div>
  );
}

function HomePage({ employee }: { employee: any }) {
  const [now, setNow] = useState(new Date());
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("");
  const [todayLog, setTodayLog] = useState<any | null>(null);
  const [breakLog, setBreakLog] = useState<any | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [detectedPlace, setDetectedPlace] = useState<any | null>(null);
  const [unknownPlaceName, setUnknownPlaceName] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    const { data: places } = await supabase
      .from("workplaces")
      .select("*")
      .neq("approval_status", "rejected")
      .eq("is_active", true)
      .order("name");

    setWorkplaces(places ?? []);

    const { data: logs } = await supabase
      .from("attendance_logs")
      .select("*, workplaces(name,type)")
      .eq("employee_id", employee.id)
      .gte("check_in_time", `${todayIso()}T00:00:00`)
      .order("created_at", { ascending: false })
      .limit(1);

    const log = logs?.[0] ?? null;
    setTodayLog(log);

    if (log?.id && !log.check_out_time) {
      const { data: br } = await supabase
        .from("break_logs")
        .select("*")
        .eq("attendance_log_id", log.id)
        .is("break_end", null)
        .maybeSingle();

      setBreakLog(br);
    } else {
      setBreakLog(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function detectPlace(lat: number, lng: number, ip: string | null) {
    const approved = workplaces.filter(
      (w) => w.approval_status === "approved" && w.lat != null && w.lng != null
    );

    const withDistance = approved.map((w) => ({
      ...w,
      distance: distanceMeters(lat, lng, w.lat, w.lng),
    }));

    const gps = withDistance
      .sort((a, b) => a.distance - b.distance)
      .find((w) => w.distance <= (w.radius_m ?? 100));

    if (gps) return gps;
    if (ip) return approved.find((w) => w.ip_hint && w.ip_hint === ip) || null;
    return null;
  }

  async function checkIn() {
    setBusy(true);
    setMessage("현재 위치를 확인하는 중입니다.");
    setDetectedPlace(null);

    try {
      const p = await getCurrentPositionFast();
      const ip = await getPublicIp();
      const d = await detectPlace(p.lat, p.lng, ip);

      if (d) {
        setDetectedPlace({ ...d, currentLat: p.lat, currentLng: p.lng, ip });
        setSelectedWorkplaceId(d.id);
        setMessage(
          `${d.name} 근처로 확인되었습니다. 이 장소가 맞으면 출근 확정을 눌러주세요.`
        );
      } else {
        setDetectedPlace({ currentLat: p.lat, currentLng: p.lng, ip });
        setSelectedWorkplaceId("");
        setMessage(
          "등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다."
        );
      }
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCheckIn() {
    setBusy(true);
    setMessage("");

    try {
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
      let workplaceId = selectedWorkplaceId;

      if (!workplaceId && unknownPlaceName && detectedPlace?.currentLat) {
        const { data: newPlace, error: placeError } = await supabase
          .from("workplaces")
          .insert({
            name: unknownPlaceName,
            type: "other_field",
            lat: detectedPlace.currentLat,
            lng: detectedPlace.currentLng,
            ip_hint: detectedPlace.ip,
            radius_m: 100,
            approval_status: "pending",
            requested_by: employee.id,
          })
          .select()
          .single();

        if (placeError) throw placeError;
        workplaceId = newPlace.id;
      }

      if (!workplaceId) {
        throw new Error("근무지 선택 또는 현재 장소명 입력이 필요합니다.");
      }

      const { data, error } = await supabase.rpc("check_in", {
        p_workplace_id: workplaceId,
        p_lat: detectedPlace?.currentLat ?? null,
        p_lng: detectedPlace?.currentLng ?? null,
        p_accuracy_m: null,
        p_ip_address: detectedPlace?.ip ?? null,
        p_device_fingerprint_hash: fingerprintHash,
        p_device_info: deviceInfo,
      });

      if (error) throw error;

      setMessage(`출근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
      setDetectedPlace(null);
      setUnknownPlaceName("");
      setSelectedWorkplaceId("");
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setMessage("퇴근 위치를 확인하는 중입니다.");

    try {
      const p = await getCurrentPositionFast();
      const ip = await getPublicIp();
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

      const { data, error } = await supabase.rpc("check_out", {
        p_lat: p.lat,
        p_lng: p.lng,
        p_accuracy_m: p.accuracy,
        p_ip_address: ip,
        p_device_fingerprint_hash: fingerprintHash,
        p_device_info: deviceInfo,
      });

      if (error) throw error;

      setMessage(`퇴근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startBreak() {
    if (!todayLog?.id) return setMessage("출근 기록이 없습니다.");

    const { error } = await supabase.from("break_logs").insert({
      attendance_log_id: todayLog.id,
      employee_id: employee.id,
    });

    if (error) setMessage(error.message);
    else {
      setMessage("휴게 시작 처리되었습니다.");
      await load();
    }
  }

  async function endBreak() {
    if (!breakLog?.id) return setMessage("진행 중인 휴게가 없습니다.");

    const { error } = await supabase
      .from("break_logs")
      .update({ break_end: new Date().toISOString() })
      .eq("id", breakLog.id);

    if (error) setMessage(error.message);
    else {
      setMessage("휴게 종료 처리되었습니다.");
      await load();
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <p className="subtle">
          {now.toLocaleDateString("ko-KR", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <div className="clock">
          {now.toLocaleTimeString("ko-KR", { hour12: false })}
        </div>

        <div className="punch-grid">
          <button
            className="button punch"
            disabled={busy || !!todayLog?.check_in_time}
            onClick={checkIn}
          >
            출근하기
          </button>
          <button
            className="button secondary punch"
            disabled={busy || !todayLog?.check_in_time || !!todayLog?.check_out_time}
            onClick={checkOut}
          >
            퇴근하기
          </button>
        </div>

        <div className="actions" style={{ marginTop: 12 }}>
          {!breakLog ? (
            <button
              className="button ghost"
              disabled={!todayLog || !!todayLog.check_out_time}
              onClick={startBreak}
            >
              휴게 시작
            </button>
          ) : (
            <button className="button ghost" onClick={endBreak}>
              휴게 종료
            </button>
          )}
        </div>

        {message && (
          <div className="alert" style={{ marginTop: 16 }}>
            {message}
          </div>
        )}

        {detectedPlace && (
          <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
            {detectedPlace.id ? (
              <>
                <h3 className="card-title">{detectedPlace.name} 맞나요?</h3>
                <p className="subtle">
                  GPS/IP 기준으로 가장 가까운 승인 근무지를 찾았습니다.
                </p>
              </>
            ) : (
              <>
                <h3 className="card-title">현재 장소를 입력해주세요</h3>
                <p className="subtle">
                  입력한 장소는 관리자 승인 대기 근무지로 저장됩니다.
                </p>
                <input
                  className="input"
                  value={unknownPlaceName}
                  onChange={(e) => setUnknownPlaceName(e.target.value)}
                  placeholder="예: 사무실, 대구○○학교, ○○교육장"
                />
              </>
            )}

            <div className="actions" style={{ marginTop: 12 }}>
              <button className="button" onClick={confirmCheckIn}>
                출근 확정
              </button>
              <button
                className="button ghost"
                onClick={() => setDetectedPlace(null)}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">오늘 근무 요약</h2>
        <div className="grid two">
          <div className="metric">
            <div className="metric-value">
              {todayLog?.check_in_time
                ? formatDateTime(todayLog.check_in_time).split(" ").slice(-1)[0]
                : "-"}
            </div>
            <div className="metric-label">출근</div>
          </div>
          <div className="metric">
            <div className="metric-value">
              {todayLog?.check_out_time
                ? formatDateTime(todayLog.check_out_time).split(" ").slice(-1)[0]
                : "-"}
            </div>
            <div className="metric-label">퇴근</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <span className={`badge ${badgeClass(todayLog?.status)}`}>
            {todayLog?.status ?? "기록 없음"}
          </span>
          <p className="subtle">근무지: {todayLog?.workplaces?.name ?? "-"}</p>
          <p className="subtle">기기 상태: {todayLog?.device_status ?? "-"}</p>
          <p className="subtle">휴게 상태: {breakLog ? "휴게 중" : "휴게 아님"}</p>
        </div>
      </section>
    </div>
  );
}

function LeavePage({ employee }: { employee: any }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);
  const [form, setForm] = useState({
    request_type: "annual",
    start_date: todayIso(),
    end_date: todayIso(),
    amount_hours: "",
    reason: "",
  });
  const [compForm, setCompForm] = useState({
    work_date: todayIso(),
    start_time: "18:00",
    end_time: "20:00",
    hours: 2,
    reason: "",
  });
  const [message, setMessage] = useState("");

  async function load() {
    const [r, a, c] = await Promise.all([
      supabase
        .from("attendance_requests")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("leave_adjustments")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("comp_time_requests")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false }),
    ]);

    setRequests(r.data ?? []);
    setAdjustments(a.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  const ent = calculateLeaveEntitlement(employee.joined_at);
  const adj = calculateAdjustmentDays(adjustments);
  const compEarned = calculateCompTimeEarnedDays(adjustments);
  const approvedUsed = calculateUsedDays(requests, false);
  const pendingUsed = calculateUsedDays(requests, true);
  const totalGranted = ent.baseGrantedDays + adj;
  const remaining = Math.max(0, totalGranted - approvedUsed);
  const expectedRemaining = Math.max(0, totalGranted - pendingUsed);

  async function submitLeave() {
    setMessage("");

    const amountHours =
      form.request_type === "hourly" && form.amount_hours
        ? Number(form.amount_hours)
        : null;

    const requestedDays =
      form.request_type === "hourly"
        ? Number(form.amount_hours || 0) / 8
        : form.request_type === "half_am" || form.request_type === "half_pm"
        ? 0.5
        : 1;

    if (
      ["annual", "half_am", "half_pm", "hourly", "comp_leave_use"].includes(
        form.request_type
      ) &&
      requestedDays > expectedRemaining
    ) {
      return setMessage("잔여 휴가가 부족하여 신청할 수 없습니다.");
    }

    const { error } = await supabase.from("attendance_requests").insert({
      employee_id: employee.id,
      request_type: form.request_type,
      start_date: form.start_date,
      end_date: form.end_date,
      amount_hours: amountHours,
      amount_days: amountHours ? amountHours / 8 : null,
      reason: form.reason,
      status: "pending",
    });

    if (error) setMessage(error.message);
    else {
      setMessage("근태 신청이 저장되었습니다.");
      await load();
    }
  }

  async function submitCompTime() {
    setMessage("");
    if (!compForm.hours || compForm.hours <= 0) {
      return setMessage("추가 근무 시간을 입력해주세요.");
    }

    const { error } = await supabase.from("comp_time_requests").insert({
      employee_id: employee.id,
      work_date: compForm.work_date,
      start_time: compForm.start_time,
      end_time: compForm.end_time,
      hours: compForm.hours,
      converted_days: Number((compForm.hours / 8).toFixed(2)),
      reason: compForm.reason,
      status: "pending",
    });

    if (error) setMessage(error.message);
    else {
      setMessage(
        "추가 근무 대체휴가 적립 신청이 저장되었습니다. 관리자 승인 후 사용 가능합니다."
      );
      await load();
    }
  }

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="grid four">
        <div className="metric">
          <div className="metric-value">{totalGranted.toFixed(1)}</div>
          <div className="metric-label">총 사용 가능 휴가</div>
        </div>
        <div className="metric">
          <div className="metric-value">{approvedUsed.toFixed(1)}</div>
          <div className="metric-label">승인 사용</div>
        </div>
        <div className="metric">
          <div className="metric-value">{remaining.toFixed(1)}</div>
          <div className="metric-label">잔여</div>
        </div>
        <div className="metric">
          <div className="metric-value">{compEarned.toFixed(1)}</div>
          <div className="metric-label">추가근무 대체휴가 적립</div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">연차 현황</h2>
        <p className="subtle">
          근무 시작일: {employee.joined_at ?? "-"} · 기본 발생:{" "}
          {ent.baseGrantedDays}일 · 관리자/추가근무 조정: {adj.toFixed(1)}일 ·
          대기 포함 예상 잔여: {expectedRemaining.toFixed(1)}일
        </p>
        <p className="subtle">
          기준: {ent.description} · 산정기간 {ent.periodStart ?? "-"} ~{" "}
          {ent.periodEnd ?? "-"}
        </p>
      </section>

      <div className="grid two">
        <section className="card">
          <h2 className="card-title">휴가·근태 신청</h2>
          <div className="form-row">
            <label className="label">신청 유형</label>
            <select
              className="select"
              value={form.request_type}
              onChange={(e) => setForm({ ...form, request_type: e.target.value })}
            >
              {Object.entries(requestTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="grid two">
            <div className="form-row">
              <label className="label">시작일</label>
              <input
                className="input"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label className="label">종료일</label>
              <input
                className="input"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>

          {form.request_type === "hourly" && (
            <div className="form-row">
              <label className="label">시간차 사용 시간</label>
              <input
                className="input"
                type="number"
                step="0.5"
                value={form.amount_hours}
                onChange={(e) =>
                  setForm({ ...form, amount_hours: e.target.value })
                }
              />
            </div>
          )}

          <div className="form-row">
            <label className="label">사유</label>
            <textarea
              className="textarea"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </div>
          <button className="button full" onClick={submitLeave}>
            신청하기
          </button>
        </section>

        <section className="card">
          <h2 className="card-title">추가근무 대체휴가 적립 신청</h2>
          <p className="subtle">
            추가근무 수당 대신 휴가로 대체 적립합니다. 관리자 승인 후에만
            휴가 잔여에 추가됩니다. 환산 기준은 8시간 = 1일입니다.
          </p>

          <div className="form-row">
            <label className="label">추가근무일</label>
            <input
              className="input"
              type="date"
              value={compForm.work_date}
              onChange={(e) =>
                setCompForm({ ...compForm, work_date: e.target.value })
              }
            />
          </div>

          <div className="grid three">
            <div className="form-row">
              <label className="label">시작</label>
              <input
                className="input"
                type="time"
                value={compForm.start_time}
                onChange={(e) =>
                  setCompForm({ ...compForm, start_time: e.target.value })
                }
              />
            </div>
            <div className="form-row">
              <label className="label">종료</label>
              <input
                className="input"
                type="time"
                value={compForm.end_time}
                onChange={(e) =>
                  setCompForm({ ...compForm, end_time: e.target.value })
                }
              />
            </div>
            <div className="form-row">
              <label className="label">시간</label>
              <input
                className="input"
                type="number"
                step="0.5"
                value={compForm.hours}
                onChange={(e) =>
                  setCompForm({ ...compForm, hours: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="form-row">
            <label className="label">사유</label>
            <textarea
              className="textarea"
              value={compForm.reason}
              onChange={(e) =>
                setCompForm({ ...compForm, reason: e.target.value })
              }
              placeholder="예: 행사 운영, 외부 교육 연장 등"
            />
          </div>
          <button className="button full" onClick={submitCompTime}>
            대체휴가 적립 신청
          </button>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">신청 내역</h2>
        <DataTable
          rows={[
            ...requests.map((r) => ({
              구분: requestTypeLabels[r.request_type] ?? r.request_type,
              기간: `${r.start_date}~${r.end_date}`,
              환산: r.amount_days ?? "-",
              상태: r.status,
              사유: r.reason ?? "-",
            })),
            ...compRequests.map((r) => ({
              구분: "추가근무 대체휴가 적립",
              기간: r.work_date,
              환산: `${r.hours}시간 → ${r.converted_days}일`,
              상태: r.status,
              사유: r.reason ?? "-",
            })),
          ]}
        />
      </section>
    </div>
  );
}

function WorkplacePage({ employee }: { employee: any }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const { data } = await supabase
      .from("workplaces")
      .select("*, requester:employees(name)")
      .order("created_at", { ascending: false });

    setWorkplaces(data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function search() {
    const { data, error } = await supabase.functions.invoke("kakao-place-search", {
      body: { query },
    });

    if (error) setMessage(error.message);
    else setPlaces(data?.documents ?? []);
  }

  async function requestPlace(p: any) {
    const { error } = await supabase.from("workplaces").insert({
      name: p.place_name,
      type: "special_school",
      address: p.road_address_name || p.address_name,
      kakao_place_id: p.id,
      lat: Number(p.y),
      lng: Number(p.x),
      radius_m: 100,
      approval_status: "pending",
      requested_by: employee.id,
    });

    if (error) setMessage(error.message);
    else {
      setMessage("근무지 승인 요청이 저장되었습니다.");
      setPlaces([]);
      setQuery("");
      await load();
    }
  }

  const grouped = {
    approved: workplaces.filter((w) => w.approval_status === "approved"),
    pending: workplaces.filter((w) => w.approval_status === "pending"),
    rejected: workplaces.filter((w) => w.approval_status === "rejected"),
  };

  return (
    <div className="grid two">
      <section className="card">
        <h2 className="card-title">근무지 검색·요청</h2>
        <p className="subtle">
          카카오맵 검색으로 근무지를 등록 요청합니다. 승인이 완료되면 다음
          출근 시 자동 후보로 사용됩니다.
        </p>

        {message && <div className="alert">{message}</div>}

        <div className="form-row">
          <label className="label">근무지명</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 대구광명학교"
          />
        </div>

        <button className="button" onClick={search}>
          검색
        </button>

        <div className="grid" style={{ marginTop: 14 }}>
          {places.map((p) => (
            <div className="card" style={{ boxShadow: "none" }} key={p.id}>
              <b>{p.place_name}</b>
              <p className="subtle">{p.road_address_name || p.address_name}</p>
              <button className="button secondary" onClick={() => requestPlace(p)}>
                승인 요청
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">근무지 목록</h2>

        <h3>승인된 근무지</h3>
        <DataTable
          rows={grouped.approved.map((w) => ({
            이름: w.name,
            유형: workplaceTypeLabels[w.type],
            반경: `${w.radius_m}m`,
            요청자: w.requester?.name ?? "-",
          }))}
        />

        <h3>승인 대기</h3>
        <DataTable
          rows={grouped.pending.map((w) => ({
            이름: w.name,
            유형: workplaceTypeLabels[w.type],
            반경: `${w.radius_m}m`,
            요청자: w.requester?.name ?? "-",
          }))}
        />

        <h3>반려</h3>
        <DataTable
          rows={grouped.rejected.map((w) => ({
            이름: w.name,
            유형: workplaceTypeLabels[w.type],
            반경: `${w.radius_m}m`,
            요청자: w.requester?.name ?? "-",
          }))}
        />
      </section>
    </div>
  );
}

function AdminPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState("active");
  const [devices, setDevices] = useState<any[]>([]);
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [newEmployee, setNewEmployee] = useState({
    name: "",
    employee_no: "",
    phone: "",
    joined_at: todayIso(),
    role: "employee",
    device_limit: 3,
  });

  async function load() {
    const [e, d, w, r, c] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", {
        ascending: false,
      }),
      supabase
        .from("registered_devices")
        .select("*, employees(name, employee_no)")
        .order("created_at", { ascending: false }),
      supabase
        .from("workplaces")
        .select("*, requester:employees(name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("attendance_requests")
        .select("*, employees(name, employee_no)")
        .order("created_at", { ascending: false }),
      supabase
        .from("comp_time_requests")
        .select("*, employees(name, employee_no)")
        .order("created_at", { ascending: false }),
    ]);

    setEmployees(e.data ?? []);
    setDevices(d.data ?? []);
    setWorkplaces(w.data ?? []);
    setRequests(r.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function createEmployee() {
    setMessage("");
    const { data, error } = await supabase.functions.invoke(
      "admin-create-employee",
      { body: newEmployee }
    );

    if (error) setMessage(error.message);
    else if (data?.error) setMessage(data.error);
    else {
      setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);
      setNewEmployee({
        name: "",
        employee_no: "",
        phone: "",
        joined_at: todayIso(),
        role: "employee",
        device_limit: 3,
      });
      await load();
    }
  }

  async function updateEmployee(id: string, patch: Record<string, any>) {
    const { error } = await supabase.from("employees").update(patch).eq("id", id);
    if (error) setMessage(error.message);
    else await load();
  }

  async function toggleEmployee(id: string, currentStatus: string) {
    const nextActive = currentStatus !== "active";
    await updateEmployee(id, {
      is_active: nextActive,
      employment_status: nextActive ? "active" : "inactive",
    });
  }

  async function reviewWorkplace(id: string, status: string) {
    const { error } = await supabase
      .from("workplaces")
      .update({ approval_status: status, is_active: status === "approved" })
      .eq("id", id);

    if (error) setMessage(error.message);
    else await load();
  }

  async function reviewRequest(id: string, status: string) {
    const { error } = await supabase.rpc("review_attendance_request", {
      p_request_id: id,
      p_status: status,
      p_review_note: "",
    });

    if (error) setMessage(error.message);
    else await load();
  }

  async function reviewCompRequest(id: string, status: string) {
    const { error } = await supabase.rpc("review_comp_time_request", {
      p_request_id: id,
      p_status: status,
      p_review_note: "",
    });

    if (error) setMessage(error.message);
    else {
      setMessage(
        status === "approved"
          ? "추가근무 대체휴가가 승인되어 휴가 잔여에 추가되었습니다."
          : "추가근무 대체휴가 신청을 반려했습니다."
      );
      await load();
    }
  }

  async function reviewDevice(id: string, status: string) {
    const { error } = await supabase
      .from("registered_devices")
      .update({ status })
      .eq("id", id);

    if (error) setMessage(error.message);
    else await load();
  }

  const filteredEmployees = employees.filter((e) =>
    employeeFilter === "all"
      ? true
      : employeeFilter === "inactive"
      ? e.employment_status !== "active"
      : e.employment_status === "active"
  );

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="card">
        <h2 className="card-title">직원 계정 생성</h2>
        <div className="grid four">
          <div className="form-row">
            <label className="label">이름</label>
            <input
              className="input"
              value={newEmployee.name}
              onChange={(e) =>
                setNewEmployee({ ...newEmployee, name: e.target.value })
              }
            />
          </div>
          <div className="form-row">
            <label className="label">사번</label>
            <input
              className="input"
              value={newEmployee.employee_no}
              onChange={(e) =>
                setNewEmployee({ ...newEmployee, employee_no: e.target.value })
              }
            />
          </div>
          <div className="form-row">
            <label className="label">휴대폰</label>
            <input
              className="input"
              value={newEmployee.phone}
              onChange={(e) =>
                setNewEmployee({ ...newEmployee, phone: e.target.value })
              }
              placeholder="010-0000-0000"
            />
          </div>
          <div className="form-row">
            <label className="label">근무 시작일</label>
            <input
              className="input"
              type="date"
              value={newEmployee.joined_at}
              onChange={(e) =>
                setNewEmployee({ ...newEmployee, joined_at: e.target.value })
              }
            />
          </div>
        </div>
        <button className="button" onClick={createEmployee}>
          직원 생성
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">직원 관리</h2>
        <div className="tabs">
          <button
            className={`tab ${employeeFilter === "active" ? "active" : ""}`}
            onClick={() => setEmployeeFilter("active")}
          >
            재직 직원
          </button>
          <button
            className={`tab ${employeeFilter === "inactive" ? "active" : ""}`}
            onClick={() => setEmployeeFilter("inactive")}
          >
            비활성 직원
          </button>
          <button
            className={`tab ${employeeFilter === "all" ? "active" : ""}`}
            onClick={() => setEmployeeFilter("all")}
          >
            전체
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>직원</th>
                <th>권한</th>
                <th>상태</th>
                <th>근무 시작일</th>
                <th>기기 제한</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.name}
                    <br />
                    <span className="subtle">
                      {e.employee_no} · {e.phone}
                    </span>
                  </td>
                  <td>
                    <select
                      className="select"
                      value={e.role}
                      onChange={(ev) =>
                        updateEmployee(e.id, { role: ev.target.value })
                      }
                    >
                      <option value="admin">관리자</option>
                      <option value="employee">직원</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${badgeClass(e.employment_status)}`}>
                      {e.employment_status}
                    </span>
                  </td>
                  <td>
                    <input
                      className="input"
                      type="date"
                      value={e.joined_at ?? ""}
                      onChange={(ev) =>
                        updateEmployee(e.id, { joined_at: ev.target.value })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={e.device_limit}
                      onChange={(ev) =>
                        updateEmployee(e.id, {
                          device_limit: Number(ev.target.value),
                        })
                      }
                    >
                      <option value={1}>1대</option>
                      <option value={2}>2대</option>
                      <option value={3}>3대</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className={
                        e.employment_status === "active"
                          ? "button danger"
                          : "button secondary"
                      }
                      onClick={() => toggleEmployee(e.id, e.employment_status)}
                    >
                      {e.employment_status === "active" ? "비활성화" : "활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">승인 대기</h2>
        <div className="grid two">
          <div>
            <h3>근무지 승인</h3>
            {workplaces
              .filter((w) => w.approval_status !== "approved")
              .map((w) => (
                <div className="actions" key={w.id} style={{ marginBottom: 10 }}>
                  <b>{w.name}</b>
                  <span className={`badge ${badgeClass(w.approval_status)}`}>
                    {w.approval_status}
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => reviewWorkplace(w.id, "approved")}
                  >
                    근무지 확정
                  </button>
                  <button
                    className="button danger"
                    onClick={() => reviewWorkplace(w.id, "rejected")}
                  >
                    반려
                  </button>
                </div>
              ))}
          </div>

          <div>
            <h3>추가근무 대체휴가 적립 승인</h3>
            {compRequests
              .filter((r) => r.status === "pending")
              .map((r) => (
                <div className="actions" key={r.id} style={{ marginBottom: 10 }}>
                  <b>
                    {r.employees?.name} · {r.hours}h → {r.converted_days}일
                  </b>
                  <button
                    className="button secondary"
                    onClick={() => reviewCompRequest(r.id, "approved")}
                  >
                    승인
                  </button>
                  <button
                    className="button danger"
                    onClick={() => reviewCompRequest(r.id, "rejected")}
                  >
                    반려
                  </button>
                </div>
              ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">근태·기기 승인</h2>

        <h3>근태 신청</h3>
        <div className="grid">
          {requests
            .filter((r) => r.status === "pending")
            .map((r) => (
              <div className="actions" key={r.id}>
                <b>
                  {r.employees?.name} ·{" "}
                  {requestTypeLabels[r.request_type] ?? r.request_type}
                </b>
                <button
                  className="button secondary"
                  onClick={() => reviewRequest(r.id, "approved")}
                >
                  승인
                </button>
                <button
                  className="button danger"
                  onClick={() => reviewRequest(r.id, "rejected")}
                >
                  반려
                </button>
              </div>
            ))}
        </div>

        <h3>기기 승인</h3>
        <div className="grid">
          {devices
            .filter((d) => d.status === "pending")
            .map((d) => (
              <div className="actions" key={d.id}>
                <b>
                  {d.employees?.name} · {d.device_info?.platform}
                </b>
                <button
                  className="button secondary"
                  onClick={() => reviewDevice(d.id, "approved")}
                >
                  승인
                </button>
                <button
                  className="button danger"
                  onClick={() => reviewDevice(d.id, "rejected")}
                >
                  반려
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function ReportsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);

  async function load() {
    const [l, c] = await Promise.all([
      supabase
        .from("attendance_logs")
        .select("*, employees(name, employee_no), workplaces(name,type)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("comp_time_requests")
        .select("*, employees(name, employee_no)")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    setLogs(l.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function downloadAll() {
    exportRowsToExcel(
      "lupl_attendance_report.xlsx",
      "근태",
      logs.map((l) => ({
        직원: l.employees?.name,
        사번: l.employees?.employee_no,
        근무지: l.workplaces?.name,
        유형: workplaceTypeLabels[l.workplaces?.type] ?? "-",
        출근: formatDateTime(l.check_in_time),
        퇴근: formatDateTime(l.check_out_time),
        상태: l.status,
        기기: l.device_status,
      }))
    );
  }

  function downloadComp() {
    exportRowsToExcel(
      "lupl_comp_time_report.xlsx",
      "추가근무대체휴가",
      compRequests.map((r) => ({
        직원: r.employees?.name,
        사번: r.employees?.employee_no,
        근무일: r.work_date,
        시간: r.hours,
        적립일수: r.converted_days,
        상태: r.status,
        사유: r.reason,
      }))
    );
  }

  const fieldLogs = logs.filter((l) =>
    ["special_school", "external_education", "other_field"].includes(
      l.workplaces?.type
    )
  );

  const exceptions = logs.filter(
    (l) =>
      ["위치 확인 필요", "기기 확인 필요", "관리자 확인 필요", "자동 퇴근 후보"].includes(
        l.status
      ) || !l.check_out_time
  );

  return (
    <div className="grid">
      <section className="grid four">
        <div className="metric">
          <div className="metric-value">{logs.length}</div>
          <div className="metric-label">전체 근태</div>
        </div>
        <div className="metric">
          <div className="metric-value">{fieldLogs.length}</div>
          <div className="metric-label">외근</div>
        </div>
        <div className="metric">
          <div className="metric-value">{exceptions.length}</div>
          <div className="metric-label">예외</div>
        </div>
        <div className="metric">
          <div className="metric-value">
            {compRequests
              .filter((r) => r.status === "approved")
              .reduce((s, r) => s + Number(r.converted_days || 0), 0)
              .toFixed(1)}
          </div>
          <div className="metric-label">대체휴가 적립</div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">보고서 다운로드</h2>
        <div className="actions">
          <button className="button" onClick={downloadAll}>
            월별 전체 근태 Excel
          </button>
          <button className="button secondary" onClick={downloadComp}>
            추가근무 대체휴가 Excel
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">예외함</h2>
        <DataTable
          rows={exceptions.map((l) => ({
            직원: l.employees?.name,
            근무지: l.workplaces?.name,
            출근: formatDateTime(l.check_in_time),
            퇴근: formatDateTime(l.check_out_time),
            상태: l.status,
          }))}
        />
      </section>
    </div>
  );
}

function PayrollSchedulePage({ employee }: { employee: any }) {
  const [salaryText, setSalaryText] = useState("2,500,000");
  const [deductionRateText, setDeductionRateText] = useState("9.4");
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [scheduleRows, setScheduleRows] = useState<any[]>(
    makeDefaultScheduleRows(todayIso())
  );
  const [message, setMessage] = useState("");

  const monthlySalary = parseMoney(salaryText);
  const deductionRate = Number(deductionRateText) || 0;
  const expectedDeduction = monthlySalary * (deductionRate / 100);
  const expectedNetPay = monthlySalary - expectedDeduction;
  const week = getWeekRange(selectedDate);
  const weekLabel = getKoreanWeekLabel(selectedDate);

  async function loadSchedule(dateIso = selectedDate) {
    const range = getWeekRange(dateIso);

    const { data, error } = await supabase
      .from("weekly_schedules")
      .select("*")
      .gte("work_date", range.start)
      .lte("work_date", range.end)
      .order("work_date", { ascending: true });

    if (error) {
      setMessage(error.message);
      setScheduleRows(makeDefaultScheduleRows(dateIso));
      return;
    }

    if (data && data.length > 0) {
      const defaults = makeDefaultScheduleRows(dateIso);
      const merged = defaults.map((row) => {
        const saved = data.find((item) => item.work_date === row.work_date);
        return saved
          ? {
              work_date: saved.work_date,
              day_label: saved.day_label,
              start_time: saved.start_time ?? "",
              end_time: saved.end_time ?? "",
              memo: saved.memo ?? "",
            }
          : row;
      });

      setScheduleRows(merged);
    } else {
      setScheduleRows(makeDefaultScheduleRows(dateIso));
    }
  }

  useEffect(() => {
    loadSchedule(selectedDate);
  }, [selectedDate]);

  function updateScheduleRow(index: number, patch: Record<string, any>) {
    setScheduleRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function saveSchedule() {
    setMessage("");

    const payload = scheduleRows.map((row) => ({
      week_start: week.start,
      work_date: row.work_date,
      day_label: row.day_label,
      start_time: row.start_time || null,
      end_time: row.end_time || null,
      memo: row.memo || null,
      created_by: employee.id,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("weekly_schedules")
      .upsert(payload, { onConflict: "work_date" });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(`${weekLabel} 주간 스케줄이 저장되었습니다.`);
      await loadSchedule(selectedDate);
    }
  }

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="grid two">
        <section className="card">
          <h2 className="card-title">급여 계산</h2>
          <p className="subtle">
            월급 입력값과 예시 금액은 천단위 쉼표로 표시됩니다.
          </p>

          <div className="form-row">
            <label className="label">월급</label>
            <input
              className="input"
              value={salaryText}
              onChange={(e) => setSalaryText(formatMoneyInput(e.target.value))}
              placeholder="예: 2,500,000"
            />
          </div>

          <div className="form-row">
            <label className="label">예상 공제율(%)</label>
            <input
              className="input"
              type="number"
              step="0.1"
              value={deductionRateText}
              onChange={(e) => setDeductionRateText(e.target.value)}
              placeholder="예: 9.4"
            />
          </div>

          <div className="grid three">
            <div className="metric">
              <div className="metric-value">{formatNumber(monthlySalary)}</div>
              <div className="metric-label">월급 예시</div>
            </div>
            <div className="metric">
              <div className="metric-value">{formatNumber(expectedDeduction)}</div>
              <div className="metric-label">예상 공제</div>
            </div>
            <div className="metric">
              <div className="metric-value">{formatNumber(expectedNetPay)}</div>
              <div className="metric-label">예상 실수령</div>
            </div>
          </div>

          <div className="alert" style={{ marginTop: 16 }}>
            예시: 월급 {formatNumber(monthlySalary)}원 기준, 예상 공제액은{" "}
            {formatNumber(expectedDeduction)}원, 예상 실수령액은{" "}
            {formatNumber(expectedNetPay)}원입니다.
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">주간 스케줄 변경</h2>
          <p className="subtle">
            날짜를 선택하면 해당 날짜가 포함된 주차가 표시되며, 이번주 외 다른
            주도 변경할 수 있습니다.
          </p>

          <div className="form-row">
            <label className="label">변경할 주 기준 날짜</label>
            <input
              className="input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          <div className="alert">
            선택된 주: <b>{weekLabel}</b>
            <br />
            기간: {week.label}
          </div>

          <button className="button" onClick={saveSchedule}>
            이 주 스케줄 저장
          </button>
        </section>
      </section>

      <section className="card">
        <h2 className="card-title">{weekLabel} 스케줄</h2>
        <p className="subtle">
          날짜별 출근/퇴근 시간을 수정하고 저장하면 해당 주 스케줄로 기록됩니다.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>요일</th>
                <th>날짜</th>
                <th>출근</th>
                <th>퇴근</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((row, index) => (
                <tr key={row.work_date}>
                  <td>{row.day_label}</td>
                  <td>{row.work_date}</td>
                  <td>
                    <input
                      className="input"
                      type="time"
                      value={row.start_time ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { start_time: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="time"
                      value={row.end_time ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { end_time: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={row.memo ?? ""}
                      onChange={(e) =>
                        updateScheduleRow(index, { memo: e.target.value })
                      }
                      placeholder="예: 휴무, 외근, 단축근무"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button" onClick={saveSchedule}>
            {weekLabel} 저장
          </button>
          <button
            className="button ghost"
            onClick={() => setScheduleRows(makeDefaultScheduleRows(selectedDate))}
          >
            기본값으로 되돌리기
          </button>
        </div>
      </section>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, any>[] }) {
  if (!rows.length) return <p className="subtle">표시할 데이터가 없습니다.</p>;
  const cols = Object.keys(rows[0]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{String(row[c] ?? "-")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
그리고 현재장소 사무실 입력 RLS 오류랑 주간 스케줄 저장은 App.tsx만으로는 해결 안 됩니다.
Supabase SQL Editor에서 아래도 한 번 실행하셔야 합니다.

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.employees
  where user_id = auth.uid()
    and is_active = true
    and employment_status = 'active'
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees
    where user_id = auth.uid()
      and role = 'admin'
      and is_active = true
      and employment_status = 'active'
  );
$$;

alter table public.workplaces
add column if not exists requested_by uuid references public.employees(id);

alter table public.workplaces
add column if not exists is_active boolean default false;

alter table public.workplaces
add column if not exists approval_status text default 'pending';

alter table public.workplaces enable row level security;

drop policy if exists workplaces_select_visible on public.workplaces;
drop policy if exists workplaces_insert_pending_self on public.workplaces;
drop policy if exists workplaces_admin_update_all on public.workplaces;
drop policy if exists workplaces_admin_delete_all on public.workplaces;

create policy workplaces_select_visible
on public.workplaces
for select
to authenticated
using (
  public.is_admin()
  or is_active = true
  or requested_by = public.current_employee_id()
);

create policy workplaces_insert_pending_self
on public.workplaces
for insert
to authenticated
with check (
  public.is_admin()
  or requested_by = public.current_employee_id()
);

create policy workplaces_admin_update_all
on public.workplaces
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy workplaces_admin_delete_all
on public.workplaces
for delete
to authenticated
using (public.is_admin());

create table if not exists public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  work_date date not null,
  day_label text not null,
  start_time text,
  end_time text,
  memo text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_schedules_work_date_key
on public.weekly_schedules(work_date);

alter table public.weekly_schedules enable row level security;

drop policy if exists weekly_schedules_select_auth on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_insert on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_update on public.weekly_schedules;
drop policy if exists weekly_schedules_admin_delete on public.weekly_schedules;

create policy weekly_schedules_select_auth
on public.weekly_schedules
for select
to authenticated
using (true);

create policy weekly_schedules_admin_insert
on public.weekly_schedules
for insert
to authenticated
with check (public.is_admin());

create policy weekly_schedules_admin_update
on public.weekly_schedules
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy weekly_schedules_admin_delete
on public.weekly_schedules
for delete
to authenticated
using (public.is_admin());
1. 출근하기 누르니까 아직 퇴근 처리되지 않은 출근 기록이 있습니다. 이거 뜨는데 그러면 이 데이터를 확인하게 해줘야지. 

2. 휴게시작 버튼 없다가 왜 갑자기 생김 원래는 오늘의 출근 해서 외근 재택 정상출근 이렇게 있엇잖아. ㅡㅡ 그리고 그거 내용 해결하다가 왜 사라지냐고 

3. 흠 휴가에 왜 근무시간 수정 요청은 나옴 추가근무 대체휴가 사용은 또 왜나옴 그냥 시간차 휴가에 쓸 수 있게 해달라니까. 여기서 눌렀을 때 사용 가능 휴가 얼마나 있는지도 나오게 해줘. 

급여 스케줄 부분은 왜 갑자기 나옴.. 그리고 원래 있던 항목들 다 사라졌네.. 왜 그래.. 

원래 잇던거에서 내가 안된다고 하는 부분만 추가해줘야지. 다시 내가 보내준 app 내용으로 다시 돌려줘(sql 도 다시 확인해보고 ) 


import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
calculateAdjustmentDays,
calculateCompTimeEarnedDays,
calculateLeaveEntitlement,
calculateUsedDays,
} from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab = "home" | "leave" | "workplaces" | "admin" | "reports";

const workplaceTypeLabels: Record<string, string> = {
office: "사무실",
special_school: "특수학교",
external_education: "외부 교육장",
remote: "재택",
other_field: "기타 외근지",
};

const requestTypeLabels: Record<string, string> = {
annual: "연차",
half_am: "오전 반차",
half_pm: "오후 반차",
hourly: "시간차",
sick: "병가",
official: "공가",
remote: "재택",
field: "외근",
time_fix: "근무시간 수정 요청",
special: "특별휴가",
substitute: "대체휴가",
compensatory: "보상휴가",
comp_leave_use: "추가근무 대체휴가 사용",
};

function internalEmail(no: string) {
return ${no.trim().toLowerCase()}@lupl.local;
}

function todayIso() {
return new Date().toISOString().slice(0, 10);
}

function formatDateTime(v?: string | null) {
if (!v) return "-";
return new Intl.DateTimeFormat("ko-KR", {
dateStyle: "short",
timeStyle: "short",
}).format(new Date(v));
}

function badgeClass(s?: string | null) {
if (!s) return "";
if (["approved", "정상출근", "외근", "재택", "active"].includes(s)) return "good";
if (["rejected", "반려", "inactive"].includes(s)) return "bad";
return "warn";
}

async function fetchCurrentEmployee() {
const {
data: { session },
} = await supabase.auth.getSession();

if (!session?.user) return { session: null, employee: null };

const { data } = await supabase
.from("employees")
.select("*")
.eq("user_id", session.user.id)
.maybeSingle();

return { session, employee: data };
}

export default function App() {
const [session, setSession] = useState<Session | null>(null);
const [employee, setEmployee] = useState<any | null>(null);
const [consent, setConsent] = useState<any | null>(null);
const [tab, setTab] = useState("home");
const [loading, setLoading] = useState(true);

async function load() {
const r = await fetchCurrentEmployee();
setSession(r.session);
setEmployee(r.employee);

if (r.employee) {
  const { data } = await supabase
    .from("privacy_consents")
    .select("*")
    .eq("employee_id", r.employee.id)
    .eq("is_active", true)
    .maybeSingle();

  setConsent(data);
} else {
  setConsent(null);
}

setLoading(false);
}

useEffect(() => {
load();
const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
return () => data.subscription.unsubscribe();
}, []);

async function signOut() {
await supabase.auth.signOut();
setSession(null);
setEmployee(null);
setConsent(null);
}

if (loading) return 불러오는 중입니다.;
if (!session) return ;

if (!employee) {
return (


직원 정보가 없습니다
관리자 계정의 employees.user_id 연결을 확인해주세요.
로그아웃


);
}

if (!employee.is_active || employee.employment_status !== "active") {
return ;
}

if (!consent) return ;

const isAdmin = employee.role === "admin";

return (




L

러플 근태관리
{employee.name} · {isAdmin ? "관리자" : "직원"} · 기기 {employee.device_limit ?? 3}대


로그아웃



  <main className="container">
    <nav className="tabs">
      <button className={`tab ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>출퇴근</button>
      <button className={`tab ${tab === "leave" ? "active" : ""}`} onClick={() => setTab("leave")}>연차·대체휴가</button>
      <button className={`tab ${tab === "workplaces" ? "active" : ""}`} onClick={() => setTab("workplaces")}>근무지</button>
      {isAdmin && <button className={`tab ${tab === "admin" ? "active" : ""}`} onClick={() => setTab("admin")}>관리자</button>}
      {isAdmin && <button className={`tab ${tab === "reports" ? "active" : ""}`} onClick={() => setTab("reports")}>보고서</button>}
    </nav>

    {tab === "home" && <HomePage employee={employee} />}
    {tab === "leave" && <LeavePage employee={employee} />}
    {tab === "workplaces" && <WorkplacePage employee={employee} />}
    {tab === "admin" && isAdmin && <AdminPage />}
    {tab === "reports" && isAdmin && <ReportsPage />}
  </main>
</div>
);
}

function LoginPage() {
const [employeeNo, setEmployeeNo] = useState("");
const [password, setPassword] = useState("");
const [message, setMessage] = useState("");

async function login() {
setMessage("");
const { error } = await supabase.auth.signInWithPassword({
email: internalEmail(employeeNo),
password,
});

if (error) setMessage("사번 또는 비밀번호를 확인해주세요.");
}

return (


<div className="logo" style={{ marginBottom: 18 }}>L
러플 근태관리 로그인
관리자가 생성한 사번으로 로그인합니다. 초기 비밀번호는 lupl + 휴대폰 뒷번호 4자리입니다.
{message && {message}}

사번
<input className="input" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="예: 20220612001" />


비밀번호
<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

로그인


);
}

function InactivePage({ signOut }: { signOut: () => void }) {
return (


비활성 계정입니다
관리자에게 계정 활성화를 요청해주세요. 기존 근태 기록은 보존됩니다.
로그아웃


);
}

function ConsentGate({ employee, onDone, signOut }: { employee: any; onDone: () => void; signOut: () => void }) {
const canvasRef = useRef<HTMLCanvasElement | null>(null);
const [agree1, setAgree1] = useState(false);
const [agree2, setAgree2] = useState(false);
const [drawing, setDrawing] = useState(false);
const [msg, setMsg] = useState("");

function ctx() {
const c = canvasRef.current;
if (!c) return null;
const x = c.getContext("2d");
if (!x) return null;
x.lineWidth = 2.4;
x.lineCap = "round";
x.strokeStyle = "#111827";
return x;
}

function point(e: any) {
const c = canvasRef.current!;
const r = c.getBoundingClientRect();
const p = e.touches?.[0] ?? e;
return { x: p.clientX - r.left, y: p.clientY - r.top };
}

function start(e: any) {
setDrawing(true);
const c = ctx();
const p = point(e);
c?.beginPath();
c?.moveTo(p.x, p.y);
}

function move(e: any) {
if (!drawing) return;
e.preventDefault();
const c = ctx();
const p = point(e);
c?.lineTo(p.x, p.y);
c?.stroke();
}

function end() {
setDrawing(false);
}

function clear() {
const c = canvasRef.current;
const x = ctx();
if (c && x) x.clearRect(0, 0, c.width, c.height);
}

async function submit() {
setMsg("");
if (!agree1 || !agree2) return setMsg("동의 항목을 모두 체크해주세요.");
const canvas = canvasRef.current;
const signature = canvas?.toDataURL("image/png");
if (!signature || signature.length < 1200) return setMsg("서명을 입력해주세요.");

const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

const { error } = await supabase.from("privacy_consents").insert({
  employee_id: employee.id,
  consent_location: true,
  consent_device: true,
  consent_version: "2026-01",
  signature_data: signature,
  device_fingerprint_hash: fingerprintHash,
  device_info: deviceInfo,
  is_active: true,
});

if (error) setMsg(error.message);
else onDone();
}

return (

<section className="card" style={{ maxWidth: 860, margin: "28px auto" }}>
개인정보 수집·이용 및 위치정보 동의서
주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.
<div className="alert" style={{ marginTop: 16 }}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.
{msg && {msg}}
<input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} /> 개인정보 및 위치정보 수집·이용에 동의합니다.
<input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} /> 위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.
<div style={{ marginTop: 18 }}>
서명


<div className="actions" style={{ marginTop: 16 }}>
동의하고 시작
서명 다시 쓰기
로그아웃



);
}

function HomePage({ employee }: { employee: any }) {
const [now, setNow] = useState(new Date());
const [workplaces, setWorkplaces] = useState<any[]>([]);
const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("");
const [todayLog, setTodayLog] = useState<any | null>(null);
const [breakLog, setBreakLog] = useState<any | null>(null);
const [message, setMessage] = useState("");
const [busy, setBusy] = useState(false);
const [detectedPlace, setDetectedPlace] = useState<any | null>(null);
const [unknownPlaceName, setUnknownPlaceName] = useState("");

useEffect(() => {
const t = setInterval(() => setNow(new Date()), 1000);
return () => clearInterval(t);
}, []);

async function load() {
const { data: places } = await supabase.from("workplaces").select("*").neq("approval_status", "rejected").eq("is_active", true).order("name");
setWorkplaces(places ?? []);

const { data: logs } = await supabase
  .from("attendance_logs")
  .select("*, workplaces(name,type)")
  .eq("employee_id", employee.id)
  .gte("check_in_time", `${todayIso()}T00:00:00`)
  .order("created_at", { ascending: false })
  .limit(1);

const log = logs?.[0] ?? null;
setTodayLog(log);

if (log?.id && !log.check_out_time) {
  const { data: br } = await supabase.from("break_logs").select("*").eq("attendance_log_id", log.id).is("break_end", null).maybeSingle();
  setBreakLog(br);
} else {
  setBreakLog(null);
}
}

useEffect(() => { load(); }, []);

async function detectPlace(lat: number, lng: number, ip: string | null) {
const approved = workplaces.filter((w) => w.approval_status === "approved" && w.lat != null && w.lng != null);
const withDistance = approved.map((w) => ({ ...w, distance: distanceMeters(lat, lng, w.lat, w.lng) }));
const gps = withDistance.sort((a, b) => a.distance - b.distance).find((w) => w.distance <= (w.radius_m ?? 100));
if (gps) return gps;
if (ip) return approved.find((w) => w.ip_hint && w.ip_hint === ip) || null;
return null;
}

async function checkIn() {
setBusy(true);
setMessage("현재 위치를 확인하는 중입니다.");
setDetectedPlace(null);

try {
  const p = await getCurrentPositionFast();
  const ip = await getPublicIp();
  const d = await detectPlace(p.lat, p.lng, ip);

  if (d) {
    setDetectedPlace({ ...d, currentLat: p.lat, currentLng: p.lng, ip });
    setSelectedWorkplaceId(d.id);
    setMessage(`${d.name} 근처로 확인되었습니다. 이 장소가 맞으면 출근 확정을 눌러주세요.`);
  } else {
    setDetectedPlace({ currentLat: p.lat, currentLng: p.lng, ip });
    setMessage("등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다.");
  }
} catch (e: any) {
  setMessage(e.message);
} finally {
  setBusy(false);
}
}

async function confirmCheckIn() {
setBusy(true);
setMessage("");

try {
  const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
  let workplaceId = selectedWorkplaceId;

  if (!workplaceId && unknownPlaceName && detectedPlace?.currentLat) {
    const { data: newPlace, error: placeError } = await supabase
      .from("workplaces")
      .insert({
        name: unknownPlaceName,
        type: "other_field",
        lat: detectedPlace.currentLat,
        lng: detectedPlace.currentLng,
        ip_hint: detectedPlace.ip,
        radius_m: 100,
        approval_status: "pending",
        requested_by: employee.id,
      })
      .select()
      .single();

    if (placeError) throw placeError;
    workplaceId = newPlace.id;
  }

  if (!workplaceId) throw new Error("근무지 선택 또는 현재 장소명 입력이 필요합니다.");

  const { data, error } = await supabase.rpc("check_in", {
    p_workplace_id: workplaceId,
    p_lat: detectedPlace?.currentLat ?? null,
    p_lng: detectedPlace?.currentLng ?? null,
    p_accuracy_m: null,
    p_ip_address: detectedPlace?.ip ?? null,
    p_device_fingerprint_hash: fingerprintHash,
    p_device_info: deviceInfo,
  });

  if (error) throw error;

  setMessage(`출근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
  setDetectedPlace(null);
  setUnknownPlaceName("");
  await load();
} catch (e: any) {
  setMessage(e.message);
} finally {
  setBusy(false);
}
}

async function checkOut() {
setBusy(true);
setMessage("퇴근 위치를 확인하는 중입니다.");

try {
  const p = await getCurrentPositionFast();
  const ip = await getPublicIp();
  const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

  const { data, error } = await supabase.rpc("check_out", {
    p_lat: p.lat,
    p_lng: p.lng,
    p_accuracy_m: p.accuracy,
    p_ip_address: ip,
    p_device_fingerprint_hash: fingerprintHash,
    p_device_info: deviceInfo,
  });

  if (error) throw error;

  setMessage(`퇴근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
  await load();
} catch (e: any) {
  setMessage(e.message);
} finally {
  setBusy(false);
}
}

async function startBreak() {
if (!todayLog?.id) return setMessage("출근 기록이 없습니다.");
const { error } = await supabase.from("break_logs").insert({ attendance_log_id: todayLog.id, employee_id: employee.id });
if (error) setMessage(error.message);
else {
setMessage("휴게 시작 처리되었습니다.");
await load();
}
}

async function endBreak() {
if (!breakLog?.id) return setMessage("진행 중인 휴게가 없습니다.");
const { error } = await supabase.from("break_logs").update({ break_end: new Date().toISOString() }).eq("id", breakLog.id);
if (error) setMessage(error.message);
else {
setMessage("휴게 종료 처리되었습니다.");
await load();
}
}

return (


{now.toLocaleDateString("ko-KR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
{now.toLocaleTimeString("ko-KR", { hour12: false })}

<button className="button punch" disabled={busy || !!todayLog?.check_in_time} onClick={checkIn}>출근하기
<button className="button secondary punch" disabled={busy || !todayLog?.check_in_time || !!todayLog?.check_out_time} onClick={checkOut}>퇴근하기

<div className="actions" style={{ marginTop: 12 }}>
{!breakLog ? <button className="button ghost" disabled={!todayLog || !!todayLog.check_out_time} onClick={startBreak}>휴게 시작 : 휴게 종료}

{message && <div className="alert" style={{ marginTop: 16 }}>{message}}
{detectedPlace && (
<div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
{detectedPlace.id ? (
<>
{detectedPlace.name} 맞나요?
GPS/IP 기준으로 가장 가까운 승인 근무지를 찾았습니다.
</>
) : (
<>
현재 장소를 입력해주세요
입력한 장소는 관리자 승인 대기 근무지로 저장됩니다.
<input className="input" value={unknownPlaceName} onChange={(e) => setUnknownPlaceName(e.target.value)} placeholder="예: 대구○○학교, ○○교육장" />
</>
)}
<div className="actions" style={{ marginTop: 12 }}>
출근 확정
<button className="button ghost" onClick={() => setDetectedPlace(null)}>취소


)}


  <section className="card">
    <h2 className="card-title">오늘 근무 요약</h2>
    <div className="grid two">
      <div className="metric"><div className="metric-value">{todayLog?.check_in_time ? formatDateTime(todayLog.check_in_time).split(" ").slice(-1)[0] : "-"}</div><div className="metric-label">출근</div></div>
      <div className="metric"><div className="metric-value">{todayLog?.check_out_time ? formatDateTime(todayLog.check_out_time).split(" ").slice(-1)[0] : "-"}</div><div className="metric-label">퇴근</div></div>
    </div>
    <div style={{ marginTop: 16 }}>
      <span className={`badge ${badgeClass(todayLog?.status)}`}>{todayLog?.status ?? "기록 없음"}</span>
      <p className="subtle">근무지: {todayLog?.workplaces?.name ?? "-"}</p>
      <p className="subtle">기기 상태: {todayLog?.device_status ?? "-"}</p>
      <p className="subtle">휴게 상태: {breakLog ? "휴게 중" : "휴게 아님"}</p>
    </div>
  </section>
</div>
);
}

function LeavePage({ employee }: { employee: any }) {
const [requests, setRequests] = useState<any[]>([]);
const [adjustments, setAdjustments] = useState<any[]>([]);
const [compRequests, setCompRequests] = useState<any[]>([]);
const [form, setForm] = useState({ request_type: "annual", start_date: todayIso(), end_date: todayIso(), amount_hours: "", reason: "" });
const [compForm, setCompForm] = useState({ work_date: todayIso(), start_time: "18:00", end_time: "20:00", hours: 2, reason: "" });
const [message, setMessage] = useState("");

async function load() {
const [r, a, c] = await Promise.all([
supabase.from("attendance_requests").select("").eq("employee_id", employee.id).order("created_at", { ascending: false }),
supabase.from("leave_adjustments").select("").eq("employee_id", employee.id).order("created_at", { ascending: false }),
supabase.from("comp_time_requests").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
]);
setRequests(r.data ?? []);
setAdjustments(a.data ?? []);
setCompRequests(c.data ?? []);
}

useEffect(() => { load(); }, []);

const ent = calculateLeaveEntitlement(employee.joined_at);
const adj = calculateAdjustmentDays(adjustments);
const compEarned = calculateCompTimeEarnedDays(adjustments);
const approvedUsed = calculateUsedDays(requests, false);
const pendingUsed = calculateUsedDays(requests, true);
const totalGranted = ent.baseGrantedDays + adj;
const remaining = Math.max(0, totalGranted - approvedUsed);
const expectedRemaining = Math.max(0, totalGranted - pendingUsed);

async function submitLeave() {
setMessage("");
const amountHours = form.request_type === "hourly" && form.amount_hours ? Number(form.amount_hours) : null;
const requestedDays = form.request_type === "hourly" ? Number(form.amount_hours || 0) / 8 : form.request_type === "half_am" || form.request_type === "half_pm" ? 0.5 : 1;

if (["annual", "half_am", "half_pm", "hourly", "comp_leave_use"].includes(form.request_type) && requestedDays > expectedRemaining) {
  return setMessage("잔여 휴가가 부족하여 신청할 수 없습니다.");
}

const { error } = await supabase.from("attendance_requests").insert({
  employee_id: employee.id,
  request_type: form.request_type,
  start_date: form.start_date,
  end_date: form.end_date,
  amount_hours: amountHours,
  amount_days: amountHours ? amountHours / 8 : null,
  reason: form.reason,
  status: "pending",
});

if (error) setMessage(error.message);
else {
  setMessage("근태 신청이 저장되었습니다.");
  await load();
}
}

async function submitCompTime() {
setMessage("");
if (!compForm.hours || compForm.hours <= 0) return setMessage("추가 근무 시간을 입력해주세요.");

const { error } = await supabase.from("comp_time_requests").insert({
  employee_id: employee.id,
  work_date: compForm.work_date,
  start_time: compForm.start_time,
  end_time: compForm.end_time,
  hours: compForm.hours,
  converted_days: Number((compForm.hours / 8).toFixed(2)),
  reason: compForm.reason,
  status: "pending",
});

if (error) setMessage(error.message);
else {
  setMessage("추가 근무 대체휴가 적립 신청이 저장되었습니다. 관리자 승인 후 사용 가능합니다.");
  await load();
}
}

return (

{message && {message}}

{totalGranted.toFixed(1)}총 사용 가능 휴가
{approvedUsed.toFixed(1)}승인 사용
{remaining.toFixed(1)}잔여
{compEarned.toFixed(1)}추가근무 대체휴가 적립


  <section className="card">
    <h2 className="card-title">연차 현황</h2>
    <p className="subtle">근무 시작일: {employee.joined_at ?? "-"} · 기본 발생: {ent.baseGrantedDays}일 · 관리자/추가근무 조정: {adj.toFixed(1)}일 · 대기 포함 예상 잔여: {expectedRemaining.toFixed(1)}일</p>
    <p className="subtle">기준: {ent.description} · 산정기간 {ent.periodStart ?? "-"} ~ {ent.periodEnd ?? "-"}</p>
  </section>

  <div className="grid two">
    <section className="card">
      <h2 className="card-title">휴가·근태 신청</h2>
      <div className="form-row">
        <label className="label">신청 유형</label>
        <select className="select" value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
          {Object.entries(requestTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid two">
        <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
        <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
      </div>
      {form.request_type === "hourly" && <div className="form-row"><label className="label">시간차 사용 시간</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={(e) => setForm({ ...form, amount_hours: e.target.value })} /></div>}
      <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
      <button className="button full" onClick={submitLeave}>신청하기</button>
    </section>

    <section className="card">
      <h2 className="card-title">추가근무 대체휴가 적립 신청</h2>
      <p className="subtle">추가근무 수당 대신 휴가로 대체 적립합니다. 관리자 승인 후에만 휴가 잔여에 추가됩니다. 환산 기준은 8시간 = 1일입니다.</p>
      <div className="form-row"><label className="label">추가근무일</label><input className="input" type="date" value={compForm.work_date} onChange={(e) => setCompForm({ ...compForm, work_date: e.target.value })} /></div>
      <div className="grid three">
        <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={compForm.start_time} onChange={(e) => setCompForm({ ...compForm, start_time: e.target.value })} /></div>
        <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={compForm.end_time} onChange={(e) => setCompForm({ ...compForm, end_time: e.target.value })} /></div>
        <div className="form-row"><label className="label">시간</label><input className="input" type="number" step="0.5" value={compForm.hours} onChange={(e) => setCompForm({ ...compForm, hours: Number(e.target.value) })} /></div>
      </div>
      <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={compForm.reason} onChange={(e) => setCompForm({ ...compForm, reason: e.target.value })} placeholder="예: 행사 운영, 외부 교육 연장 등" /></div>
      <button className="button full" onClick={submitCompTime}>대체휴가 적립 신청</button>
    </section>
  </div>

  <section className="card">
    <h2 className="card-title">신청 내역</h2>
    <DataTable rows={[
      ...requests.map((r) => ({ 구분: requestTypeLabels[r.request_type] ?? r.request_type, 기간: `${r.start_date}~${r.end_date}`, 환산: r.amount_days ?? "-", 상태: r.status, 사유: r.reason ?? "-" })),
      ...compRequests.map((r) => ({ 구분: "추가근무 대체휴가 적립", 기간: r.work_date, 환산: `${r.hours}시간 → ${r.converted_days}일`, 상태: r.status, 사유: r.reason ?? "-" })),
    ]} />
  </section>
</div>
);
}

function WorkplacePage({ employee }: { employee: any }) {
const [query, setQuery] = useState("");
const [places, setPlaces] = useState<any[]>([]);
const [workplaces, setWorkplaces] = useState<any[]>([]);
const [message, setMessage] = useState("");

async function load() {
const { data } = await supabase.from("workplaces").select("*, requester(name)").order("created_at", { ascending: false });
setWorkplaces(data ?? []);
}

useEffect(() => { load(); }, []);

async function search() {
const { data, error } = await supabase.functions.invoke("kakao-place-search", { body: { query } });
if (error) setMessage(error.message);
else setPlaces(data?.documents ?? []);
}

async function requestPlace(p: any) {
const { error } = await supabase.from("workplaces").insert({
name: p.place_name,
type: "special_school",
address: p.road_address_name || p.address_name,
kakao_place_id: p.id,
lat: Number(p.y),
lng: Number(p.x),
radius_m: 100,
approval_status: "pending",
requested_by: employee.id,
});

if (error) setMessage(error.message);
else {
  setMessage("근무지 승인 요청이 저장되었습니다.");
  setPlaces([]);
  setQuery("");
  await load();
}
}

const grouped = {
approved: workplaces.filter((w) => w.approval_status === "approved"),
pending: workplaces.filter((w) => w.approval_status === "pending"),
rejected: workplaces.filter((w) => w.approval_status === "rejected"),
};

return (


근무지 검색·요청
카카오맵 검색으로 근무지를 등록 요청합니다. 승인이 완료되면 다음 출근 시 자동 후보로 사용됩니다.
{message && {message}}
근무지명<input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 대구광명학교" />
검색
<div className="grid" style={{ marginTop: 14 }}>
{places.map((p) => <div className="card" style={{ boxShadow: "none" }} key={p.id}>{p.place_name}{p.road_address_name || p.address_name}<button className="button secondary" onClick={() => requestPlace(p)}>승인 요청)}



  <section className="card">
    <h2 className="card-title">근무지 목록</h2>
    <h3>승인된 근무지</h3>
    <DataTable rows={grouped.approved.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type], 반경: `${w.radius_m}m`, 요청자: w.requester?.name ?? "-" }))} />
    <h3>승인 대기</h3>
    <DataTable rows={grouped.pending.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type], 반경: `${w.radius_m}m`, 요청자: w.requester?.name ?? "-" }))} />
  </section>
</div>
);
}

function AdminPage() {
const [employees, setEmployees] = useState<any[]>([]);
const [employeeFilter, setEmployeeFilter] = useState("active");
const [devices, setDevices] = useState<any[]>([]);
const [workplaces, setWorkplaces] = useState<any[]>([]);
const [requests, setRequests] = useState<any[]>([]);
const [compRequests, setCompRequests] = useState<any[]>([]);
const [message, setMessage] = useState("");
const [newEmployee, setNewEmployee] = useState({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 });

async function load() {
const [e, d, w, r, c] = await Promise.all([
supabase.from("employees").select("").order("created_at", { ascending: false }),
supabase.from("registered_devices").select(", employees(name, employee_no)").order("created_at", { ascending: false }),
supabase.from("workplaces").select(", requester(name)").order("created_at", { ascending: false }),
supabase.from("attendance_requests").select(", employees(name, employee_no)").order("created_at", { ascending: false }),
supabase.from("comp_time_requests").select("*, employees(name, employee_no)").order("created_at", { ascending: false }),
]);

setEmployees(e.data ?? []);
setDevices(d.data ?? []);
setWorkplaces(w.data ?? []);
setRequests(r.data ?? []);
setCompRequests(c.data ?? []);
}

useEffect(() => { load(); }, []);

async function createEmployee() {
setMessage("");
const { data, error } = await supabase.functions.invoke("admin-create-employee", { body: newEmployee });

if (error) setMessage(error.message);
else if (data?.error) setMessage(data.error);
else {
  setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);
  setNewEmployee({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 });
  await load();
}
}

async function updateEmployee(id: string, patch: Record<string, any>) {
const { error } = await supabase.from("employees").update(patch).eq("id", id);
if (error) setMessage(error.message);
else await load();
}

async function toggleEmployee(id: string, currentStatus: string) {
const nextActive = currentStatus !== "active";
await updateEmployee(id, {
is_active: nextActive,
employment_status: nextActive ? "active" : "inactive",
});
}

async function reviewWorkplace(id: string, status: string) {
const { error } = await supabase.from("workplaces").update({ approval_status: status, is_active: status === "approved" }).eq("id", id);
if (error) setMessage(error.message);
else await load();
}

async function reviewRequest(id: string, status: string) {
const { error } = await supabase.rpc("review_attendance_request", { p_request_id: id, p_status: status, p_review_note: "" });
if (error) setMessage(error.message);
else await load();
}

async function reviewCompRequest(id: string, status: string) {
const { error } = await supabase.rpc("review_comp_time_request", { p_request_id: id, p_status: status, p_review_note: "" });
if (error) setMessage(error.message);
else {
setMessage(status === "approved" ? "추가근무 대체휴가가 승인되어 휴가 잔여에 추가되었습니다." : "추가근무 대체휴가 신청을 반려했습니다.");
await load();
}
}

async function reviewDevice(id: string, status: string) {
const { error } = await supabase.from("registered_devices").update({ status }).eq("id", id);
if (error) setMessage(error.message);
else await load();
}

const filteredEmployees = employees.filter((e) =>
employeeFilter === "all" ? true : employeeFilter === "inactive" ? e.employment_status !== "active" : e.employment_status === "active"
);

return (

{message && {message}}

  <section className="card">
    <h2 className="card-title">직원 계정 생성</h2>
    <div className="grid four">
      <div className="form-row"><label className="label">이름</label><input className="input" value={newEmployee.name} onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} /></div>
      <div className="form-row"><label className="label">사번</label><input className="input" value={newEmployee.employee_no} onChange={(e) => setNewEmployee({ ...newEmployee, employee_no: e.target.value })} /></div>
      <div className="form-row"><label className="label">휴대폰</label><input className="input" value={newEmployee.phone} onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })} placeholder="010-0000-0000" /></div>
      <div className="form-row"><label className="label">근무 시작일</label><input className="input" type="date" value={newEmployee.joined_at} onChange={(e) => setNewEmployee({ ...newEmployee, joined_at: e.target.value })} /></div>
    </div>
    <button className="button" onClick={createEmployee}>직원 생성</button>
  </section>

  <section className="card">
    <h2 className="card-title">직원 관리</h2>
    <div className="tabs">
      <button className={`tab ${employeeFilter === "active" ? "active" : ""}`} onClick={() => setEmployeeFilter("active")}>재직 직원</button>
      <button className={`tab ${employeeFilter === "inactive" ? "active" : ""}`} onClick={() => setEmployeeFilter("inactive")}>비활성 직원</button>
      <button className={`tab ${employeeFilter === "all" ? "active" : ""}`} onClick={() => setEmployeeFilter("all")}>전체</button>
    </div>

    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>직원</th>
            <th>권한</th>
            <th>상태</th>
            <th>근무 시작일</th>
            <th>기기 제한</th>
            <th>처리</th>
          </tr>
        </thead>
        <tbody>
          {filteredEmployees.map((e) => (
            <tr key={e.id}>
              <td>{e.name}<br /><span className="subtle">{e.employee_no} · {e.phone}</span></td>
              <td>
                <select className="select" value={e.role} onChange={(ev) => updateEmployee(e.id, { role: ev.target.value })}>
                  <option value="admin">관리자</option>
                  <option value="employee">직원</option>
                </select>
              </td>
              <td><span className={`badge ${badgeClass(e.employment_status)}`}>{e.employment_status}</span></td>
              <td><input className="input" type="date" value={e.joined_at ?? ""} onChange={(ev) => updateEmployee(e.id, { joined_at: ev.target.value })} /></td>
              <td>
                <select className="select" value={e.device_limit} onChange={(ev) => updateEmployee(e.id, { device_limit: Number(ev.target.value) })}>
                  <option value={1}>1대</option>
                  <option value={2}>2대</option>
                  <option value={3}>3대</option>
                </select>
              </td>
              <td>
                <button className={e.employment_status === "active" ? "button danger" : "button secondary"} onClick={() => toggleEmployee(e.id, e.employment_status)}>
                  {e.employment_status === "active" ? "비활성화" : "활성화"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>

  <section className="card">
    <h2 className="card-title">승인 대기</h2>
    <div className="grid two">
      <div>
        <h3>근무지 승인</h3>
        {workplaces.filter((w) => w.approval_status !== "approved").map((w) => (
          <div className="actions" key={w.id} style={{ marginBottom: 10 }}>
            <b>{w.name}</b>
            <span className={`badge ${badgeClass(w.approval_status)}`}>{w.approval_status}</span>
            <button className="button secondary" onClick={() => reviewWorkplace(w.id, "approved")}>근무지 확정</button>
            <button className="button danger" onClick={() => reviewWorkplace(w.id, "rejected")}>반려</button>
          </div>
        ))}
      </div>

      <div>
        <h3>추가근무 대체휴가 적립 승인</h3>
        {compRequests.filter((r) => r.status === "pending").map((r) => (
          <div className="actions" key={r.id} style={{ marginBottom: 10 }}>
            <b>{r.employees?.name} · {r.hours}h → {r.converted_days}일</b>
            <button className="button secondary" onClick={() => reviewCompRequest(r.id, "approved")}>승인</button>
            <button className="button danger" onClick={() => reviewCompRequest(r.id, "rejected")}>반려</button>
          </div>
        ))}
      </div>
    </div>
  </section>

  <section className="card">
    <h2 className="card-title">근태·기기 승인</h2>
    <h3>근태 신청</h3>
    <div className="grid">
      {requests.filter((r) => r.status === "pending").map((r) => (
        <div className="actions" key={r.id}>
          <b>{r.employees?.name} · {requestTypeLabels[r.request_type] ?? r.request_type}</b>
          <button className="button secondary" onClick={() => reviewRequest(r.id, "approved")}>승인</button>
          <button className="button danger" onClick={() => reviewRequest(r.id, "rejected")}>반려</button>
        </div>
      ))}
    </div>

    <h3>기기 승인</h3>
    <div className="grid">
      {devices.filter((d) => d.status === "pending").map((d) => (
        <div className="actions" key={d.id}>
          <b>{d.employees?.name} · {d.device_info?.platform}</b>
          <button className="button secondary" onClick={() => reviewDevice(d.id, "approved")}>승인</button>
          <button className="button danger" onClick={() => reviewDevice(d.id, "rejected")}>반려</button>
        </div>
      ))}
    </div>
  </section>
</div>
);
}

function ReportsPage() {
const [logs, setLogs] = useState<any[]>([]);
const [compRequests, setCompRequests] = useState<any[]>([]);

async function load() {
const [l, c] = await Promise.all([
supabase.from("attendance_logs").select(", employees(name, employee_no), workplaces(name,type)").order("created_at", { ascending: false }).limit(500),
supabase.from("comp_time_requests").select(", employees(name, employee_no)").order("created_at", { ascending: false }).limit(500),
]);
setLogs(l.data ?? []);
setCompRequests(c.data ?? []);
}

useEffect(() => { load(); }, []);

function downloadAll() {
exportRowsToExcel("lupl_attendance_report.xlsx", "근태", logs.map((l) => ({
직원: l.employees?.name,
사번: l.employees?.employee_no,
근무지: l.workplaces?.name,
유형: workplaceTypeLabels[l.workplaces?.type] ?? "-",
출근: formatDateTime(l.check_in_time),
퇴근: formatDateTime(l.check_out_time),
상태: l.status,
기기: l.device_status,
})));
}

function downloadComp() {
exportRowsToExcel("lupl_comp_time_report.xlsx", "추가근무대체휴가", compRequests.map((r) => ({
직원: r.employees?.name,
사번: r.employees?.employee_no,
근무일: r.work_date,
시간: r.hours,
적립일수: r.converted_days,
상태: r.status,
사유: r.reason,
})));
}

const fieldLogs = logs.filter((l) => ["special_school", "external_education", "other_field"].includes(l.workplaces?.type));
const exceptions = logs.filter((l) => ["위치 확인 필요", "기기 확인 필요", "관리자 확인 필요", "자동 퇴근 후보"].includes(l.status) || !l.check_out_time);

return (


{logs.length}전체 근태
{fieldLogs.length}외근
{exceptions.length}예외
{compRequests.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.converted_days || 0), 0).toFixed(1)}대체휴가 적립


  <section className="card">
    <h2 className="card-title">보고서 다운로드</h2>
    <div className="actions">
      <button className="button" onClick={downloadAll}>월별 전체 근태 Excel</button>
      <button className="button secondary" onClick={downloadComp}>추가근무 대체휴가 Excel</button>
    </div>
  </section>

  <section className="card">
    <h2 className="card-title">예외함</h2>
    <DataTable rows={exceptions.map((l) => ({ 직원: l.employees?.name, 근무지: l.workplaces?.name, 출근: formatDateTime(l.check_in_time), 퇴근: formatDateTime(l.check_out_time), 상태: l.status }))} />
  </section>
</div>
);
}

function DataTable({ rows }: { rows: Record<string, any>[] }) {
if (!rows.length) return 표시할 데이터가 없습니다.;
const cols = Object.keys(rows[0]);

return (



{cols.map((c) => {c})}


{rows.map((row, i) => (
{cols.map((c) => {String(row[c] ?? "-")})}
))}



);
}


닫기
