# Production Checklist — 2026-08-22 Haggle Release

**상태:** Active release gate

**마지막 수정:** 2026-08-12

**범위:** 리스팅 → 협상 → 결제 → 배송 → 정산 또는 분쟁 전체 루프

**자금 정책:** 기능은 전체 포함하되 실제 가치 자산/live 결제 활성화는 후속 Go/No-Go

체크 표시에는 담당자, 확인 날짜, 증거 링크를 함께 남긴다. `통과한 것 같음`은 증거가 아니다.

## 1. 릴리스 기준선

- [ ] 릴리스 후보 SHA:
- [ ] staging 배포 SHA가 릴리스 후보 SHA와 일치
- [ ] 릴리스 책임자:
- [ ] DB migration 담당자:
- [ ] 배포 후 확인 담당자:
- [ ] incident/rollback 담당자:
- [ ] 8월 17일 이후 새 기능 없이 P0 수정만 반영
- [ ] `VERSION`과 `CHANGELOG.md`가 실제 릴리스 내용과 일치

## 2. GitHub와 리뷰

- [ ] 모든 릴리스 작업이 주간 작업 카드에 담당자 1명과 단일 리뷰어 1명을 기록
- [ ] DB, 인증, 결제, 정산, 스마트 계약, CI 변경의 단일 리뷰어가 해당 위험을 판단할 수 있음
- [ ] 모든 PR이 설명 중심 리뷰 브리핑과 검증 증거를 포함
- [ ] `staging` 직접 push 없이 PR과 최종 `CI`를 통과
- [ ] 개발 기간 중 `main` 변경 없음
- [ ] 최종 `staging → main` Deploy PR 외의 main PR 정리
- [ ] main 승격은 8월 22일 직전 Go 결정 후 한 번만 수행

## 3. 자동 검증

- [ ] `pnpm verify:migrations`
- [ ] `pnpm verify:db-invariants`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e:smoke`
- [ ] `pnpm audit:prod`
- [ ] 스마트 계약 `forge test`
- [ ] GitHub 최종 `CI`가 quality, dependency security, Playwright 결과를 모두 묶어 성공
- [ ] CI 실패 시 shared DB migration이 시작되지 않는 것 확인

## 4. 의존성 보안

2026-08-12 기준 production graph에서 49개의 high finding이 발견되었다. 중복 advisory를 정리한 임시 추적 목록은 `.security/audit-baseline.json`이며 8월 17일에 만료된다. baseline은 위험 수용이 아니다.

- [ ] 모든 critical: 0
- [ ] 새 high: 0
- [ ] baseline high 각각에 담당자와 `업데이트 / 도달 불가 증거 / 대체 / 제거` 결정 기록
- [ ] Next.js, Drizzle ORM, Fastify/Hono, URL·IP 처리, wallet 통신 경로 우선 조치
- [ ] 8월 17일까지 임시 high 예외 제거 또는 릴리스 책임자의 명시적 No-Go
- [ ] 새 production 의존성은 선택 이유, 유지관리 상태, audit 결과를 PR에 기록
- [ ] Dependabot PR을 매주 회의의 보안 항목으로 검토

## 5. DB와 migration

개별 migration 파일 번호를 문서에 복사하지 않는다. 저장소 journal과 자동 검증 결과가 단일 소스다.

- [ ] staging에서 릴리스 후보 SHA의 모든 migration 적용 성공
- [ ] production과 같은 snapshot/clone에서 전체 migration 사전 실행 성공
- [ ] `pnpm db:preflight:compat` 결과 검토
- [ ] transaction relation audit 결과 검토
- [ ] 기존 데이터를 완전히 검증하지 않은 FK(`NOT VALID`) 처리 또는 명시적 위험 결정
- [ ] production 백업 생성 시각과 복구 가능성 확인
- [ ] 비가역 migration의 forward-fix 절차와 담당자 기록
- [ ] production migration은 같은 main SHA의 최종 `CI` 성공 뒤에만 시작

## 6. 인증·네트워크·시크릿

- [ ] production JWKS와 key rotation 경로 검증
- [ ] CORS는 정확한 production origin만 허용
- [ ] service role, relayer, provider webhook secret은 플랫폼 secret store에만 존재
- [ ] secret과 개인정보가 로그·Playwright artifact·PR에 노출되지 않음
- [ ] distributed rate limiter가 다중 인스턴스에서 동작
- [ ] WebSocket ticket, 만료, 재연결, DB 장애 fallback 리허설
- [ ] production health와 readiness가 실제 의존성 상태를 구분

## 7. Staging 전체 사용자 흐름

Base Sepolia/hUSDC와 provider test 자산을 사용한다. 구매자와 판매자는 서로 다른 계정과 브라우저 세션을 사용한다.

- [ ] 판매자 가입·로그인 → 리스팅 → 공개 링크 발급
- [ ] 구매자 링크 진입 → 협상 → 가격 합의
- [ ] 합의 승인 → 주문과 payment intent 생성
- [ ] 구매자 지갑 연결 → 결제 요청 → funding receipt 확인
- [ ] webhook 재전송·중복에도 payment가 한 번만 확정
- [ ] 배송 주소 → rate → label → carrier 상태 반영
- [ ] 수령 확인 → ARP/release gate → 판매자 정산 receipt 확인
- [ ] 구매자 승소 분쟁 → release 동결 → 환불과 서버 장부 일치
- [ ] 판매자 승소 분쟁 → release 재개 → 정산과 서버 장부 일치
- [ ] 외부 provider timeout·5xx·webhook 지연 시 안전하게 재시도하거나 중단
- [ ] 새로고침·중복 클릭·동시 요청에도 중복 청구·배송·정산 없음
- [ ] 주요 단계의 운영 로그·감사 이벤트·경보 확인

## 8. 스마트 계약과 자산 프로필

- [x] 릴리스 후보 계약 테스트 전체 성공 — 2026-08-13 로컬 203개 + 실제 Base Sepolia 배포 코드 로컬 포크 5개 통과
- [ ] API 설정의 chain ID, contract 주소, asset 주소가 staging 배포와 일치
- [x] pause, signer rotation, fee cap, dispute freeze, refund/release invariant 동작 확인 — 단, pause가 기존 자금 출구까지 막는 위험과 ConditionalSettlement 즉시 signer 교체는 Go/No-Go 결정 필요
- [ ] Base Sepolia의 만료된 FUNDED 예치를 expire/refund 처리하고 계약 잔액과 이벤트·서버 장부 reconciliation — 2026-08-13 실제 expire 1건 1,041.42 hUSDC 성공, 관측 시점 만료 2건 2,495.00 hUSDC 남음
- [ ] receipt finality와 event 필드 검증 실패 시 서버 장부가 확정되지 않음
- [ ] 8월 22일 초기 운영에서 Base mainnet/실제 USDC가 비활성화됨을 확인

## 9. 외부 서비스와 운영

- [ ] Stripe test webhook과 재전송 검증
- [ ] x402/Base Sepolia facilitator failure/retry 검증
- [ ] EasyPost test label과 webhook 검증
- [ ] DeepSeek 장애·timeout·비정상 응답 fallback 검증
- [ ] alert receiver와 on-call 담당자에게 실제 테스트 경보 전달
- [ ] 결제·배송·정산 reconciliation 실행 방법 확인
- [ ] WORM/audit archive 또는 현재 대체 보존 방식 확인
- [ ] ToS와 Privacy 페이지 배포 확인

## 10. 배포 직전 Go / No-Go

다음 중 하나라도 해당하면 main 승격을 중단한다.

- [ ] 미해결 P0 없음
- [ ] critical 또는 만료된 high dependency 예외 없음
- [ ] 전체 결제·배송·정산/분쟁 staging 흐름 증거 있음
- [ ] migration, 백업, forward-fix 담당자가 대기 중
- [ ] 관찰·경보·incident 담당자가 대기 중
- [ ] 릴리스 후보 SHA 변경 없음
- [ ] 알려진 제한과 실제 자금 비활성화가 사용자·운영 설정과 일치

## 11. 배포 후

- [ ] production health/readiness
- [ ] 가입·로그인·리스팅·공개 링크
- [ ] 테스트 자산 결제 전체 흐름
- [ ] webhook queue와 failure rate
- [ ] DB connection, migration version, orphan/duplicate audit
- [ ] release/dispute 경보
- [ ] 30분·2시간·24시간 관찰 결과 기록

## 12. 실제 자금 활성화 — 후속 별도 게이트

아래는 8월 22일 코드 릴리스와 별개이며 모두 완료되기 전 live 자산을 켜지 않는다.

- [ ] 지갑 nonce 서명 challenge로 온램프 목적지와 판매자 payout 주소 소유권 검증
- [ ] production Base 계약 외부 감사와 mainnet 배포 checklist 완료
- [ ] 실제 USDC 소액 한도 리허설과 양쪽 분쟁 결과 확인
- [ ] live provider 키, webhook, 일별·거래별 한도, kill switch 확인
- [ ] 실제 자금 사고 runbook과 연락망 리허설
- [ ] 최종 자금 활성화 Go/No-Go 승인 기록

관련 문서:

- [Main Branch Release Policy](./Main_Branch_Release_Policy.md)
- [개발 그래프와 리뷰](./DEVELOPMENT_GRAPH_AND_REVIEW.md)
- [결제·배송·분쟁 보안 통제](./payment-shipping-dispute-security-controls.md)
- [운영 준비 사용자 작업](../wip/production-readiness-user-actions.md)
