# Haggle Smart Contract Security Report

**날짜**: 2026-03-31
**컨트랙트**: HaggleSettlementRouter + HaggleDisputeRegistry
**네트워크**: Base L2 (Optimism Stack)
**Solidity**: 0.8.24 | **OpenZeppelin**: v5.x

---

## 요약

이 보고서의 기존 4라운드 감사와 148개 테스트 수치는 `HaggleSettlementRouter`와
`HaggleDisputeRegistry`에만 해당한다. 이후 추가된 `HaggleConditionalSettlement`는 아래의
2026-08-13 검증 부록 범위로 구분하며, 독립적인 외부 보안 감사를 받았다는 뜻으로 해석하지 않는다.

| 항목 | 수치 |
|------|------|
| 총 보안 리뷰 라운드 | 4회 |
| 총 테스트 수 | **148** (95 Router + 52 Registry + 1 Invariant) |
| 수정된 Critical/High | **10건** |
| 수정된 Medium | **14건** |
| Fuzz 테스트 | 3개 (각 1,000 runs) |
| Invariant 테스트 | 1개 (256 runs × 16,384 calls) |

---

## 2026-08-13 ConditionalSettlement 검증 부록

### 실행 증거

- 조건부 정산 로컬 테스트 49개 통과: funding, release/refund, dispute, expiry, pause,
  signer rotation, EIP-1271 contract signer, 잘못된 주소·nonce·서명·금액·수수료·중복 실행 경계.
- 전체 로컬 계약군 203개 통과: Router fuzz 2개(각 1,000 runs), Registry fuzz 1개(1,000 runs),
  Router invariant 1개(256 runs × 16,384 calls) 포함.
- Base Sepolia 실제 배포 코드를 읽은 로컬 포크 테스트 5개 통과: manifest 설정, exact split release,
  signed refund, dispute 후 refund, permissionless expiry. 원격 체인에는 트랜잭션을 전송하지 않았다.
- `forge coverage --ir-minimum` 기준 ConditionalSettlement 96.43% lines, 94.12% statements,
  83.87% branches, 95.83% functions. `viaIR` 우회로 source mapping 경고가 있어 수치는 보조 증거로만 쓴다.

### 실제 Base Sepolia 상태 대조

2026-08-13 약 17:05 UTC 읽기 기준으로 ConditionalSettlement는 4,006.42 hUSDC를 보유했다.
이 금액은 5개의 `SettlementFunded` 이벤트 합계와 정확히 일치했고 release/refund 이벤트는 없어서,
직접 송금으로 생긴 미회계 잔액은 확인되지 않았다. 다만 5개가 모두 `FUNDED`였으며 그중 3개,
합계 3,536.42 hUSDC는 이미 만료됐다. 나머지 2개는 관측 시점 뒤 만료 예정이었다. `expire`는
permissionless지만 자동 실행되지 않으므로 만료 예치 탐지·환불 실행·receipt reconciliation이 필요하다.

같은 날 후속 실제 네트워크 검증에서 만료된 1건(1,041.42 hUSDC)에 `expire`를 제출했다.
Base Sepolia 트랜잭션 `0xc6deffa8f786f4635b72db9d62507251a8603ca39db904bb93f28593937a2142`는
status 1로 확정됐고 settlement 상태가 `FUNDED`에서 `REFUNDED`로 변경됐다. 계약 잔액은
4,006.42에서 2,965.00 hUSDC로 감소하고 구매자 잔액은 같은 1,041.42 hUSDC만큼 증가해
실제 배포 계약의 permissionless expiry 환불과 이벤트를 확인했다. 이 실행 뒤 FUNDED는 4건이며,
관측 시점에 이미 만료된 것은 2건 합계 2,495.00 hUSDC다.

### 릴리스 전 미해결 판단

| 항목 | 현재 동작 | 필요한 결정 |
|------|-----------|-------------|
| 장기 pause 시 기존 예치 | `release`, signed `refund`, `expire`가 모두 중단되어 자금이 잠길 수 있음 | 최대 pause 시간과 긴급 unpause runbook을 정하거나, 기존 자금 출구를 pause에서 제외할지 리뷰 |
| Conditional signer 교체 | owner가 `setSigner`를 즉시 실행하고 nonce가 증가 | Router와 같은 지연 교체·긴급 freeze가 필요한지 실제 자산 전환 전 결정 |
| 만료 예치 처리 | 누구나 `expire` 가능하지만 자동 실행자 없음 | watcher/keeper, 재시도, receipt 확인과 경보 담당 지정 |
| 외부 분석 | 정적 분석기와 독립 감사 증거 없음 | 실제 USDC 전환 전 Slither/Aderyn 등 정적 분석과 독립 리뷰 수행 |

---

## 컨트랙트 아키텍처

### HaggleSettlementRouter
> Non-custodial 정산 라우터. USDC를 buyer → seller + fee wallet로 라우팅.
> 자금을 보유하지 않음 — 모든 전송은 즉시 실행.

```
Buyer ──[approve]──→ Router ──[transferFrom]──→ Seller Wallet
                         └──[transferFrom]──→ Fee Wallet
```

**보안 모델:**
1. `msg.sender == buyer` — 호출자가 반드시 구매자
2. EIP-712 서명 — 백엔드가 파라미터 서명 (조작 방지)
3. 주문별 1회 정산 (`settledOrders`)
4. 허용된 자산만 (`allowedAssets`)
5. 수수료 상한 10% (`MAX_FEE_BPS = 1000`)
6. 2단계 사이너 교체 + 48시간 딜레이
7. 긴급 일시정지 (Guardian + Owner)

### HaggleDisputeRegistry
> 분쟁 해결 결과 온체인 기록. 자금 미보유 — 순수 기록 보관.

**보안 모델:**
1. Resolver 역할 분리 (Owner ≠ Resolver)
2. Ownable2Step — 2단계 소유권 이전
3. 주문당 최대 50개 앵커 (DoS 방지)
4. 중복 분쟁 방지 (`disputeAnchored`)

---

## 라운드별 수정 내역

### 1차 리뷰: 기본 보안 강화

| # | 취약점 | 심각도 | 수정 |
|---|--------|--------|------|
| 1 | 미인가 주소 정산 가능 | **Critical** | `CallerNotBuyer` 체크 |
| 2 | 서명 없이 정산 가능 | **Critical** | EIP-712 서명 검증 |
| 3 | 동일 주문 중복 정산 | **High** | `settledOrders` 매핑 |
| 4 | 금액 불일치 허용 | **High** | `sellerAmount + feeAmount == grossAmount` |
| 5 | 수수료 무제한 | **High** | `MAX_FEE_BPS = 1000` (10% 상한) |
| 6 | EIP-712 없이 서명 | Medium | EIP-712 구조화 서명 |
| 7 | 사이너 즉시 교체 | Medium | 2단계 교체 + 48시간 딜레이 |
| 8 | renounceOwnership 허용 | Medium | revert("disabled") |
| 9 | 최소 금액 미검증 | Medium | `MIN_GROSS_AMOUNT = 1e4` |

### 2차 리뷰: 엣지 케이스 방어

| # | 취약점 | 심각도 | 수정 |
|---|--------|--------|------|
| 1 | EIP-1271 미지원 (EOA 전용) | **High** | `SignatureChecker` 도입 |
| 2 | 정산 상한 미설정 | **High** | `maxSettlementAmount` 추가 |
| 3 | 라우터 주소로 전송 | Medium | `RecipientIsRouter` 체크 |
| 4 | deadline 미검증 | Medium | `DeadlineExpired` 체크 |
| 5 | DuplicateDispute 미방지 | Medium | `disputeAnchored` 매핑 |

### 3차 리뷰: CEI + 거버넌스

| # | 취약점 | 심각도 | 수정 |
|---|--------|--------|------|
| 1 | **CEI 패턴 위반** | **High** | `settledOrders` → `_verifySigner` 순서 교정 |
| 2 | Ownership 이전 시 resolver 불일치 | **High** | `_transferOwnership` override (Registry) |
| 3 | `confirmSigner` 소셜 엔지니어링 | Medium | `expectedSigner` 파라미터 추가 |
| 4 | Guardian pause 그리핑 | Medium | `PAUSE_COOLDOWN = 1 hours` |
| 5 | `proposeSigner` 덮어쓰기 이벤트 누락 | Medium | `SignerRotationCancelled` emit |
| 6 | Ownership 이전 시 pending rotation 잔류 | Medium | `_transferOwnership` override (Router) |

### 4차 리뷰: Red Team (공격자 관점)

| # | 취약점 | 심각도 | 수정 |
|---|--------|--------|------|
| 1 | 사이너 키 탈취 시 48시간 공격 창 | **Medium-High** | `emergencyFreezeSigner()` |
| 2 | 분쟁 기록 영구 수정 불가 | **Medium** | `supersedeAnchor()` |
| 3 | buyer == seller 자기 정산 | Low | `BuyerIsSeller` 체크 |
| 4 | sellerWallet == feeWallet 수수료 유실 | Low | `FeeWalletEqualsSeller` 체크 |

### 수동 관리자 오버라이드 기능

| 컨트랙트 | 함수 | 용도 |
|----------|------|------|
| Router | `adminResetOrder(orderId)` | 잘못된 정산 리셋 → 재정산 가능 |
| Router | `adminVoidOrder(orderId, reason)` | 사기 주문 영구 차단 |
| Registry | `supersedeAnchor(oldId, evidence, resolution)` | 잘못된 분쟁 기록 교체 (원본 보존) |
| Registry | `revokeAnchor(anchorId, reason)` | 분쟁 기록 무효화 (재앵커링 가능) |

---

## Red Team 분석 — 안전 확인된 공격 벡터

| 공격 유형 | 결과 | 방어 메커니즘 |
|----------|------|-------------|
| 크로스체인 서명 리플레이 | **SAFE** | EIP-712 + block.chainid |
| 서명 위변조 (malleability) | **SAFE** | OZ ECDSA (high-s 차단) |
| 프론트러닝 정산 | **SAFE** | CallerNotBuyer |
| 수수료 조작 (전액 리다이렉트) | **SAFE** | MAX_FEE_BPS 10% 상한 |
| 플래시론 공격 | **SAFE** | 오라클/AMM 미사용 |
| 재진입 (EIP-1271 콜백) | **SAFE** | CEI + nonReentrant |
| 재진입 (ERC-777 토큰 훅) | **SAFE** | nonReentrant |
| orderId 선점 | **SAFE** | 사이너 서명 필요 |
| 더스트 스팸 | **SAFE** | MIN_GROSS_AMOUNT |
| 허용량 조작 DoS | **SAFE** | CallerNotBuyer |

---

## 컨트랙트 함수 목록

### HaggleSettlementRouter

**Core:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `executeSettlement(params, sig)` | Public (buyer만) | 정산 실행 |

**Admin — Signer:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `proposeSigner(newSigner)` | Owner | 새 사이너 제안 (48h 딜레이) |
| `confirmSigner(expectedSigner)` | Owner | 사이너 교체 확정 |
| `cancelSignerRotation()` | Owner | 제안 취소 |
| `emergencyFreezeSigner()` | Owner | 사이너 즉시 동결 (긴급) |

**Admin — Guardian:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `setGuardian(addr)` | Owner | 가디언 설정/제거 |
| `pause()` | Owner/Guardian | 긴급 일시정지 |
| `unpause()` | Owner | 재개 |

**Admin — Config:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `allowAsset(addr)` | Owner | 자산 허용 |
| `disallowAsset(addr)` | Owner | 자산 차단 |
| `setMaxSettlementAmount(amount)` | Owner | 건당 상한 설정 |

**Admin — Manual Override:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `adminResetOrder(orderId)` | Owner | 정산 상태 리셋 (재정산 가능) |
| `adminVoidOrder(orderId, reason)` | Owner | 주문 영구 차단 |

### HaggleDisputeRegistry

**Core:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `anchorDispute(orderId, caseId, evidence, resolution)` | Resolver | 분쟁 결과 온체인 기록 |
| `supersedeAnchor(oldId, evidence, resolution)` | Resolver | 기존 앵커 교체 (원본 보존) |

**Admin:**
| 함수 | 접근 | 설명 |
|------|------|------|
| `grantResolver(addr)` | Owner | Resolver 역할 부여 |
| `revokeResolver(addr)` | Owner | Resolver 역할 회수 |
| `revokeAnchor(anchorId, reason)` | Owner | 앵커 무효화 |

**Views:**
| 함수 | 설명 |
|------|------|
| `getOrderAnchors(orderId)` | 주문별 앵커 ID 배열 |
| `getOrderAnchorCount(orderId)` | 주문별 앵커 수 |
| `anchors(anchorId)` | 앵커 상세 (supersededBy, revoked 포함) |
| `resolvers(addr)` | Resolver 여부 |
| `disputeAnchored(orderId, caseId)` | 분쟁 기록 여부 |

---

## 테스트 커버리지 상세

### HaggleSettlementRouter (95 tests)
- Deployment: 6 tests
- Core Settlement: 8 tests + 2 fuzz
- Amount Validation: 4 tests
- Address Validation: 7 tests
- Signature Verification: 5 tests
- Pause/Unpause: 9 tests
- Signer Rotation: 11 tests
- Guardian: 5 tests
- Ownership Transfer: 3 tests
- Emergency Freeze: 4 tests
- Manual Override: 7 tests
- Edge Cases: 6 tests
- Invariant: 1 test (256 runs × 16,384 calls)

### HaggleDisputeRegistry (52 tests)
- Deployment: 5 tests
- Core Anchoring: 7 tests + 1 fuzz
- Duplicate Prevention: 2 tests
- Validation: 4 tests
- Max Anchors: 1 test
- Access Control: 8 tests
- Ownership Transfer: 6 tests
- Supersede Anchor: 6 tests
- Revoke Anchor: 6 tests

---

## 배포 체크리스트

- [ ] Multisig 월렛 생성 (Gnosis Safe)
- [ ] 초기 Signer EOA 키 생성 + HSM 보관
- [ ] Guardian 핫 월렛 설정
- [ ] USDC 허용 자산 등록
- [ ] maxSettlementAmount 초기값 설정
- [ ] Base Sepolia 테스트넷 배포 + E2E 테스트
- [ ] Base Mainnet 배포
- [ ] 컨트랙트 주소 Etherscan Verify
- [ ] 컨트랙트 주소 `src/index.ts` 업데이트

---

## 추후 개발 공간

### Phase 2: 중량 조정 버퍼 정산
> 입력 중량의 "한 단계 위 중량"과 "입력 중량" 사이의 금액을 deposit으로 수취.
> 14일 버퍼 후 실제 중량 측정 결과 비교하여 차감/환불/추가 청구.

- [ ] WeightDepositRouter 컨트랙트 설계
- [ ] 14일 타임락 정산 메커니즘
- [ ] 미납 시 온체인 제재 (리스팅 금지 플래그)

#### 가입 시 Haggle Credits 지급 → 첫 디포짓 대체 정책

판매자의 첫 거래 진입 장벽을 낮추기 위해, **가입 시 Haggle Credits 바우처를 지급**하고 이를 첫 디포짓(분쟁 보증금 + 무게 버퍼)으로 사용할 수 있게 한다.
이전의 "첫 거래 무료($0 면제)" 정책을 대체하며, 우리 입장의 경제적 부담은 동일하나 **Credits 경제 순환**을 강화한다.
고가 제품은 제외.

| 디포짓 | 첫 거래 | 2회차부터 | 추가 요금 발생 시 |
|--------|---------|-----------|-------------------|
| 분쟁 보증금 | 가입 Credits로 대체 | 정상 청구 (USDC or Credits) | 판매자에게 사후 청구 |
| 무게 버퍼 | 가입 Credits로 대체 | 정상 청구 (USDC or Credits) | 차액 판매자에게 사후 청구 |

**Credits 바우처 특성:**
- Non-transferable (지갑 간 이동 불가)
- 디포짓/스킬/캐릭터/콘텐츠 용도만
- 만료 없음 (단, 휴면 계정 180일 후 회수 가능)
- 디포짓 정상 반환 시 Credits로 환불 (USDC 전환 불가)

**미납 시 페널티 체계:**
1. 추가 요금 발생 → 사후 청구 알림
2. 7일 이내 미납 → 신규 리스팅 제한
3. 14일 이내 미납 → 신뢰도 점수 차감
4. 30일 초과 미납 → 계정 정지 + 수금

- [ ] 첫 거래 면제 로직 (컨트랙트 or 오프체인 정책)
- [ ] 사후 청구 메커니즘
- [ ] 미납 페널티 온체인 플래그 (리스팅 금지)

### Phase 3: 추가 기능
- [ ] 배치 정산 (1 tx로 여러 건 정산)
- [ ] 다중 자산 지원 확장
- [ ] Governance 토큰 연동
- [ ] 크로스체인 정산 (Bridge 연동)

### 보안 추가 개선
- [ ] 외부 감사 (Trail of Bits / OpenZeppelin Audit)
- [ ] Bug Bounty 프로그램 (Immunefi)
- [ ] 모니터링 대시보드 (Forta / Tenderly)
- [ ] 사이너 키 HSM 마이그레이션

---

*이 보고서는 4라운드 보안 리뷰를 기반으로 작성되었습니다.*
*148개 테스트 전부 통과 (2026-03-31 기준)*
