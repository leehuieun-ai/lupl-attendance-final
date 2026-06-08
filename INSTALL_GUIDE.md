# 설치 가이드

## 1. 새 GitHub 저장소 만들기
GitHub → + → New repository → `lupl-attendance-system` → Private 권장 → README 체크하지 않기 → Create repository.

ZIP 압축을 풀고, 폴더 안의 파일들이 저장소 첫 화면에 바로 보이게 업로드하세요.

정상 구조:
```text
package.json
index.html
src
supabase
README.md
INSTALL_GUIDE.md
SECURITY.md
```

## 2. Supabase SQL 실행
Supabase → SQL Editor → New query → `supabase/schema.sql` 전체 붙여넣기 → Run.

## 3. 최초 관리자 만들기
Authentication → Users → Add user. 이메일은 `admin001@lupl.local` 추천.

SQL Editor에서 아래 실행:
```sql
insert into public.employees (user_id, employee_no, name, phone, internal_email, role, device_limit, joined_at, employment_status, is_active)
select id, 'ADMIN001', '이희은', '010-0000-0000', email, 'admin', 3, current_date, 'active', true
from auth.users
where email = 'admin001@lupl.local'
on conflict (employee_no) do update
set role = 'admin', is_active = true, employment_status = 'active';
```

## 4. Supabase Auth 설정
Authentication → Providers → Email.
- Confirm email: OFF
- Allow new users to sign up: ON

## 5. 환경변수
`.env.example`을 복사해서 `.env.local` 생성.
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

## 6. Supabase Secrets 및 Edge Function
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set KAKAO_REST_API_KEY=카카오_REST_API_키
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=서비스롤키
supabase functions deploy kakao-place-search
supabase functions deploy admin-create-employee
```

## 7. 로컬 실행
```bash
npm install
npm run dev
```

## 8. Vercel 배포
Framework: Vite / Install: npm install / Build: npm run build / Output: dist
환경변수는 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY만 넣으세요.
