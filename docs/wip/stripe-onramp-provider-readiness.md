# Stripe Onramp 실제 처리 경로 후속 검증

- 작업: `W2026-08-08-01`의 독립 카드 처리 slice
- 담당: 정행 (`jeonghaeng`), 사용자 별칭 `jeonghaengheo`
- 사용자 지시: checkout 수정·staging 배포 뒤 이어서 진행
- 브랜치: `feature/w2026-08-08-01-stripe-provider-readiness`
- 상태: 코드 검증 후 같은 head SHA 최종 CI를 확인하고 staging 통합. 계정의 Onramp 접근과 구매자 UI 검증은 별도 필요 조건.
- 리뷰어 승인 필수 아님. 기존 배정 및 상위 작업의 in_progress 상태를 유지한다.

## 발견한 문제와 변경

1. API는 native ESM인데 Stripe 실제 처리 factory가 전역 `require`를 사용해
   `STRIPE_MODE=real`일 때 `ReferenceError: require is not defined`가 발생한다.
   `node:module`의 `createRequire(import.meta.url)`로 같은 SDK를 지연 로딩한다.
   Stripe API 버전, provider 선택, 키·웹훅 필수 조건은 유지한다.
2. Stripe는 [`crypto.onramp_session.updated` 상태 변경 알림](https://docs.stripe.com/crypto/onramp/embedded#optional-listen-to-webhook-events)을 보낸다.
   기존 코드는 `crypto.onramp_session.fulfillment_complete` 이벤트 이름만 인식해 실제 완료 알림을 무시한다.
   updated 이벤트의 `data.object.status=fulfillment_complete`만 완료로 판정한다.
   기존 완료 이벤트 형식의 호환은 유지하고, initialized/requires_payment/processing/rejected/누락 상태는 완료로 처리하지 않는다.

웹훅 서명·환경 검증, 중복 claim, 주문·policy hash 검증, 종료 상태 조정 및 실제 지갑 예치 조건은
기존 경로를 사용한다. 카드 온램프 완료는 `ONRAMP_FUNDED`만 기록하며 계약 예치·주문 정산·배송 생성을 대신하지 않는다.

## 검증 증거

- 실제 source module을 별도 Node ESM 프로세스로 import해 이전 factory 오류를 재현했고,
  동일 실행 경로가 수정 뒤 통과한다. 단순 Vitest wrapper 실행으로는 이 오류가 드러나지 않았다.
- 실제 Stripe SDK의 서명 검증에서 올바른 HMAC는 통과하고 잘못된 서명은 거절한다.
- 실제 완료 판정 helper를 route 검사에서도 사용해 updated 완료를 처리하고 비완료 상태는
  deposit/payment funding을 기록하지 않는 것을 확인한다.
- 관련 결제·키 정책·웹훅·중복·순서 역전 검사 7개 파일 159건 통과. API 타입·빌드와 최종 CI를 확인한다.

## 운영 preflight와 남은 조건

2026-10-02 staging Railway 확인(비밀 값은 출력·기록하지 않음):

- `HAGGLE_ENV=staging`, `base-sepolia-husdc`, `base-sepolia` 유지.
- Stripe secret는 test 키이며 로컬 API 키와 같은 값이고 Stripe 일반 API 인증은 성공한다.
- Railway에는 Stripe publishable key와 webhook signing secret가 없다.
- `STRIPE_MODE` 미설정으로 mock 기본값이며 `HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS=true`다.
- 로컬 Web의 test publishable key는 존재한다. 계정 접근이 준비되면 같은 계정의 키인지 확인하고
  test webhook을 설정해야 한다. 키 값은 문서·채팅·PR에 남기지 않는다.
- Stripe test 계정의 staging webhook 등록 없음. Onramp GET 및 미결제 세션 준비 POST 모두
  `404 Unrecognized request URL`을 반환했다. 실제 세션이나 결제는 생성되지 않았다.
  Stripe 문서는 [테스트 환경도 Onramp 신청·승인이 필요](https://docs.stripe.com/crypto/onramp#submit-your-application)하다고 명시한다.
  이 404만으로 승인 여부를 확정하지 않으며 계정 Dashboard/접근 상태 확인이 필요하다.
- 현재 Codex 브라우저는 구매자 로그인 화면이다. 사용자에게 로그인과 대상 협상/checkout 주소를 요청했다.

이 변경으로 실제 카드 결제까지 완료됐다고 주장하지 않는다. 계정 접근이 준비된 뒤 test 키·웹훅과
테스트 provider 설정을 확인하고, 구매자 UI에서 온램프 → signed webhook → hUSDC 예치 순서를 검증한다.
실제 가치 자산, live Stripe, 유료 실배송, 계약 배포, 공유 DB migration, main/production은 활성화하지 않았다.
