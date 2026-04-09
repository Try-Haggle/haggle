# ARCHITECT-BRIEF — Step 64: Structured Tag Proposal (missing_tags → proposed_tags)

작성: 2026-04-09 — Arch
브랜치: `feature/mvp-integration`

---

## 배경

현재 `placeTagsWithLlm`의 `missing_tags` 필드는 자연어 문자열 배열(maxItems=2)이다.
`queueMissingTags`가 normalize + insert하지만 **category 없이** PENDING으로 들어가고,
admin이 수동으로 카테고리를 지정해야 한다.

유저 피드백: "새 태그는 작성자의 리스팅을 보고 판단해서 알아서 달아줘야지"
→ LLM이 리스팅을 보고 **구조화된 태그 제안**을 반환하도록 업그레이드한다.

---

## 스코프

**변경:**
1. `tag-placement-llm.service.ts` — JSON 스키마의 `missing_tags` → `proposed_tags` (구조화)
2. `tag-placement.service.ts` — `queueMissingTags` → `queueProposedTags` (category 포함 insert)
3. `prompts/tag-placement/system-prompt.ts` — 프롬프트에 proposed 가이드 추가
4. `prompts/tag-placement/few-shot-pool.ts` — few-shot 예제에 `proposed_tags` 추가

**신규:**
5. `__tests__/tag-proposal.test.ts` — proposed 경로 전용 테스트

**불변:**
- `tag-suggestion.service.ts` — 변경 없음 (이미 dedup/approve 로직 완비)
- `tag-candidate.service.ts` — 변경 없음
- DB 스키마 — `tag_suggestions` 테이블 변경 없음 (`label`, `normalized_label`, `suggested_by`, `first_seen_listing_id`, `occurrence_count`, `status` 그대로)

---

## 1. JSON Schema 변경 (`tag-placement-llm.service.ts`)

### Before (현재)
```json
{
  "missing_tags": {
    "type": "array",
    "items": { "type": "string" },
    "maxItems": 2
  }
}
```

### After
```json
{
  "proposed_tags": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string",
          "description": "lowercase-hyphenated tag label, e.g. 'esim-only'"
        },
        "category": {
          "type": "string",
          "enum": ["condition", "style", "size", "material", "feature", "compatibility", "other"]
        },
        "reason": {
          "type": "string",
          "description": "1-sentence justification why this tag is needed"
        }
      },
      "required": ["label", "category", "reason"],
      "additionalProperties": false
    },
    "maxItems": 3
  }
}
```

**변경점:**
- 필드명: `missing_tags` → `proposed_tags`
- items: `string` → `object { label, category, reason }`
- maxItems: `2` → `3`
- category enum: tag_promotion_rules의 기존 5개 + `feature` + `compatibility` (전자기기 wedge용)

### 타입 변경

```ts
// Before
export interface LlmPlacementSuccess {
  // ...
  missingTags: string[];
}

// After
export interface ProposedTag {
  label: string;
  category: string;
  reason: string;
}

export interface LlmPlacementSuccess {
  // ...
  missingTags: string[];       // ← 제거
  proposedTags: ProposedTag[]; // ← 추가
}
```

### `resolveLlmOutput` 변경

```ts
// Before
missingTags: string[]

// After
proposedTags: ProposedTag[]
```

방어 로직:
- `proposed_tags`가 배열 아니면 → `[]`
- 각 항목에서 `label`이 string이 아니면 → drop
- `label`을 `trim().toLowerCase().replace(/\s+/g, '-')` 로 normalize
- `category`가 enum에 없으면 → `"other"`로 fallback
- `reason`이 string이 아니면 → `""`

---

## 2. `queueProposedTags` (`tag-placement.service.ts`)

기존 `queueMissingTags(db, labels, listingId)` → `queueProposedTags(db, proposedTags, listingId)`

```ts
export async function queueProposedTags(
  db: Database,
  proposed: ProposedTag[],
  firstSeenListingId: string | null,
): Promise<number>
```

**SQL 변경:**
```sql
INSERT INTO tag_suggestions
  (label, normalized_label, suggested_by, first_seen_listing_id, occurrence_count, status, metadata)
VALUES
  (${label}, ${normalized}, 'LLM', ${listingId}, 1, 'PENDING',
   ${JSON.stringify({ category: proposed.category, reason: proposed.reason })})
ON CONFLICT (normalized_label) DO UPDATE
  SET occurrence_count = tag_suggestions.occurrence_count + 1,
      updated_at = NOW()
```

**주의:** `tag_suggestions` 테이블에 `metadata` jsonb 컬럼이 없을 수 있음.
→ 확인 필요. 없으면 `category`와 `reason`은 **로그에만 남기고** DB에는 기존 컬럼만 사용.

**대안 (metadata 컬럼 없는 경우):**
- `label`에 category prefix 붙이지 않음 (태그 네이밍 오염)
- `suggested_by`를 `'LLM:condition'` 형태로 하지 않음 (기존 쿼리 깨짐)
- → `category`와 `reason`은 **telemetry log**에만 기록하고, tag_suggestions에는 기존 방식 유지
- admin이 approve할 때 Step 56 `approveSuggestion`에서 `category` param을 직접 지정하면 됨 (이미 있음)

---

## 3. 시스템 프롬프트 변경 (`system-prompt.ts`)

기존 Rule 3 교체:

**Before:**
```
3. If a critical attribute is missing from candidates, return it in `missing_tags` as a natural-language suggestion (max 2).
```

**After:**
```
3. If a critical attribute of the listing is NOT represented by any candidate tag, propose it in `proposed_tags` (max 3).
   Each proposed tag must have:
   - label: lowercase-hyphenated (e.g. "esim-only", "battery-90-plus")
   - category: one of condition|style|size|material|feature|compatibility|other
   - reason: 1-sentence justification
   Only propose if: (a) clearly implied by the listing, (b) no candidate captures it, (c) reusable across other listings.
   Prefer 0 proposals if unsure. Never duplicate a candidate.
```

---

## 4. Few-Shot 예제 변경 (`few-shot-pool.ts`)

모든 8개 예제의 assistant 응답에 `proposed_tags` 필드 추가:

| # | 기존 missing_tags | 변경 proposed_tags |
|---|---|---|
| 1 (iPhone 17 Pro) | `[]` | `[]` (candidates가 이미 커버) |
| 2 (Galaxy S24 Ultra) | `["s-pen-support"]` | `[{ label: "s-pen-support", category: "feature", reason: "S24 Ultra includes S Pen, not captured by any candidate" }]` |
| 3 (Vintage jacket) | `[]` | `[]` |
| 4 (Air Jordan 1) | `[]` | `[]` |
| 5 (Switch OLED) | `["oled-display"]` | `[{ label: "oled-display", category: "feature", reason: "OLED variant is a key differentiator not in candidates" }]` |
| 6 (PS5 Slim) | `[]` | `[]` |
| 7 (Dyson V15) | `[]` | `[]` |
| 8 (earbuds) | `["wireless"]` | `[{ label: "wireless", category: "feature", reason: "wireless connectivity is a key attribute not in candidates" }]` |

---

## 5. 테스트 (`__tests__/tag-proposal.test.ts`)

| # | 테스트 | 검증 |
|---|---|---|
| 1 | `resolveLlmOutput` proposed_tags 정상 파싱 | 3개 구조체 반환 |
| 2 | `resolveLlmOutput` proposed_tags 빈 배열 → `[]` | 빈 배열 |
| 3 | `resolveLlmOutput` 잘못된 항목 → drop | label 없는 항목 필터 |
| 4 | `resolveLlmOutput` 알 수 없는 category → `"other"` | fallback |
| 5 | `resolveLlmOutput` label normalize | 공백→하이픈, 대문자→소문자 |
| 6 | `queueProposedTags` insert 호출 검증 | db.execute 호출 횟수 |
| 7 | `queueProposedTags` 빈 배열 → 0 반환 | early return |
| 8 | `queueProposedTags` 중복 normalized_label → dedup | 1회만 insert |
| 9 | JSON schema 구조 검증 | proposed_tags 스키마 일치 |
| 10 | few-shot 예제 proposed_tags JSON parseability | 모든 예제 파싱 |
| 11 | orchestrator 통합: proposed → queueProposedTags 호출 체인 | trace.suggestionsQueued |
| 12 | telemetry에 proposed_count 기록 | console.info 검증 |

---

## 6. 후방 호환

### Cache invalidation
- JSON 스키마 변경 → `modelVersion` 변경 아님 (같은 gpt-4o-mini)
- BUT `response_format` 변경으로 같은 캐시키에 다른 응답 → **문제 없음**
  - 캐시는 `selected_tag_ids`만 저장, `missing_tags`는 캐시 value에 있지만 `proposed_tags`로 변경해도 캐시 HIT 시 LLM을 안 부르므로 proposed 로직 자체를 안 탐
  - 캐시 MISS → 새 스키마로 호출 → 새 proposed_tags → `queueProposedTags` 호출
- 기존 캐시의 `missing_tags` jsonb 컬럼 → 타입 변경 불필요 (캐시 row 교체 시 자연 갱신)

### `tag_placement_cache` 테이블
- `missing_tags` 컬럼이 text[] 또는 jsonb → 확인 필요
- proposed_tags는 object 배열이므로 jsonb여야 함
- **만약 text[]면:** 캐시 write 시 `proposed_tags`를 `label` string 배열로 축소하여 저장 (backward compat)
  또는 캐시에는 기존 missing_tags 방식 유지 (label만 저장)

### 기존 `LlmPlacementSuccess` 소비자
- `missingTags` 필드를 읽는 곳: `tag-placement.service.ts` L316 (`missingTags = llmResult.missingTags`)
- → `proposedTags`로 변경하고 `queueProposedTags` 호출로 교체
- 다른 소비자 없음 (Grep으로 확인 필요)

---

## 7. Bob 지시

### 순서
1. `tag_suggestions` 스키마 확인 → metadata jsonb 유무
2. `tag_placement_cache` 스키마 확인 → `missing_tags` 컬럼 타입
3. `LlmPlacementSuccess.missingTags` 소비자 전수 조사 (Grep)
4. 시스템 프롬프트 수정
5. few-shot 예제 수정
6. `tag-placement-llm.service.ts` 스키마 + 타입 + `resolveLlmOutput` 수정
7. `tag-placement.service.ts` `queueMissingTags` → `queueProposedTags` 수정
8. 테스트 작성 + 전체 테스트 실행
9. typecheck

### 제약
- DB 스키마 변경 금지 (drizzle-kit broken)
- `tag-suggestion.service.ts` 변경 금지
- `tag-candidate.service.ts` 변경 금지
- 기존 379 테스트 회귀 금지
- `response_format.json_schema.strict: true` 유지 필수

### 리스크
1. **OpenAI strict schema vs nested objects**: gpt-4o-mini가 nested object array를 strict mode에서 잘 생성하는지. 2024-07 이후 지원 확인됨 — OK.
2. **Few-shot 변경 → 기존 tag-placement-few-shot.test.ts 깨질 수 있음**: `toChatMessages` 출력 변경 시 JSON stringify 비교 테스트 조정 필요.
3. **Cache missing_tags 컬럼**: text[] → jsonb 변환 필요 시 raw SQL ALTER or 캐시 write를 label-only로 축소.

---

*다음: Bob 구현 → Richard 리뷰*
