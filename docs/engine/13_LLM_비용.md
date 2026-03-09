# 13. LLM 모델 선택과 비용 분석

**문서:** Haggle Engine Architecture v1.0.2 — LLM 비용
**범위:** Grok 4.1 Fast 선정 이유, 모델 비교, 사용 패턴, 협상 1건당 비용, 월간 P&L, 스케일 분석
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [08_LLM_정책.md](./08_LLM_정책.md) | [14_데이터_성능.md](./14_데이터_성능.md)

---

## 1. LLM 모델 선택

### 1.1 선정 모델: Grok 4.1 Fast

| 항목 | 사양 |
|------|------|
| 모델 | Grok 4.1 Fast (xAI) |
| API 모델 ID | `grok-4.1-fast` |
| Input | $0.20 / 1M tokens |
| Output | $0.50 / 1M tokens |
| 컨텍스트 | 2M tokens |
| 추론 모드 | reasoning=ON/OFF 전환 가능 (API `reasoning_enabled` 파라미터) |
| 벤치마크 | LMArena Thinking #1 (1483 Elo), Non-thinking #2 (1465 Elo) |
| Tool calling | τ²-bench Telecom #1 |
| 출시 | 2025년 11월 |

### 1.2 선정 이유

1. **추론 on/off 전환** — 하나의 모델로 두 가지 사용 패턴. Strategy Compilation처럼 깊은 분석이 필요한 작업은 reasoning=ON, 단순 재조정은 reasoning=OFF로 전환하여 비용과 지연을 모두 최적화한다.
2. **가격 대비 성능 최고** — 경쟁 대비 3-60배 저렴하면서 성능은 동등 이상. LMArena 기준 Thinking #1, Non-thinking #2로 가격 대비 최상위 성능을 제공한다.
3. **2M 컨텍스트** — 장기 협상 히스토리 전체를 한 번에 처리할 수 있다. 경쟁 모델 대비 5-16배 넓은 컨텍스트 윈도우.
4. **Tool calling 1위** — τ²-bench Telecom에서 1위를 기록하여 에이전트 아키텍처에 최적화되어 있다.
5. **Unified architecture** — 추론/비추론이 같은 모델 가중치를 사용하므로, 모드 전환 시 모델 로딩 지연이 없고 API 파라미터 하나로 즉시 전환 가능하다.

### 1.3 모델 비교 (2026년 2월 기준)

| 모델 | Input/1M | Output/1M | 전략 1회 비용 | LMArena | 비고 |
|------|----------|-----------|---------------|---------|------|
| **Grok 4.1 Fast** | $0.20 | $0.50 | $0.00055 | #1-2 | **선정** |
| GPT-5 Nano | $0.05 | $0.40 | $0.00028 | 중상 | 컨텍스트 400K 제한 |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.00170 | 하위 | output 비용 5배 |
| Gemini 2.5 Flash Lite | $0.10 | $0.40 | $0.00035 | 중 | 추론 모드 없음 |
| DeepSeek R1 | $0.55 | $2.19 | $0.00192 | 상 | 128K, 중국 서비스 리스크 |
| GPT-5 | $1.25 | $10.00 | $0.00688 | 최상 | 12배 비쌈, 불필요 |

### 1.4 사용 패턴

```
Strategy Compilation (reasoning=ON):
  입력 ~1,500 tokens × $0.20/1M = $0.0003
  출력 ~500 tokens × $0.50/1M = $0.00025
  합계: ~$0.00055 / 회

Escalation 분석 (reasoning=ON):
  입력 ~800 tokens, 출력 ~300 tokens
  합계: ~$0.00031 / 회

단순 재조정 (reasoning=OFF):
  입력 ~500 tokens, 출력 ~200 tokens
  합계: ~$0.00020 / 회
```

### 1.5 LLM 라우팅 로직

```python
def select_llm_mode(task_type: str, complexity: str) -> dict:
    if task_type == "STRATEGY_COMPILATION":
        return {"model": "grok-4.1-fast", "reasoning": True}
    elif task_type == "ESCALATION_ANALYSIS":
        return {"model": "grok-4.1-fast", "reasoning": True}
    elif task_type == "SIMPLE_RESTRATEGIZE":
        return {"model": "grok-4.1-fast", "reasoning": False}
    elif task_type == "USER_STRATEGY_CHANGE":
        return {"model": "grok-4.1-fast", "reasoning": False}
    else:
        return {"model": "grok-4.1-fast", "reasoning": False}
```

---

## 2. 비용 분석

### 2.1 협상 1건당 비용

**시나리오:** iPad 구매, 200개 리스팅, Top 5 세션, 10 라운드, 에스컬레이션 1회

| 단계 | 연산 | LLM 호출 | 비용 |
|------|------|----------|------|
| 전략 생성 (LLM reasoning=ON) | LLM Strategy Compilation | 1-2회 | $0.00055-0.0011 |
| 전략 생성 (프리셋, v1.0.1) | Stats → 파라미터 변환 | 0회 | 0 (CPU만) |
| 200개 일괄 평가 | Engine Core × 200 | 0 | 40ms CPU |
| Top 5 세션 × 10라운드 | Engine Core × 50 | 0 | 10ms CPU |
| 재평가 3회 (3일간) | Engine Core × 600 | 0 | 120ms CPU |
| 에스컬레이션 1회 | LLM reasoning=ON | 1회 | $0.00031 |
| **합계 (LLM 전략)** | | **2-3회** | **~$0.001-0.002** |
| **합계 (프리셋 전략, v1.0.1)** | | **0-1회** | **~$0.000-0.001** |

### 2.2 월간 비용/수익 분석

**가정:** 평균 거래액 $340, 성공률 20%, 수수료 1.5%, 평균 LLM 호출 1.5회/제품

| 유저 | 제품 | 성공 거래 | GMV | 수수료 수익 | LLM 비용 | 인프라 | 순이익 | 마진 |
|------|------|-----------|-----|-------------|----------|--------|--------|------|
| 1K | 2K | 400 | $136K | $2,040 | $2.2 | $8 | $2,030 | 99.5% |
| 10K | 20K | 4,000 | $1.36M | $20,400 | $22 | $80 | $20,298 | 99.5% |
| 50K | 100K | 20,000 | $6.8M | $102,000 | $110 | $400 | $101,490 | 99.5% |
| 100K | 200K | 40,000 | $13.6M | $204,000 | $220 | $800 | $202,980 | 99.5% |

### 2.3 LLM 비용이 스케일에 무관한 이유

```
LLM 비용 = O(제품 수) × $0.001 = 무시 가능
Hot Path 비용 = O(라운드 수) × 200μs = CPU만 소비
제품당 1-3회 LLM, 나머지 전부 Engine Core.
세션 수가 아무리 늘어도 LLM 비용은 제품 수에만 비례.
100K 유저에서도 LLM 비용은 수익의 0.11%.
v1.0.1: 프리셋 사용 시 LLM 비용 추가 절감. 프리셋 채택률 60% 가정 시 ~40% 감소.
```

### 2.4 이전 설계 대비

| | 이전 (세션당 LLM) | v1.0.0 (Engine-First) | v1.0.1 (Stats+Engine) |
|---|---|---|---|
| LLM 호출 | 200+ | 1~3 | 0~3 |
| LLM 비용 | ~$0.20 | ~$0.001-0.002 | ~$0.000-0.002 |
| 처리 시간 | 수십 초 | < 200ms | < 200ms |
| 확장성 | 세션 수에 비례 | 거의 일정 | 거의 일정 |

---

*이전 문서: [12_장기협상_HNP.md](./12_장기협상_HNP.md) | 다음 문서: [14_데이터_성능.md](./14_데이터_성능.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
