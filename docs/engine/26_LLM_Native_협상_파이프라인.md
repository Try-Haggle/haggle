# 26. LLM-Native 협상 파이프라인

*2026-04-11. Arch + JH 논의 확정.*

> **One-liner**: LLM이 Brain, Skill이 Knowledge, Referee가 Safety.
> 기존 "BARGAINING COUNTER만 LLM" 설계를 폐기하고, 전 Phase에서 LLM이 판단하는 구조로 전환.

---

## 1. 설계 원칙

| 원칙 | 설명 |
|------|------|
| **역할 분리** | Brain(LLM) = 판단 · Knowledge(Skill) = 지식 제공 · Safety(Referee) = 안전 차단 |
| **투명성** | Shared Layer는 양쪽이 동일하게 보고, hash로 검증 |
| **중립성** | 팩트(Shared)와 해석(Private) 분리. DS 패널은 Shared 기반 판단 |
| **확장성** | LLM 교체, Skill 추가, Referee 강화 — 각각 독립 확장 |
| **비용 효율** | Codec 압축으로 전 Phase LLM 비용 ≤ 기존 BARGAINING-only 비용 |

---

## 2. 6-Stage 파이프라인

```
메시지(자연어+구조) → ① UNDERSTAND → ② CONTEXT → ③ DECIDE → ④ VALIDATE → ⑤ RESPOND → ⑥ PERSIST+TRANSITION
                         (LLM)         (코드)       (LLM)      (코드)        (LLM)       (코드)
```

### Stage 1: UNDERSTAND (LLM)

상대방 메시지를 구조화된 의도로 파싱.

```
입력: "충전기 포함하면 $700에 할게. 배터리는 92%야"
출력: {
  price_offer: 70000,
  conditions_proposed: [{ term: "accessories", value: "charger_included" }],
  conditions_claimed: [{ term: "battery_health", value: 92, verified: false }],
  sentiment: "cooperative",
  tactic_detected: "bundling",
  message_type: "conditional_offer"
}
```

Agent-to-Agent: 이미 구조화된 입력이 오면 Stage 1 스킵.

### Stage 2: CONTEXT (순수 코드)

Living Memo + Skill 지식 + Coach 추천을 조립.

```
Living Memo (Shared + Private)  ← DB에서 로드
+ Skill.getDomainContext()       ← 카테고리 지식
+ Skill.getTerms()               ← 협상 가능 조건
+ Skill.getConstraints()         ← 하드 규칙
+ Skill.getMarketReference()     ← 시장가
+ Coach.computeCoaching()        ← Faratin 곡선 추천
= Full NegotiationContext
```

### Stage 3: DECIDE (LLM)

모든 Phase, 모든 Action에서 LLM이 판단. OPENING anchoring, ACCEPT/REJECT, phase 전이 판단 포함.

```
출력: {
  action: "COUNTER",
  price: 71500,
  conditions_response: [...],
  reasoning: "...",
  tactic: "reciprocal_concession",
  phase_assessment: "BARGAINING",
  near_deal: false
}
```

### Stage 4: VALIDATE (순수 코드 — Referee)

Math Guard + Protocol Guard + Validator 7규칙. **변경 없음.**

- HARD violation: auto-fix (최대 2회) 또는 REJECT
- SOFT violation: advisory (LLM에게 피드백)
- Math Guard: floor 위반 → 코드가 강제 차단

### Stage 5: RESPOND (LLM)

BuddyTone 기반 자연어 메시지 생성. TemplateMessageRenderer 대체.

### Stage 6: PERSIST + TRANSITION (코드)

DB 저장 + Living Memo 갱신 + Phase 전이.

Phase 전이: LLM 판단은 advisory, 코드(gap 비율 등)가 최종 결정.
- 코드 + LLM 모두 전이 → 전이
- 코드만 전이 → 전이
- LLM만 전이 → 보류

---

## 3. Living Negotiation Memo

### 3.1 2-Layer 아키텍처

```
Shared Layer (공유 · 중립 · 양쪽 동일)
  → 분쟁 시 DS 패널에 제출
  → Agent-to-Agent: hash 교환으로 일치 확인

Private Layer (비공개 · 전략 · 나만 봄)
  → 상대방에게 노출 금지
  → 분쟁 시 자발적 제출 가능 (유리한 증거)
```

### 3.2 Compressed Codec

LLM 시스템 프롬프트에 코덱 범례를 한 번 주입 (~200 토큰). 이후 매 라운드 메모는 최대 압축.

#### 코덱 범례 (LLM system prompt에 포함)

```
=== HNP Memo Codec v1.0 ===

Shared Prefixes:
  NS: NegotiationState — sid|phase|R(round/max)|elapsed_min|h:shared_hash
  PT: PriceTrajectory — B=buyer,S=seller csv prices|g=gap(↓narrow↑widen→flat)|Bm=buyer_moved|Sm=seller_moved
  CL: ConditionsLedger — term/val/who(B|S)/Rn/status(✓Rn=accepted,✗Rn=rejected,?=pending)
  CS: ConditionsSummary — Np=proposed,Na=accepted,Nr=rejected,N?=pending
  VL: VerificationLog — term/Rn/result/detail/attest_id/$cost  (?=pending, awaiting_X)
  VB: VerificationBlocking — terms blocking CLOSING
  PH: PhaseHistory — FROM→TO@Rn/evt | cur:phase | rev:N
  RM: RecentMessages(N) — Rn/role:"text"

Private Prefixes:
  SS: StrategyState — role|tN=target|fN=floor|cN=current|flex=N|used=N%|rem=N|tp=N|mode|style
  OM: OpponentModel — pattern/conf|agg=N|cr=N|avg=N|ef=N/conf
  ON: OpponentNotes — observations (✓=positive, ✗=negative)
  OP: OpponentPrediction — predicted_action@price_range,condition_guess
  TA: TacticalAssess — lev=H|M|L|+positives|-negatives
  TR: TacticalRec — action@price|"reasoning"
  TX: AlternativeActions — action@condition|action@condition
  TC: CoachRec — price/tactic/warn:list
  RR: RiskRegister — term/claimed/sev(H|M|L)/impact/mitigation
  DB: DealBreakers — term/status/gate:phase
  RT: TrustScore — N|factor±adj,factor±adj

Phases: DISC OPEN BARG CLOS SETT
Events: IOM=InitialOfferMade COM=CounterOfferMade NDD=NearDealDetected BC=BothConfirmed RR=RevertRequested
Prices: minor units (cents). $700 = 70000
```

#### 실제 압축 예시 (Round 7, iPhone 15 Pro)

```
--- SHARED ---
NS:sess_abc|BARG|R7/15|47m|h:8f2a
PT:B585,660,680,700|S760,740,725,720|g2000↓|Bm11500|Sm4000
CL:charger_incl/S/R3/✓R4|ship_method/USPS_pri/B/R5/?|ship_cost/seller_pays/B/R5/✗R6
CS:3p/1a/1r/1?
VL:imei/R4/CLEAN/T-Mo,unlocked,!bl/v_8f2k/$0|bat_hp/R6/?/await_diag
VB:bat_hp
PH:OPEN→BARG@R2/COM|cur:BARG|rev:0
RM3:
R5/B:"배송비 판매자 부담이면 $680 가능한데요"
R6/S:"배송비는 각자 부담이 맞는 것 같아요. $720은 어떠세요?"
R7/B:"USPS Priority로 보내주시면 $700에 할게요"
--- PRIVATE ---
SS:buyer|t65000|f78000|c70000|flex0.615|used61%|rem8|tp0.47|FAUTO|balanced
OM:LINEAR/0.78|agg0.45|cr0.033|avg1333|ef68000/0.6
ON:cond_flex(charger✓),ship_rigid(✗),verify_coop(imei✓)
OP:COUNTER@70500-71500,ship_resplit?
TA:lev=M|+imei_done,gap_2.7%|-ship_open,bat_unverified
TR:COUNTER@70500|"gap$2K,+$500→opp-$500,bat=leverage"
TX:ACCEPT@bat✓+ship_ok|HOLD@bat_pending
TC:70800/recip_conc/warn:none
RR:bat_hp/92/M/"$30-50Δ,<80%=REJECT"/R6_verifying
DB:find_my/unchecked/gate:preCLOS
RT:0.72|imei+.2,bat-.1,coop+.12
```

#### 토큰 추정

| 구간 | JSON (비압축) | Codec (압축) | 절감률 |
|------|-------------|-------------|--------|
| Shared (메시지 제외) | ~450 토큰 | ~120 토큰 | 73% |
| Recent Messages (3개) | ~150 토큰 | ~120 토큰 | 20% |
| Private | ~400 토큰 | ~150 토큰 | 63% |
| **합계** | **~1000 토큰** | **~390 토큰** | **61%** |

---

## 4. 비용 분석 (압축 적용)

### 라운드당 LLM 호출

| Stage | Input 토큰 | Output 토큰 | 설명 |
|-------|-----------|------------|------|
| UNDERSTAND | ~200 | ~120 | 메시지 + skill terms → 파싱 결과 |
| DECIDE | ~750 | ~200 | memo(390) + skill(200) + coach(80) + rules(80) → 결정 |
| RESPOND | ~250 | ~80 | 결정 + tone + recent → 메시지 |
| MEMO UPDATE | ~500 | ~150 | 기존 memo + 라운드 결과 → delta 갱신 |
| **합계** | **~1700** | **~550** | |

### 비용 계산 (Grok 4 Fast)

```
Grok 4 Fast 가격: Input $0.05/1K, Output $0.15/1K

라운드당:
  Input:  1700 × $0.00005 = $0.000085
  Output: 550 × $0.00015 = $0.0000825
  합계: $0.000168/라운드

15라운드 세션 (13라운드 LLM 사용):
  13 × $0.000168 = $0.0022/세션

비교:
  기존 (BARGAINING COUNTER만): ~$0.002/세션
  신규 (전 Phase LLM):          ~$0.0022/세션
  차이: +$0.0002/세션 (10% 증가)
```

**Codec 압축 덕분에 전 Phase LLM을 써도 비용이 거의 같다.**

### 월간 비용

```
월 10,000 세션:  $22/월
월 100,000 세션: $220/월
HC $4.99 구독 기준 마진: 99.6%
```

---

## 5. Skill 재설계

### 인터페이스 변경

```typescript
// 제거: evaluateOffer(), generateMove() — LLM이 대체
// 유지: 지식 제공 함수들
// 추가: 검증 서비스

interface NegotiationSkill {
  // Identity
  readonly id: string;           // 'electronics-iphone-pro-v1'
  readonly category: string;     // 'electronics'
  readonly version: string;

  // 지식 제공 (→ LLM context)
  getDomainContext(): string;
  getTerms(): CategoryTerm[];
  getConstraints(): SkillConstraint[];
  getMarketReference(): MarketRef;
  getTactics(): string[];

  // 검증 서비스
  getVerifiableTerms(): VerifiableTerm[];
  verify(term: string, input: unknown): Promise<VerificationResult>;

  // 카테고리별 검증 규칙 (→ Referee에 주입)
  getValidationRules(): CategoryValidationRule[];
}
```

### 검증 + Haggle 인증 플로우

```
상대방이 검증 요청 → 유저에게 알림 → 수락/거절(자동수락 옵션)
→ 수락 시 → Skill.verify() 실행 → 결과 반환
→ Haggle이 attestation 서명:
    sign(platform_key, hash(session_id + round + term + result + timestamp))
→ Shared Layer의 VL에 기록
→ 분쟁 시 증거로 사용 가능
→ 유저가 위조 불가 (Skill이 실행, Haggle이 서명)
```

### 카테고리별 검증 서비스

| 카테고리 | 검증 항목 | 방법 | 비용 | 자동수락 |
|---------|----------|------|------|---------|
| Electronics | IMEI | 캐리어 API | 무료 | 가능 |
| Electronics | carrier_lock | 캐리어 API | 무료 | 가능 |
| Electronics | battery_health | 진단앱 스크린샷 | 무료 | 불가(사진필요) |
| Electronics | cosmetic_grade | AI 사진 분석 | $0.50 | 가능 |
| Electronics | stolen_check | 도난DB 조회 | $1.99 | 가능 |
| Sneakers | legit_check | AI + 전문가 LC | $3.99 | 가능 |
| Sneakers | receipt | OCR + 검증 | 무료 | 가능 |

---

## 6. Floor 정책

```
- 판매자가 직접 설정 (필수 입력)
- 구매자에게 절대 노출 안 함
- 불가능한 거래: 숨기지 않고 검색 순위만 하락

순위 계산:
  overlap = buyer.budget - seller.floor
  if overlap < 0:   score × 0.3  (대폭 하락)
  elif overlap < 10%: score × 0.7  (약간 하락)
  else:              score × 1.0  (정상)
```

---

## 7. HNP 표준화 범위

### 공개 (프로토콜 스펙)

1. NegotiationMessage 포맷 (text + structured + metadata)
2. Phase 라이프사이클 (5단계 + 전이 규칙)
3. ProtocolDecision 포맷 (action + price + conditions + reasoning)
4. NegotiationSkill 인터페이스 (지식 + 검증)
5. ValidationResult 포맷 (HARD/SOFT 구분)
6. RoundAudit 포맷 (6-stage 감사 로그)
7. Living Memo Shared Layer 포맷 + Codec
8. Attestation 포맷 (검증 서명)

### 비공개 (엔진 로직)

1. LLM 프롬프트 내용
2. Coach 알고리즘 (Faratin 파라미터, EMA 계수)
3. Opponent Pattern 분석 로직
4. Reasoning 트리거 조건
5. Private Layer 포맷
6. 판례 DB 구조

---

## 8. 기존 코드 영향

| 파일/모듈 | 변경 |
|----------|------|
| Referee (coach, validator, Math Guard) | **유지** |
| phase-machine.ts | **유지** + LLM advisory 입력 추가 |
| memory-reconstructor.ts | **유지** |
| GrokFastAdapter | **확장** — Codec 인코딩/디코딩 추가 |
| xai-client.ts | **유지** |
| DefaultEngineSkill | **변경** — evaluateOffer/generateMove 제거, verify() 추가 |
| llm-negotiation-executor.ts | **재작성** — 6-stage 파이프라인 |
| auto-screening.ts | **삭제** — UNDERSTAND가 흡수 |
| TemplateMessageRenderer | **삭제** — RESPOND가 대체 |
| 신규: understand.ts | Stage 1 메시지 파싱 |
| 신규: responder.ts | Stage 5 메시지 생성 |
| 신규: memo-codec.ts | Codec 인코딩/디코딩 |
| 신규: memo-manager.ts | Living Memo CRUD + hash 계산 |

---

## 9. 구현 순서

```
Phase A: Codec + Memo (의존성 없음)
  memo-codec.ts, memo-manager.ts, 테스트

Phase B: Skill 재설계 (의존성 없음, A와 병렬 가능)
  DefaultEngineSkill 인터페이스 변경, verify() 추가

Phase C: 파이프라인 (A + B 필요)
  understand.ts, responder.ts, executor 재작성

Phase D: 통합 테스트
  Phase별 E2E, Codec 왕복, 검증 플로우

Phase E: 기존 코드 정리
  auto-screening.ts 삭제, TemplateMessageRenderer 삭제
```

---

*이 문서는 4/11 모임에서 논의 후 확정.*
