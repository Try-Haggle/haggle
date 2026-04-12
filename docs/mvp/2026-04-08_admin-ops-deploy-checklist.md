# Admin Ops Inbox 배포 체크리스트 (Steps 55~59)

작성: 2026-04-08
대상 커밋: `28b62f3..a063e1e` (feature/mvp-integration)

## 1. DB 마이그레이션

```bash
psql "$DATABASE_URL" -f packages/db/migrations/004_admin_ops.sql
```

생성물:
- `tag_promotion_rules` (category UNIQUE, 5개 기본 rule 시드: condition/style/size/material/default)
- `admin_action_log` (append-only, 3개 인덱스)

**검증:**
```sql
SELECT category, candidate_min_use, emerging_min_use, suggestion_auto_promote_count, enabled
  FROM tag_promotion_rules ORDER BY category;
-- 5 rows
SELECT COUNT(*) FROM admin_action_log;
-- 0
```

마이그레이션은 idempotent (`IF NOT EXISTS` + `ON CONFLICT (category) DO NOTHING`) — 재실행 안전.

> 참고: drizzle-kit 경로는 기존 `listings-published.ts` 모듈 해석 이슈로 막혀 있어 raw SQL 사용. 그 이슈가 해결되면 `pnpm --filter @haggle/db db:generate`로 전환 가능.

## 2. Admin 계정 세팅

Supabase 콘솔에서 admin으로 쓸 사용자의 `app_metadata` 편집:

```json
{ "role": "admin" }
```

확인:
```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.tryhaggle.ai/admin/inbox/summary
# { "tags": {...}, "disputes": {...}, "payments": {...}, "computedAt": "..." }
```

비-admin으로 호출하면 `403 FORBIDDEN`. 토큰 없으면 `401 UNAUTHORIZED`.

## 3. Tag Promotion Job Cron 연결

`POST /admin/jobs/tag-promote`를 주기적으로 호출. 옵션:

**Vercel Cron (권장)** — `apps/web/vercel.json`에 추가:
```json
{
  "crons": [{
    "path": "/api/cron/tag-promote",
    "schedule": "0 */6 * * *"
  }]
}
```
그리고 `apps/web/src/app/api/cron/tag-promote/route.ts`에서 서버사이드로 API의 `/admin/jobs/tag-promote`를 호출 (Vercel cron secret으로 보호).

**GitHub Actions**:
```yaml
on:
  schedule:
    - cron: "0 */6 * * *"
jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.ADMIN_CRON_JWT }}" \
            https://api.tryhaggle.ai/admin/jobs/tag-promote
```

**Railway/Render cron** — 동일한 curl 커맨드, 6시간 간격 권장.

실행 결과는 `GET /admin/jobs/tag-promote/last`로 확인. 모든 실행은 `admin_action_log`에 `action_type='promotion.run'`로 기록.

## 4. 웹 Admin UI 접근

- URL: `https://tryhaggle.ai/admin` (인박스), `/admin/promotion-rules` (규칙)
- 인증: Supabase 세션 + `app_metadata.role === "admin"`
- 비-admin 접근 시 `/`로 redirect (`apps/web/src/app/(app)/admin/layout.tsx`)

## 5. 스모크 테스트 (수동)

1. admin 계정으로 `/admin` 접속 → SummaryCards 4개에 숫자 표시
2. Tags 탭 → pending 항목 클릭 → DetailDrawer 열림 → Approve 클릭 → 리스트에서 사라짐
3. `/admin/promotion-rules` → condition `candidate_min_use`를 5로 수정 → Save → 로우 업데이트 확인
4. "Run Now" 클릭 → 성공 토스트 → "Last run" 타임스탬프 갱신
5. `admin_action_log` SELECT → `tag.approve`, `rule.update`, `promotion.run` 로우 존재 확인

## 6. 롤백

스키마:
```sql
DROP TABLE IF EXISTS admin_action_log;
DROP TABLE IF EXISTS tag_promotion_rules;
```

코드: `git revert a063e1e 122e7e9 e7bbbc5 320748f 28b62f3` (역순).

## 알려진 제약 (Post-MVP 이관)

- `disputeEscalate`의 `toTier`는 클라이언트에서 `2`로 하드코드 (TODO 주석 있음 — tier picker UX 설계 후 반영)
- `paymentMarkReview`는 canned note만 전송 (free-form input은 post-MVP)
- Bulk actions / CSV export / 저장된 필터 없음
- Slack/이메일 알림 없음 — 운영자가 수동 폴링

---

*관련 커밋: 28b62f3, 320748f, e7bbbc5, 122e7e9, a063e1e*
*관련 계획: `docs/mvp/MVP_Final_Implementation_Plan.md` Steps 55~59* (없으면 `handoff/ARCHITECT-BRIEF-step59.md` 참조)
