# 개선함 적용 가이드

다른 프로젝트에 붙일 때 필요한 핵심만 정리한 문서입니다. 목표는 사용자가 현재 화면에서 개선 요청을 바로 남기고, 관리자가 모아서 보고, GitHub Issue로 보내고, 앱 안에 전송 기록까지 남기는 것입니다.

## 기능 범위

- 모든 화면에 개선함 버튼을 둔다.
- 버튼 또는 `Ctrl+Shift+M`으로 개선 메모 모달을 연다.
- 현재 메뉴, 하위 항목, 유형, 메모, 붙여넣기 이미지를 함께 저장한다.
- 관리자는 개선 요청 목록에서 상태를 바꾸고 GitHub Issue로 보낸다.
- GitHub로 보낸 항목은 `planned` 상태로 바꾸고 issue 번호, URL, 제목, 전송 시각을 저장한다.
- 사용자는 본인이 올린 공개 요청의 처리 상태를 볼 수 있다.

## 데이터 모델

Supabase 테이블명은 `improvement_requests`를 사용한다.

필수 컬럼:

```sql
create table if not exists public.improvement_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.employees(id) on delete cascade,
  request_type text not null default 'bug',
  request_type_label text not null default '오류',
  menu_id text,
  menu_label text,
  submenu_label text,
  page_title text,
  page_path text,
  note text not null,
  status text not null default 'open'
    check (status in ('open','reviewing','planned','done','dismissed')),
  ai_summary text,
  ai_payload jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  visibility text not null default 'employee_owner'
    check (visibility in ('employee_owner','admin_only')),
  github_issue_number int,
  github_issue_url text,
  github_issue_title text,
  github_sent_at timestamptz,
  user_agent text,
  viewport_width int,
  viewport_height int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

권장 인덱스:

```sql
create index if not exists improvement_requests_status_idx
on public.improvement_requests(status, created_at desc);

create index if not exists improvement_requests_menu_idx
on public.improvement_requests(menu_id, submenu_label, created_at desc);

create index if not exists improvement_requests_created_by_idx
on public.improvement_requests(created_by, created_at desc);
```

기존 DB에 붙일 때 쓰는 보강 패치:

```sql
alter table public.improvement_requests add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.improvement_requests add column if not exists visibility text not null default 'employee_owner';
alter table public.improvement_requests add column if not exists github_issue_number int;
alter table public.improvement_requests add column if not exists github_issue_url text;
alter table public.improvement_requests add column if not exists github_issue_title text;
alter table public.improvement_requests add column if not exists github_sent_at timestamptz;

alter table public.improvement_requests drop constraint if exists improvement_requests_visibility_check;
alter table public.improvement_requests add constraint improvement_requests_visibility_check
check (visibility in ('employee_owner','admin_only'));

notify pgrst, 'reload schema';
```

## RLS 정책

관리자는 전체 조회/수정, 일반 사용자는 자기 요청만 조회/생성하게 둔다. `admin_only` 요청은 일반 사용자에게 다시 보이지 않는다.

```sql
alter table public.improvement_requests enable row level security;

drop policy if exists improvement_requests_select_auth on public.improvement_requests;
create policy improvement_requests_select_auth on public.improvement_requests
for select to authenticated using (
  public.is_admin()
  or (
    created_by = public.current_employee_id()
    and coalesce(visibility,'employee_owner') <> 'admin_only'
  )
);

drop policy if exists improvement_requests_insert_auth on public.improvement_requests;
create policy improvement_requests_insert_auth on public.improvement_requests
for insert to authenticated with check (
  created_by = public.current_employee_id()
  and (coalesce(visibility,'employee_owner') <> 'admin_only' or public.is_admin())
);

drop policy if exists improvement_requests_admin_update on public.improvement_requests;
create policy improvement_requests_admin_update on public.improvement_requests
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists improvement_requests_owner_update on public.improvement_requests;
create policy improvement_requests_owner_update on public.improvement_requests
for update to authenticated using (
  created_by = public.current_employee_id()
  and status = 'open'
) with check (
  created_by = public.current_employee_id()
  and status = 'open'
);
```

`public.is_admin()`과 `public.current_employee_id()`가 없는 프로젝트는 해당 프로젝트의 권한 함수명으로 바꾸면 된다.

## 프론트 구현

캡처 모달 저장값:

```ts
const payload = {
  created_by: employee.id,
  request_type,
  request_type_label,
  menu_id: currentMenuId,
  menu_label: currentMenuLabel,
  submenu_label: submenu || null,
  page_title: currentPageTitle,
  page_path: `${window.location.pathname}${window.location.hash}`,
  note: note.trim() || "이미지 첨부",
  status: "open",
  attachments,
  visibility: employee.role === "admin" ? "admin_only" : "employee_owner",
  user_agent: navigator.userAgent,
  viewport_width: window.innerWidth,
  viewport_height: window.innerHeight,
};
```

이미지 첨부 형식:

```ts
{
  id: "att-...",
  name: "pasted-image.png",
  type: "image/png",
  data_url: "data:image/png;base64,..."
}
```

이미지는 `textarea`의 `onPaste`에서 `clipboardData.files` 중 `image/*`만 읽어 `attachments`에 넣는다. 작은 운영 앱은 `jsonb`에 `data_url` 저장으로 충분하고, 이미지가 많아질 프로젝트는 Supabase Storage에 올린 뒤 URL만 저장한다.

관리 목록 화면 필수 표시:

- 상태 필터 기본값은 `all`.
- 상단 요약은 `대기 N건 · GitHub 전송 N건 · 완료 N건 · 삭제 N건`.
- 카드 제목은 메모 첫 줄을 42자 정도로 줄여 쓴다.
- 카드에는 유형, 제목, 메뉴/하위항목, 본문, 이미지 첨부, 작성자, 작성 시각, 현재 상태를 보여준다.
- `github_issue_url` 또는 `github_issue_number`가 있으면 GitHub chip을 보여준다.

상태 의미:

- `open`: 대기
- `reviewing`: 검토
- `planned`: GitHub 전송 또는 수정 예정
- `done`: 완료
- `dismissed`: 삭제/제외

## GitHub Issue 전송

관리자만 실행한다. 프론트는 Supabase access token을 `Authorization: Bearer ...`로 API에 넘긴다.

필수 환경변수:

```env
LUPL_GITHUB_TOKEN=github_pat_...
LUPL_GITHUB_REPO=owner/repo
LUPL_GITHUB_ISSUE_LABELS=improvement,from-app
```

서버 API 흐름:

1. `requireAdmin(req)`로 관리자 확인.
2. 요청 목록을 최대 100건으로 제한.
3. 첫 요청 제목을 짧게 잘라 issue 제목 생성.
4. GitHub REST API `POST /repos/{owner}/{repo}/issues` 호출.
5. 성공하면 `{ number, html_url, title }`만 프론트에 반환.

프론트는 성공 후 선택된 요청을 이렇게 업데이트한다.

```ts
await supabase.from("improvement_requests").update({
  status: "planned",
  github_issue_number: issue.number,
  github_issue_url: issue.html_url,
  github_issue_title: issue.title,
  github_sent_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}).in("id", ids);
```

## AI 요약 선택 기능

관리자 화면에서 현재 필터에 걸린 요청을 `/api/improvement-summarize`로 보내 JSON을 받는다.

권장 반환 필드:

```json
{
  "overview": "전체 요약",
  "priority_items": [
    { "title": "우선 처리 제목", "menu": "메뉴", "submenu": "하위항목", "reason": "이유", "severity": "high" }
  ],
  "action_items": [
    { "task": "작업", "scope": "범위", "acceptance_criteria": "완료 기준" }
  ],
  "questions": ["확인할 질문"]
}
```

이 기능은 없어도 개선함 기본 흐름은 돌아간다.

## 운영 체크리스트

- Supabase SQL 패치 실행 후 `notify pgrst, 'reload schema';` 실행.
- 배포 환경변수에 GitHub token과 repo 설정.
- 관리자 권한 함수가 실제 프로젝트와 맞는지 확인.
- 일반 사용자가 `admin_only` 요청을 볼 수 없는지 확인.
- 이미지 붙여넣기, GitHub 전송, 전송 기록 chip 표시까지 한 번에 확인.
- 다른 프로젝트에 적용할 때 메뉴 목록과 하위 항목 목록만 해당 도메인에 맞게 바꾼다.

## 이 프로젝트 기준 코드 위치

- 캡처 버튼/모달: `src/App.tsx`의 `ImprovementQuickCapture`
- 목록/상태/GitHub 전송: `src/App.tsx`의 `ImprovementRequestsPage`
- GitHub Issue 생성 API: `api/improvement-github-issue.js`
- AI 요약 API: `api/improvement-summarize.js`
- Supabase 스키마: `supabase/schema.sql`
- 보강 패치: `supabase/patch_20260727_followup.sql`
