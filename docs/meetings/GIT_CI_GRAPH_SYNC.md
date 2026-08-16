# Git·CI 작업 그래프 자동 동기화 계약

**상태:** 설계 완료, 자동화 미구현

**적용 대상:** `docs/meetings/current-week-work-graph.json`

이 문서는 GitHub의 브랜치·PR·리뷰·CI·병합·배포·migration 결과를 주간 작업 그래프에 자동으로
반영하는 규칙을 정의한다. 현재는 사람이 증거를 기록한다. 자동화 workflow와 동기화 스크립트가
실제로 병합되기 전까지 대시보드의 값은 자동 수집된 것으로 간주하지 않는다.

## 1. 자동화의 경계

자동화는 이미 발생한 기계적 사실을 기록한다. 사람의 배정과 판단을 대신하지 않는다.

| 자동으로 기록할 사실 | 사람이 직접 결정할 값 |
|---|---|
| 브랜치명, PR 번호·상태·base, head/merge SHA | `ownerId`, `reviewerId`, `reviewerAssignmentStatus` |
| 지정 리뷰어의 요청·승인·승인 취소 시각 | 작업 범위, 우선순위, `dependsOn`, 담당 변경 |
| CI job의 대기·성공·실패와 실행 링크 | 수동 리허설 결과와 위험 수용 여부 |
| staging/main 병합과 배포 상태·환경·SHA | 작업의 최종 `done` 판단 |
| DB migration 실행 상태와 SHA | 릴리스의 최종 `GO` 결정 |

유효한 작업 ID가 붙은 첫 push 또는 PR 생성은 `planned` 작업을 `in_progress`로만 단조롭게 전환할
수 있다. 자동화는 작업을 `unassigned`, `blocked`, `done`으로 바꾸지 않으며 담당자나 리뷰어를
추측하지 않는다. PR 병합은 통합 사실일 뿐 작업 완료나 릴리스 승인을 의미하지 않는다.

## 2. 작업과 Git 이벤트를 연결하는 키

모든 feature 브랜치와 PR에는 정확히 하나의 작업 ID를 넣는다.

```text
branch: codex/W2026-08-15-06-git-ci-graph-sync
PR title: [W2026-08-15-06] Git·CI 그래프 동기화
PR body: Work graph: W2026-08-15-06
```

다음 경우에는 자동화가 작업을 고르지 않는다.

- 작업 ID가 없거나 그래프에 존재하지 않는다.
- 서로 다른 작업 ID가 둘 이상 발견된다.
- PR의 head SHA와 CI·배포·migration SHA가 서로 다르다.
- GitHub 리뷰어가 그래프의 단일 리뷰어와 연결되지 않는다.

이때 기존 값을 덮어쓰지 않고 `releaseDashboard.graphAutomation.syncIssues`에 원인, 이벤트 링크,
발견 시각을 기록한다.

## 3. 수집할 이벤트와 반영 규칙

| GitHub 또는 배포 사건 | 그래프에 반영할 결과 |
|---|---|
| feature branch push | 작업 ID, branch, head SHA, `observedState: branch_pushed` |
| PR opened/reopened/synchronize | PR 번호·URL·base·head SHA, `observedState: pr_open` |
| review requested/submitted/dismissed | 지정 단일 리뷰어의 요청·승인·취소 상태와 시각 |
| check suite/workflow run | quality, build, unit/integration, Playwright, dependency audit, 최종 CI 상태·URL·SHA |
| PR merged to `staging` | merge SHA와 `observedState: merged_to_staging` |
| staging deployment status | Vercel·Railway 등 환경별 성공·실패·URL·배포 SHA |
| migration workflow | 사전검사·실행·성공·실패와 대상 환경·SHA |
| `staging → main` PR | 릴리스 후보 SHA와 승격 PR 상태 |
| PR 없는 staging/main push | 정책 위반 `syncIssue`; 완료 또는 GO로 처리하지 않음 |

CI와 배포 상태는 이벤트 한 건만 믿지 않고 GitHub API에서 현재 전체 상태를 다시 조회한다. 늦게 도착한
이벤트나 재전송 때문에 성공이 과거의 대기 상태로 되돌아가면 안 된다.

## 4. 그래프에 저장할 자동 증거

구현 시 작업별 `machineEvidence`는 아래 형태로 추가한다. 같은 `source`와 `eventId`는 새 항목을
추가하지 않고 갱신한다.

```json
{
  "source": "github",
  "eventId": "workflow-run:123456",
  "kind": "ci",
  "status": "passed",
  "taskId": "W2026-08-15-06",
  "sha": "full-commit-sha",
  "url": "https://github.com/.../actions/runs/123456",
  "observedAt": "2026-08-15T20:30:00-06:00"
}
```

사람이 작성한 `evidence`와 자동 수집한 `machineEvidence`는 분리한다. 자동화는 사람이 남긴 증거를
삭제하거나 문장을 다시 쓰지 않는다. 최상위 `releaseDashboard.graphAutomation`에는 다음 운영 상태를
둔다.

- `status`: `planned`, `report_only`, `bot_pr`, `enforced` 중 하나
- `lastSyncedAt`: 마지막으로 성공한 전체 동기화 시각
- `lastEventId`: 마지막으로 처리한 이벤트 식별자
- `workflowVersion`: 동기화 규칙 버전 또는 commit SHA
- `syncIssues`: 연결 실패, SHA 불일치, 권한 부족, 오래된 증거

## 5. 릴리스 게이트 계산

자동화는 각 게이트의 근거를 계산할 수 있지만 최종 `GO`를 선언하지 않는다.

1. 연결된 작업의 필수 CI가 같은 SHA에서 모두 성공했는지 확인한다.
2. 그래프의 `confirmed` 단일 리뷰어와 GitHub 승인자가 같은지 확인한다.
3. staging 병합 SHA, migration SHA, Vercel·Railway 배포 SHA가 릴리스 후보와 같은지 확인한다.
4. 게이트가 요구하는 headed 리허설, 실제 webhook, 장부 대조 같은 수동 증거가 있는지 확인한다.
5. 하나라도 실패하면 `blocked`, 아직 없으면 `needs_evidence`, 전부 모이면 `ready_for_human_go`로
   제안한다.

팀은 이 계산 결과와 알려진 위험을 보고 회의에서 최종 `GO`, `조건부 GO`, `NO-GO`를 기록한다.

## 6. 구현 구조

자동화 작업 `W2026-08-15-06`의 구현 기본안은 다음과 같다.

```text
GitHub event
  → .github/workflows/work-graph-sync.yml
  → GitHub API에서 PR·review·check·deployment의 현재 상태 재조회
  → scripts/sync-work-graph.mjs가 결정적으로 upsert
  → 그래프 schema와 pnpm work:me -- --all 검증
  → 전용 bot 브랜치의 하나의 열린 PR을 생성 또는 갱신
```

봇이 `staging`에 직접 push하지 않는 이유는 작업 그래프도 리뷰 가능한 운영 기록이기 때문이다. bot PR은
사람의 배정·범위·완료 판단을 보존하면서 자동 증거만 갱신한다.

보안과 안정성 규칙은 다음과 같다.

- fork 또는 외부 PR의 신뢰하지 않은 코드를 write token으로 실행하지 않는다.
- workflow 권한은 `contents: write`, `pull-requests: write`, `actions: read`, `deployments: read`의 필요한
  범위로 제한한다.
- `concurrency`로 저장소당 동기화 하나만 실행하고, 이벤트 재실행은 같은 결과를 내도록 멱등하게 만든다.
- bot commit·label·path filter로 자기 PR이 다시 동기화를 무한 호출하지 않게 한다.
- API 오류나 schema 검증 실패 시 그래프를 쓰지 않고 workflow를 실패시킨다.
- 공유 DB migration은 같은 SHA의 최종 CI가 성공한 경우에만 별도 승인 workflow가 실행한다.

## 7. 단계별 도입

1. **현재 — 수동 기록:** 이 계약을 기준으로 사람이 증거와 SHA를 기록한다.
2. **Report only:** 이벤트를 읽고 예상 diff와 연결 오류만 CI summary에 출력한다.
3. **Bot PR:** 자동 증거를 전용 PR에 upsert하고 지정 리뷰어가 운영 기록을 확인한다.
4. **Gate derivation:** 같은 SHA 규칙과 필수 증거로 `ready_for_human_go`를 계산한다.
5. **Enforced:** GitHub ruleset과 required check가 우회 병합을 차단한다.

단계가 바뀔 때 `releaseDashboard.graphAutomation.status`를 갱신한다. workflow가 존재하지 않는데
`bot_pr` 또는 `enforced`로 표시해서는 안 된다.

## 8. 검증 시나리오

구현 PR에는 최소한 다음 replay fixture 또는 통합 테스트가 필요하다.

- 작업 ID가 있는 PR 생성과 새 commit push
- CI 대기 → 실패 → 재실행 성공
- 지정 리뷰어 승인과 승인 취소
- staging 병합 및 두 배포 중 하나만 성공한 상태
- 같은 SHA CI 성공 전 migration 요청 차단
- 동일 이벤트 재전송과 역순 이벤트
- 작업 ID 없음·여러 개·존재하지 않음
- 자동 동기화 뒤에도 owner, reviewer, dependsOn, 수동 evidence가 그대로 유지됨
- PR 없는 staging/main push가 정책 위반으로 표시됨

## 9. 수동 운영 fallback

자동화가 아직 없거나 고장 난 경우 작업 담당자는 PR 링크, 정확한 SHA, CI run, 리뷰 승인, 배포와
migration 링크를 그래프에 직접 기록하고 `asOf`를 갱신한다. 회의에서는 `lastSyncedAt`이 비어 있거나
오래됐으면 자동 증거로 취급하지 않고 GitHub 원본과 대조한다.
