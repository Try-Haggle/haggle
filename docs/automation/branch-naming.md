# 자동화 브랜치 네이밍 규칙

이 문서는 Haggle 자동화가 태스크 작업용으로 만들 수 있는 브랜치 이름 규칙을 정의합니다.

## 목표

자동화가 만든 브랜치는 브랜치를 만든 사람이나 실행 시스템이 아니라 태스크와 변경 범위를 설명해야 합니다. 이렇게 해야 PR 리뷰가 작업 자체에 집중되고, 장기 git 히스토리에 담당자 정체성이 불필요하게 남지 않습니다.

## 허용 형식

자동화가 만드는 모든 태스크 브랜치는 아래 형식을 사용합니다.

```text
<type>/<task-id-or-short-id>-<short-slug>
```

허용되는 `type` 값:

| Type | 사용 기준 |
| --- | --- |
| `feature` | 사용자 또는 제품 기능을 추가할 때 |
| `fix` | 잘못된 동작이나 regression을 수정할 때 |
| `chore` | 문서, 테스트, 도구, 설정, 유지보수성 파일만 바꿀 때 |
| `hotfix` | production 영향이 있는 긴급 문제를 수정할 때 |

`<task-id-or-short-id>` 규칙:

- ClickUp task id를 우선 사용합니다. 예: `86b9z6tz3`.
- 원본 태스크에 custom id가 있으면 안정적인 short id를 사용할 수 있습니다.
- id는 담당자가 아니라 태스크를 식별해야 합니다.

`<short-slug>` 규칙:

- 소문자 ASCII 단어를 hyphen으로 연결합니다.
- PR과 CI 화면에서 한눈에 읽을 수 있게 짧게 유지합니다.
- 변경되는 동작, 화면, 문서, 범위를 설명합니다.
- 사람, 이니셜, 구현 에이전트, 프로세스 라벨은 넣지 않습니다.

## 금지어

자동화가 만드는 브랜치명에는 아래 항목을 넣지 않습니다.

- 사람 이름
- 사람 이니셜
- `jh`
- `jeonghaeng`
- `codex`
- `automation`

브랜치명은 태스크와 변경 범위만 나타내야 합니다.

## 좋은 예시

```text
feature/86b9z6tz3-payment-alerts
fix/86b9z6tz3-refund-status
chore/86b9zh1xb-branch-naming-docs
hotfix/86b9zabc1-webhook-retry
```

## 나쁜 예시

```text
jh-payment-alerts
feature/jeonghaeng-payment-alerts
fix/86b9z6tz3-codex-refund-status
chore/86b9zh1xb-automation-branch-doc
feature/jh-86b9z6tz3-payment-alerts
```

## 자동화 체크리스트

구현을 시작하기 전에 파이프라인은 아래 항목을 확인해야 합니다.

1. worktree에 관련 없는 dirty changes가 없습니다.
2. 태스크 브랜치는 최신 `origin/main` 또는 repo 기본 브랜치에서 시작합니다.
3. 브랜치명은 `<type>/<task-id-or-short-id>-<short-slug>` 형식과 일치합니다.
4. 브랜치명에 금지어가 없습니다.
5. 실제 현재 브랜치가 의도한 태스크 브랜치와 일치합니다.
6. 구현 완료 댓글에 실제 브랜치, HEAD SHA, `origin/main..HEAD` 커밋 수, 변경 파일 목록을 기록합니다.

하나라도 실패하면 파이프라인은 안전하지 않은 브랜치에서 구현하지 않고 중단/차단 상태를 보고해야 합니다.
