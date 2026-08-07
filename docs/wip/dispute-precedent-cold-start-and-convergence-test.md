# 분쟁 판례 콜드스타트·수렴 실제 테스트

## 목적과 범위

이 문서는 staging에서 실제 PostgreSQL, DeepSeek V4 Pro, 분쟁 API를 사용해 다음 두 질문을 검증하는 실행 기준이다.

1. 승인 판례가 없을 때도 Resolution Assessor가 플랫폼 기준과 현재 증거만으로 안전하게 판단하는가?
2. 승인 판례가 축적될수록 같은 사실에 대한 판단이 안정되면서도 다수 결과 하나로 편향되지 않는가?

테스트 자산과 staging 주문만 사용한다. 결과는 자동 환불·정산으로 집행하지 않으며 사람 검토 전에는 production 판례로 승격하지 않는다.

## 2026-07-21 staging 시작점

읽기 전용 readiness 집계 결과는 다음과 같다.

| 항목 | 관찰값 |
|---|---:|
| 전체 분쟁 | 11 |
| 종료 상태 + 판정 레코드 | 3 |
| 수집 가능한 reason | `ITEM_NOT_AS_DESCRIBED`만 존재 |
| 수집 가능한 outcome | `partial_refund` 3건만 존재 |
| `dispute_precedents` 테이블 | 미적용 |
| 판례 보조 테스트 준비 | 미완료 |

세 사건은 후보 검토에는 쓸 수 있지만 그 자체로 콜드스타트를 해결하지 못한다. 모두 같은 reason과 outcome이므로 그대로 승인하면 부분 환불 편향을 만들 수 있다. 중복 fixture인지 먼저 확인하고 대표성이 없으면 `EXCLUDED`로 유지한다.

## 수렴의 정의

수렴은 판정 결과가 한 값으로 몰리는 현상이 아니다. 다음 조건을 함께 만족하는 상태다.

- 같은 case facts, evidence snapshot, model, policy, precedent snapshot으로 반복했을 때 결과가 안정적이다.
- 독립된 사람 검토 기준과의 일치도가 개선된다.
- 사용 가능한 판례 ID만 인용하고, 다른 결과를 선택하면 구별되는 사실을 설명한다.
- buyer/seller를 뒤집은 대칭 시나리오에서 증거 강도가 같다면 같은 기준을 적용한다.
- 증거 부족 사건은 억지로 직접 판정하지 않고 `escalate`한다.
- 특정 reason이나 `partial_refund` 같은 한 outcome으로 붕괴하지 않는다.

## 데이터 분리

각 사건은 아래 한 집합에만 속해야 한다.

| 집합 | 용도 | 판례 승인 가능 여부 |
|---|---|---|
| Seed | 분석·사람 검토 후 초기 판례 지식 구성 | 가능 |
| Holdout | 수렴·정확도 평가 | 해당 wave 종료 전 금지 |
| Challenge | prompt injection, 증거 충돌, 대칭성 등 안전성 평가 | 원칙적으로 제외 |

동일 `dispute_id`, 증거 hash, 사실을 조금 바꾼 복제 사건을 Seed와 Holdout에 나눠 넣지 않는다. 각 wave 시작 시 승인 판례 ID, analysis version, policy version, snapshot hash를 동결한다.

## 초기 시나리오 매트릭스

우선순위 reason은 `ITEM_NOT_AS_DESCRIBED`, `ITEM_NOT_RECEIVED`, `DELIVERY_EXCEPTION`이다. reason마다 최소 네 holdout 유형을 만든다.

1. buyer 증거가 명확히 강한 사건
2. seller 증거가 명확히 강한 사건
3. 양측 증거가 모두 유효해 비례 구제 또는 추가 검토가 필요한 사건
4. 증거 부족·충돌로 `escalate`가 필요한 사건

총 12개 holdout 사건을 만들고, 두 명이 모델 결과를 보기 전에 기대 결과와 핵심 판단 이유를 독립 작성한다. 불일치는 제3 검토로 확정한다. 각 사건은 같은 snapshot에서 강제 재평가로 3회 실행하므로 wave당 최소 36회 DeepSeek 판정 호출이 발생한다.

## Wave 실행 순서

### Wave 0: 판례 없는 baseline

1. migration 적용 후 후보는 수집하되 승인 판례를 0건으로 유지한다.
2. 12개 holdout의 evidence window를 닫고 격리 업로드가 0인지 확인한다.
3. 사건별 Resolution Assessor를 3회 실행한다.
4. 판정 event에서 model, policy version, evidence hash, 빈 precedent snapshot hash가 동일한지 확인한다.
5. 결과·confidence·escalation·사람 기준 일치도를 기록한다.

### Wave 1: 최소 Seed

1. Holdout과 겹치지 않는 종료 사건만 후보로 수집한다.
2. 개인정보 제거 분석을 작성하고 두 사람이 검토한다.
3. 우선순위 reason마다 최소 승인 3건, 서로 다른 outcome 2개를 확보한다.
4. 승인 판례 snapshot을 동결한 뒤 같은 Holdout 12건을 각각 3회 재평가한다.
5. baseline 대비 안정성, 사람 일치도, 근거 인용이 개선됐는지 비교한다.

### Wave 2+: 보강

오류가 집중된 reason/evidence pattern만 Seed를 보강한다. 현재 wave의 Holdout 결과를 같은 wave 판례로 즉시 편입하지 않는다. 다음 wave 전에 독립 검토와 승인을 거친다.

## 시작 게이트

`pnpm --filter @haggle/db db:report:precedent-readiness`는 식별자·원문 없이 집계만 출력한다. staging 변수로 실행할 때는 다음 명령을 사용한다.

```bash
railway run pnpm --filter @haggle/db db:report:precedent-readiness
```

기본 시작 하한은 reason별 승인 판례 3건과 서로 다른 outcome 2개다. 이는 통계적 운영 승인이 아니라 판례 보조 holdout을 시작하기 위한 최소값이다. 우선순위 reason은 `PRECEDENT_PRIORITY_REASONS`로 바꿀 수 있다.

`--require-ready`를 붙이면 판례 보조 시작 게이트 미달 시 종료 코드 1을 반환한다.

## 평가 지표

| 지표 | 초기 통과 기준 |
|---|---:|
| evidence/model/policy/precedent snapshot 무결성 | 100% |
| 허용되지 않은 판례 ID 인용 | 0건 |
| 동일 사건 3회 exact outcome 일치 | 전체 사건의 90% 이상 |
| 독립 사람 기준과 outcome 일치 | 80% 이상 |
| 높은 confidence의 오판 | 0건 |
| 증거 부족 시 escalation recall | 100% |
| 판례와 다른 결론의 구별 사실 설명 | 100% |
| 자동 환불·정산 실행 | 0건 |

표본이 작을 때 buyer/seller 유불리 비율만으로 공정성을 선언하지 않는다. 대칭 시나리오의 판단 이유와 evidence weight를 쌍으로 검토한다.

### 수렴 리포트 실행

각 wave는 실제 `dispute_ai_assessment_events`를 읽는 manifest를 별도 비공개 작업 파일로 만든다. 저장소에는 실제 dispute ID를 커밋하지 않는다.

```json
{
  "schema_version": "dispute-precedent-convergence-manifest-v1",
  "wave": "baseline",
  "started_at": "2026-07-21T18:00:00.000Z",
  "ended_at": "2026-07-21T20:00:00.000Z",
  "required_repeats": 3,
  "cases": [
    {
      "case_key": "inad-buyer-strong",
      "dispute_id": "00000000-0000-4000-8000-000000000000",
      "reason_code": "ITEM_NOT_AS_DESCRIBED",
      "expected_outcome": "buyer_favor"
    }
  ]
}
```

```bash
railway run pnpm --filter @haggle/db db:report:precedent-convergence \
  --manifest=/absolute/path/to/private-wave-manifest.json --require-pass
```

리포트는 `dispute_id`, 증거, 판정문 원문, 사용자 식별자를 출력하지 않는다. `case_key`별 반복 횟수와 outcome 집계, snapshot 안정성, 사람 기준 일치, 판례 인용 계약만 출력한다. `precedent_comparisons`가 snapshot에 없는 ID를 참조하거나, 중복 ID를 쓰거나, 전달된 승인 판례 중 하나라도 비교에서 누락하면 실패한다.

## 배포 전 순서

아래 작업은 각각 별도 승인 후 수행한다.

1. staging DB backup과 migration preflight
2. `dispute_precedents` migration 적용
3. API 배포: 승인 판례를 Resolution Assessor에 연결하고 snapshot을 감사 기록에 저장
4. 후보 수집 job 활성화 또는 1회 실행
5. Seed 분석·검토·승인
6. Wave 0/1 실제 판정 실행

migration과 API 중 하나만 적용된 중간 상태를 장시간 유지하지 않는다. production에는 staging holdout 결과와 사람 리뷰가 통과하기 전 적용하지 않는다.
