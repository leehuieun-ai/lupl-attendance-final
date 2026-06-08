# 보안 메모

GitHub에 올리면 안 되는 값:
- `.env.local`
- Kakao REST API Key
- Supabase service_role key
- DB password

구조:
- 프론트에는 Supabase anon key만 사용
- 관리자 직원 생성은 Edge Function에서 service_role key로 처리
- 카카오 장소 검색도 Edge Function에서만 처리
- 직원 비밀번호는 Supabase Auth에서 관리
- GPS는 출근/퇴근 버튼을 누르는 순간에만 수집
- 실시간 위치 추적 없음
