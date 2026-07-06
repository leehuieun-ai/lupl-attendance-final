# 로컬 확인 후 퍼블리시 흐름

## 브랜치 역할

- `main`: 운영 배포 전용 브랜치입니다. 이 브랜치에 push되면 Vercel 운영 배포가 진행됩니다.
- `db`: DB 패치, 기능 수정, 로컬 테스트를 먼저 하는 작업 브랜치입니다. GitHub에는 push해도 Vercel 자동 배포가 되지 않습니다.

## 평소 작업

```powershell
git switch db
npm run build
git push origin db
```

## 운영 반영

로컬에서 `npm run build`가 성공한 뒤에만 `main`으로 반영합니다.

```powershell
git switch main
git merge db
npm run build
git push origin main
```

## Vercel 자동 배포 규칙

`vercel.json`에서 `main`만 자동 배포되도록 설정했습니다. `db`를 포함한 다른 브랜치는 GitHub에 올라가도 Vercel 배포가 실행되지 않습니다.
