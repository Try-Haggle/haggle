# HNP 공개 압축 상태

**상태:** 2026-08-24 설계·프로토콜 모듈 추가.
**코드:** `packages/engine-session/src/protocol/compact-state.ts`

---

## 프로토콜이 반드시 해야 하는 것

프로토콜은 엔진이 아닙니다. **누가  impl을 만들든 같은 규칙으로 이어갈 수 있는 공개 계약**입니다.

1. **중립** — 우리 목표가·바닥·말투·모델 전략을 실으면 안 된다. 그건 엔진 쪽이다.
2. **규칙** — 같은 공개 행위 열이면 상태가 항상 같다. 추측이나 모델마다 다른 요약이면 프로토콜이 아니다.
3. **충분** — 상대가 이 상태만 보고 다음 오퍼를 이어갈 수 있어야 한다.
4. **검증 가능** — 순서, 가격, 이슈 값이 재계산·대조될 수 있어야 한다.

그래서 압축도 프로토콜이 한다. 다만 압축하는 것은 **공개된 협상**이지, 비공개 기억이 아니다.

---

## 왜 이 압축인가

전문을 줄이거나 LLM으로 다시 요약하는 방식은 구현마다 달라지고, 같은 세션이 다른 상태가 된다.

맞는 쪽은 대화 상태 추적(DST)과 다이슈 협상 **합의 추적**(Yamaguchi et al., 2023)이다.

- 이슈마다 칸이 하나다. 새 값이 오면 **덮어쓴다.** 상태 크기는 이슈 수다.
- 한 수는 행위다. OFFER / COUNTER / ACCEPT. 문단이 아니다.
- 양쪽이 같은 칸에 같은 값을 말하면 ALIGNED, 아니면 OPEN.

LLMLingua처럼 토큰만 지우는 압축은 쓰지 않는다. 다른 에이전트가 같은 바이트를 복원하지 못한다.

---

## 와이어와 엔진

```
공개 행위 열 (HNP)
  → reduceHnpPublicCompactState   ← 규칙, 결정론
  → encodeHnpCompactStateForLlm   ← 범례 포함, 모델이 읽음

비공개 (엔진 MEMO)
  → 바닥, 목표가, 박스, 상대 패턴
```

모델은 `HNP:` 블록에서 공개 흐름을 보고, `MEMO:`에서 자기 편 숫자만 본다.

`/.well-known/hnp`는 `hnp.core.compact_state`를 optional capability로 알린다. 공개 스펙은 [`docs/protocol/HNP.md`](../protocol/HNP.md).

---

## LLM이 읽는 모양

```
HNP:
  HNP compact v1 — public negotiation state only. Same act sequence → same state.
  PRICE: buyer=$420.00 seller=$480.00 last=BUYER
  ISSUES:
    hnp.issue.condition.battery_health OPEN buyer=90%+ seller=87%
  ACTS:
    1 BUYER OFFER $370.00 | 256GB so I start lower
    2 SELLER COUNTER $480.00 | battery is 87%
```
