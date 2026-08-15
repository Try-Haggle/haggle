# Haggle Main Branch Release Policy

**Version:** 2.0

**Date:** 2026-08-12

**Status:** Active

**Target release:** 2026-08-22

## 1. 목적

이 문서는 8월 22일 릴리스까지 `staging`에서 공동 개발하고, 릴리스 직전에만 검증된 한 커밋을 `main`으로 승격하는 기준을 고정한다.

`main`은 일상 개발 브랜치가 아니다. 개발 중에는 `main`에 직접 push하거나 중간 결과를 병합하지 않는다.

## 2. 8월 22일 제품 범위

릴리스 범위는 단순 협상 데모가 아니라 다음 거래 루프 전체다.

1. 판매자 리스팅과 공개 링크
2. 구매자 유입과 AI 협상
3. 합의 가격 승인과 주문 생성
4. 구매자 결제 준비·승인·funding 확인
5. 배송 라벨과 배송 상태 반영
6. 수령 확인과 정산 release
7. 분쟁 생성, release 동결, 판정과 환불 또는 정산
8. 온체인 receipt와 서버 장부의 일치 확인

즉, 결제·배송·분쟁·escrow 성격의 조건부 정산·USDC/x402·스마트 계약은 MVP 안에 포함된다.

## 3. 기능 릴리스와 실제 자금 활성화의 구분

8월 22일에는 결제까지 끝나는 제품과 코드 경로를 릴리스한다. 다만 실제 가치가 있는 자산과 live 결제·지급을 켜는 것은 별도 운영 단계다.

- staging과 초기 릴리스 검증: Base Sepolia, hUSDC 또는 가치 없는 테스트 자산, Stripe test, EasyPost test를 기본으로 한다.
- 실제 자금 활성화: 지갑 소유권 검증, mainnet 계약·USDC 리허설, 운영 키와 한도, 경보와 당직, 외부 감사 등 `payment-shipping-dispute-security-controls.md`의 실제 자금 P0를 모두 닫은 뒤 별도 Go/No-Go로 시행한다.
- 테스트 자산에서 성공했다는 이유만으로 live 자산을 자동 활성화하지 않는다.

이 구분은 결제 기능을 릴리스 범위에서 제외한다는 뜻이 아니다. 기능 범위는 전체 거래 루프이고, 실제 돈을 이동시키는 운영 스위치만 후속 승인 대상으로 둔다.

## 4. 브랜치와 승격 정책

```text
weekly task → feature/* → PR → staging → 통합·릴리스 리허설
                                        → release candidate SHA 고정
                                        → 최종 staging → main Deploy PR
```

- 모든 feature 브랜치는 `staging`에서 분기한다.
- 모든 feature는 지정 리뷰어의 승인을 받고 `staging`에 병합한다.
- 개발 기간에는 `main`을 변경하지 않는다.
- 기능 동결 후 staging의 릴리스 후보 SHA를 기록하며, 검증 중 SHA가 바뀌면 영향을 받은 검증을 다시 실행한다.
- 8월 22일 직전 최종 Go 결정 후에만 `staging → main` Deploy PR을 병합한다.
- `main` 직접 push와 staging을 건너뛴 병합은 금지한다.

## 5. main 승격 필수 증거

최종 Deploy PR에는 다음을 코드 줄이 아니라 사용자 흐름과 결과로 설명한다.

- 릴리스 후보 SHA와 staging 배포 SHA가 같다는 증거
- 전체 자동 `CI` 성공
- production dependency audit 결과와 high/critical 처리 결과
- Playwright smoke 및 staging 전체 거래 흐름 결과
- 결제·배송·분쟁의 happy path와 양쪽 분쟁 결과
- DB migration 사전검사, 백업 확인, 적용·복구 계획
- 스마트 계약 테스트와 배포 주소·체인·자산 프로필 확인
- 알려진 제한과 live 자금이 비활성화되어 있다는 확인
- 배포 후 확인 담당자와 문제 발생 시 중단 기준

## 6. 자동화 순서

자동화는 다음 순서를 강제한다.

1. 품질·빌드·단위/통합 테스트
2. Playwright 브라우저 smoke
3. production dependency security audit
4. 최종 `CI` 관문
5. 같은 SHA의 staging 또는 production DB migration
6. 앱 배포와 배포 후 사용자 흐름 확인

CI와 DB migration을 독립적으로 동시에 실행하지 않는다. PR 검증은 공유 DB를 변경하지 않는다.

## 7. 리뷰 정책

토요일 주간 회의에서 구현 담당자 1명과 단일 리뷰어 1명을 함께 정한다. 보호 영역도 리뷰어를 추가하지 않고, 해당 위험을 판단할 수 있는 한 사람을 선택한다. PR은 `DEVELOPMENT_GRAPH_AND_REVIEW.md`의 설명 중심 브리핑을 사용한다.

결제, 정산, 인증, DB, 스마트 계약, CI/배포는 보호 영역이다. 지정된 한 명의 리뷰어가 해당 영역 관점까지 확인할 수 있어야 한다.

## 8. 예외

릴리스 차단 문제를 고치는 긴급 변경도 feature 브랜치, 자동 검사, 리뷰를 거친다. 절차를 생략하는 hotfix는 허용하지 않는다. 실제 사고 대응으로 예외가 불가피하면 변경 이유, 승인자, 영향, 복구 결과를 사후 기록한다.

## 9. 관련 기준

- [개발 그래프와 리뷰 운영](./DEVELOPMENT_GRAPH_AND_REVIEW.md)
- [Production Checklist](./PRODUCTION_CHECKLIST.md)
- [결제·배송·분쟁 보안 통제](./payment-shipping-dispute-security-controls.md)
- [환경 분리 플레이북](../wip/Environment_Separation_Playbook.md)
