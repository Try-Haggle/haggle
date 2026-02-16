# Haggle MVP

**60일 MVP 개발 프로젝트**

> 이 문서는 MVP 프로젝트의 개발 가이드이자 Source of Truth입니다.

---

## Tech Stack

| 영역 | 기술 |
|------|------|
| Runtime | Node.js 22+ |
| Package Manager | pnpm 9.15+ |
| Build System | Turborepo |
| Language | TypeScript 5.7+ |
| API | Hono (apps/api) |
| Web | Next.js (apps/web) |
| Database | Drizzle ORM (packages/db) |
| Monorepo | pnpm workspace |

---

## 프로젝트 구조

```
projects/mvp/
├── apps/
│   ├── api/          # Hono API 서버 (Railway 배포)
│   └── web/          # Next.js 프론트엔드 (Vercel 배포)
├── packages/
│   ├── shared/       # 공통 유틸리티, 타입
│   ├── db/           # Drizzle ORM, 스키마, 마이그레이션
│   ├── protocol/     # HNP 프로토콜 타입 정의
│   ├── engine/       # 협상 엔진 로직
│   └── contracts/    # 스마트 컨트랙트 (post-MVP)
├── docs/             # MVP 구현 문서
│   ├── Slice_0_Implementation_Plan.md
│   └── MVP_Final_Implementation_Plan.md
├── Dockerfile.api    # Railway API 배포용
├── turbo.json
├── tsconfig.base.json
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

---

## 개발 명령어

```bash
# 의존성 설치
pnpm install

# 개발 서버 실행
pnpm dev

# 빌드
pnpm build

# 타입 체크
pnpm typecheck

# 린트
pnpm lint
```

---

## 배포

| 서비스 | 플랫폼 | Root Directory |
|--------|--------|----------------|
| API | Railway | `projects/mvp` |
| Web | Vercel | `projects/mvp` |

---

## Slice 계획

구현 문서는 `docs/` 폴더 참조:
- **Slice 0**: 프로젝트 초기 설정, monorepo 구조, 기본 인프라
- 상세: `docs/MVP_Final_Implementation_Plan.md`

---

## 개발 규칙

1. **Monorepo 내부 참조**: `@haggle/*` workspace 패키지 사용
2. **타입 안전**: strict TypeScript, any 금지
3. **빌드 순서**: packages → apps (turbo dependsOn 준수)
4. **환경 변수**: `.env.example` 참고, `.env`는 gitignore
