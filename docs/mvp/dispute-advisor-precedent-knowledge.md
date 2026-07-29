# Dispute Advisor 판례 지식 운영

## 목적

Advisor는 DeepSeek V4 Pro로 자연어 답변을 작성하지만 판례 원문을 요청 시점에 해석하지 않는다. 종료 사건은 별도 파이프라인에서 수집·분석·검토하고, Advisor에는 승인된 분석 요약만 제공한다. 이렇게 해야 판정 기준의 일관성, 개인정보 보호, 재현성을 함께 유지할 수 있다.

Advisor는 법원이나 법률 자문 서비스가 아니다. 전문적인 플랫폼 분쟁조정 언어로 사실, 쟁점, 증거, 플랫폼 기준, 유사 판례와 위험을 설명한다.

## 데이터 흐름

1. `dispute-precedent-collection` 작업이 종료된 `dispute_cases`와 `dispute_resolutions`를 하루 한 번 조회한다.
2. 후보에는 source dispute ID, reason code, outcome, 원본 snapshot hash만 저장한다. 당사자 증거와 판정문 원문은 복사하지 않는다.
3. 별도 오프라인 절차에서 개인정보를 제거한 사실 요약, 쟁점, 판단 원칙, 증거 프로필, 구별 요소, 구제 내용을 작성한다.
4. 분석 결과는 `DRAFT`로 저장하고 지정 검토자가 승인한다.
5. `APPROVED` 상태이면서 효력 기간 안에 있는 분석만 Advisor와 Resolution Assessor 컨텍스트에 들어간다.
6. Advisor 메시지 metadata와 AI 판정 감사 payload에 사용한 precedent ID, analysis/policy version, snapshot hash를 남긴다.

요청 시점 DeepSeek 호출은 5단계의 승인 요약만 읽는다. 원문 판례 분석, 후보 승인, 정책 변경은 할 수 없다. Resolution Assessor에는 현재 사건과 같은 reason code의 승인 판례만 최대 5개 전달하며 승인 판례가 없으면 빈 목록을 명시적으로 전달한다. 실제 판정 경로에서 코드에 내장된 예시를 승인 판례인 것처럼 사용하지 않는다.

## 상태 모델

| 상태 | 의미 | Advisor 조회 |
|------|------|--------------|
| `CANDIDATE` | 종료 사건을 수집했지만 분석 전 | 금지 |
| `DRAFT` | 사전 분석 완료, 검토 전 | 금지 |
| `APPROVED` | 검토자가 승인하고 효력 시작 | 허용 |
| `RETIRED` | 새 정책이나 판례로 대체 | 금지 |
| `EXCLUDED` | 품질·대표성·개인정보 사유로 제외 | 금지 |

## 분석 레코드

`dispute_precedents`는 기존 거래 장부를 변경하지 않는 추가 테이블이다.

- 출처: `source_dispute_id`, `source_snapshot_sha256`
- 분류: `reason_code`, `outcome`
- 분석: `facts_summary`, `issue_summary`, `decision_principle`
- 증거: `evidence_profile`, `distinguishing_factors`
- 버전: `analysis_version`, `policy_version`
- 승인: `approved_by`, `approved_at`, `effective_from`, `effective_until`

승인 레코드는 필수 분석·버전·승인 필드가 모두 있어야 한다. 출처 snapshot hash가 달라지면 기존 분석을 덮어쓰지 않고 재검토한다.

## Advisor 출력 기준

실질적인 사건 분석에는 다음 순서를 사용한다.

1. 사실관계
2. 핵심 쟁점
3. 적용 기준
4. 유사 판례와 구별되는 사실
5. 증거 평가
6. 예상 결정 범위
7. 권고 조치와 비용·위험

판례를 사용할 때 `Haggle Precedent <ID>`를 인용한다. 가까운 승인 판례가 없으면 없다고 밝히고 현재 증거와 플랫폼 기준만으로 분석한다.

## 모델과 보안 설정

- Advisor 모델: `DEEPSEEK_MODEL`, 기본값 `deepseek-v4-pro`
- API 자격증명: `DEEPSEEK_API_KEY`
- 프롬프트 무결성 탐지 비밀값: `CANARY_SECRET`
- 후보 수집: `ENABLE_CRON=true`와 `ENABLE_DISPUTE_PRECEDENT_COLLECTION_JOB=true`

`CANARY_SECRET`은 서버에서 생성한 검증 토큰에 서명하는 임의의 고엔트로피 비밀값이다. 사용자 인증, 결제, 지갑 서명에는 사용하지 않으며 브라우저와 로그에 노출하지 않는다.

## 운영 게이트

- 수집 작업과 Advisor 조회는 분리한다.
- 분석 저장 함수는 LLM을 호출하지 않는다.
- 승인 권한은 일반 사용자 API에 노출하지 않는다.
- 원본 증거, 주소, 이메일, 지갑 주소를 판례 요약에 넣지 않는다.
- 분석 및 정책 버전과 사용한 판례 ID를 감사 metadata에 남긴다.
- 승인 판례 snapshot이 바뀌면 동일 evidence라도 기존 AI 판정을 idempotent 결과로 재사용하지 않는다.
- migration 적용, cron 활성화, staging/production 배포는 명시적 승인 후 수행한다.

콜드스타트, Seed/Holdout 분리, 실제 수렴 기준은 [분쟁 판례 콜드스타트·수렴 실제 테스트](../wip/dispute-precedent-cold-start-and-convergence-test.md)를 따른다.
