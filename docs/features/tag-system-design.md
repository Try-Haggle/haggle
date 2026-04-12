# Recursive Self-Evolving Tag System

**날짜**: 2026-04-08
**상태**: 설계 확정 (4/7 모임 결정)
**관련 패키지**: `packages/tag-core`, `apps/api/src/services/tag-placement.service.ts` (신규)

---

## 1. 목표

AI가 리스팅 데이터를 기반으로 **최소한의 태그**로 **최대한의 정보**를 담도록 배치하고, 시간이 지나며 태그 체계 자체가 recursive하게 진화.

**예시:**
- 입력: "아이폰 17 Pro 256GB 네이비 미개봉"
- 나쁜 배치: [Apple, iPhone, iPhone 17, iPhone 17 Pro, 256GB, Navy, Sealed, Electronics, Phone, Smartphone] (10개 — redundant)
- 좋은 배치: [iPhone 17 Pro, 256GB, Navy, Sealed] (4개 — DAG ancestor가 나머지 암시)

---

## 2. 핵심 원칙

1. **LLM은 생성이 아닌 선택** — 후보는 코드가 DB에서 준비, LLM은 고르기만
2. **DAG (Directed Acyclic Graph)** — 태그는 다중 부모 허용, ancestor 자동 포함
3. **Information Gain** — IDF 기반 정보량 측정, redundant 태그 제거
4. **Recursive Self-Tuning** — 태그 체계 자체가 데이터에 따라 진화
5. **유저 경험 우선** — LLM 실수 원천 차단 (ref id 매핑, strict JSON schema)

---

## 3. 아키텍처

### 3.1 Tag Graph (DAG)

기존 flat category → 다중 부모 DAG로 확장.

```
tag_edges 테이블
─────────────────────
parent_tag_id  (FK)
child_tag_id   (FK)
created_at
UNIQUE(parent, child)

예시:
iphone-17-pro → iphone-17 → iphone → phone → electronics
iphone-17-pro → apple (두 번째 부모)
```

**탐색 규칙:**
- `ancestors(tag)` — 재귀적으로 모든 조상 수집
- `descendants(tag)` — 재귀적으로 모든 후손 수집
- Cycle 방지: insert 시 `child`의 descendants에 `parent`가 없어야 함

### 3.2 Tag Metadata

```typescript
interface TagMetadata {
  id: string;
  label: string;
  status: 'CANDIDATE' | 'EMERGING' | 'OFFICIAL' | 'DEPRECATED';
  useCount: number;
  idf: number;              // log(N / df)
  lastUsedAt: Date;
  parents: string[];        // DAG 부모
  createdBy: 'LLM' | 'USER' | 'ADMIN' | 'IMPORT';
  aliases: string[];        // 동의어
}
```

### 3.3 Tag Placement Pipeline

```
[리스팅 생성/수정]
    ↓
[L0] 캐시 조회: sha256(title|desc|category|sorted(candidate_refs)) → HIT? 끝
    ↓ MISS
[L1] 규칙 기반 선처리 (0ms)
     - 제목 exact substring 매칭 → 확정 태그
     - 카테고리 필수 태그 자동 부여
    ↓
[L2] 후보 수집 (~20ms)
     - (a) 유사 리스팅 top-20의 태그 union (pgvector 재사용)
     - (b) 카테고리 내 high-IDF top-30
     - (c) 제목 n-gram 매칭
     → 최대 40개
    ↓
[L3] IG 프리필터 (0ms)
     - L1 확정 태그의 ancestor 제거
     - IDF < 0.5 (너무 흔한) 제거
     → 20개로 컷
    ↓
[L4] Ref id 치환 (t01~t20)
     - refMap: "t01" → real tag id
    ↓
[L5] GPT-4o-mini 호출 (~300ms)
     - JSON strict schema
     - 3개 few-shot
     - system + few-shot prompt caching
    ↓
[L6] Ref → real id 복원 + 검증
     - candidates 소속 확인
     - 실패 시 fallback (규칙 기반)
    ↓
[L7] DAG ancestor 중복 제거
     - descendant가 있으면 ancestor 제거
    ↓
[L8] 저장 + 캐시 write
     - listing_tags 삽입
     - missing_tags → tag_suggestions 큐잉
     - useCount++ 배치 업데이트
```

---

## 4. LLM Context Engineering

### 4.1 모델 확정

**GPT-4o-mini** (`gpt-4o-mini`)

**이유:**
- 기존 OpenAI SDK 이미 사용 중 (`embedding.service.ts`)
- 비용: $0.15/$0.60 per 1M tokens (입력/출력)
- JSON strict mode robust
- 한국어/영어 robust
- Grok 4 Fast ($0.20) 대비 이점 없음, Grok 4 ($3) 과잉

### 4.2 System Prompt

```
You are a tag curator for a P2P marketplace. Your job is to select the MINIMUM set of tags that uniquely identify a listing.

Rules:
1. Prefer specific tags over generic ones. A specific tag makes its ancestors redundant (DAG auto-includes parents).
2. Only select from the provided candidate list (ref ids t01~t20). Never invent new tags.
3. If a critical attribute is missing from candidates, return it in `missing_tags` as a natural-language suggestion (max 2).
4. Select 3-6 tags. Fewer is better if they fully describe the item.
5. Output strict JSON only.

Tag selection priority:
- Product identity (model/SKU) > Brand > Category
- Condition (new/used/sealed) if stated
- Key variant (color, storage, size) if stated
- Skip purely decorative tags
```

### 4.3 Few-shot Examples (3개)

**Example 1 — 명확한 모델 (ancestor 제거):**
```
LISTING: "아이폰 17 Pro 256GB 네이비 미개봉"
CANDIDATES:
t01 iphone-17-pro [idf=4.2, parent=t05]
t02 256gb [idf=2.1, parent=storage]
t03 navy [idf=1.8, parent=color]
t04 sealed [idf=3.5, parent=condition]
t05 iphone-17 [idf=3.8, parent=iphone]
...
OUTPUT: {
  "selected_tag_ids": ["t01", "t02", "t03", "t04"],
  "reasoning": "iphone-17-pro implies iphone-17/iphone/phone/apple via DAG ancestors",
  "missing_tags": []
}
```

**Example 2 — 다른 도메인 (일반화):**
```
LISTING: "빈티지 가죽 자켓 M사이즈 브라운"
CANDIDATES:
t01 leather-jacket [idf=3.1, parent=jacket]
t02 vintage [idf=2.8]
t03 brown [idf=1.5]
t04 size-m [idf=1.2]
t05 jacket [idf=2.0, parent=outerwear]
...
OUTPUT: {
  "selected_tag_ids": ["t01", "t02", "t03", "t04"],
  "reasoning": "leather-jacket implies jacket/outerwear/clothing via DAG",
  "missing_tags": []
}
```

**Example 3 — 부족 케이스 (missing_tags 사용):**
```
LISTING: "닌텐도 스위치 OLED 화이트 조이콘 포함"
CANDIDATES:
t01 switch [idf=3.2, parent=nintendo]
t02 white [idf=1.4]
t03 nintendo [idf=2.9, parent=gaming]
...
OUTPUT: {
  "selected_tag_ids": ["t01", "t02"],
  "reasoning": "switch implies nintendo/console/gaming; OLED variant missing",
  "missing_tags": ["switch-oled"]
}
```

### 4.4 User Message Template

```
LISTING:
title: {title}
description: {description_truncated_300}
category_path: {category_breadcrumb}
price_band: {price_band}

CANDIDATES:
t01 {label} [idf={idf}, parent={parent_ref}]
t02 ...
...
t20 ...

Return JSON matching the schema.
```

### 4.5 Ref id 매핑 (실수 원천 차단)

```typescript
// 코드 측 매핑
const refMap = new Map<string, string>();
candidates.forEach((tag, i) => {
  const ref = `t${String(i + 1).padStart(2, '0')}`;
  refMap.set(ref, tag.id);
});

// LLM에는 ref만 노출
// 출력 받은 후 복원
const realIds = output.selected_tag_ids
  .map(ref => refMap.get(ref))
  .filter((id): id is string => id !== undefined); // 검증
```

**이유:** ULID/slug 복사 중 typo 0%. LLM은 "선택"만, id 체계 무지.

### 4.6 Output Schema (strict)

```typescript
response_format: {
  type: "json_schema",
  json_schema: {
    name: "tag_selection",
    strict: true,
    schema: {
      type: "object",
      properties: {
        selected_tag_ids: {
          type: "array",
          items: { type: "string", pattern: "^t[0-9]{2}$" },
          minItems: 1,
          maxItems: 6
        },
        reasoning: { type: "string", maxLength: 200 },
        missing_tags: {
          type: "array",
          items: { type: "string" },
          maxItems: 2
        }
      },
      required: ["selected_tag_ids", "reasoning", "missing_tags"],
      additionalProperties: false
    }
  }
}
```

### 4.7 토큰 & 비용 예산

| 항목 | 토큰 | 비용 (1M listings) |
|---|---|---|
| System (cached) | 400 → 200 | — |
| Few-shot (cached) | 450 → 225 | — |
| Listing | 150 | — |
| Candidates (20) | 300 | — |
| Output | 80 | — |
| **합계 (effective)** | ~955 in / 80 out | **$0.19/1M** |
| 캐시 60% 히트 시 | — | **$0.08/1M** |

→ MVP 스케일(1만 리스팅/월): 월 **$0.002**. 사실상 무료.

---

## 5. Recursive Self-Tuning

### 5.1 주기별 작업

| 주기 | 작업 | 트리거 |
|---|---|---|
| 매 요청 | useCount++, lastUsedAt 업데이트 | listing publish |
| Daily batch | IDF 재계산, EMERGING/CANDIDATE 승격 검토 | cron 00:00 |
| Weekly | 유사 태그 merge 제안 (Levenshtein + cooccurrence) | cron Sun |
| Monthly | DAG 구조 refactoring 제안 (admin 검토) | cron 1st |
| Quarterly | Tag health report (미사용 deprecate) | manual |

### 5.2 Promotion/Demotion

```
CANDIDATE (useCount < 10)
    ↓ useCount ≥ 10, distinct_listings ≥ 5
EMERGING (10 ≤ useCount < 50)
    ↓ useCount ≥ 50, lastUsedAt ≤ 30d
OFFICIAL
    ↓ lastUsedAt > 90d
DEPRECATED (검색에서 숨김, DAG 유지)
```

### 5.3 Missing Tags Queue

LLM이 `missing_tags`로 제안한 것들은 `tag_suggestions` 테이블에 큐잉:

```typescript
interface TagSuggestion {
  id: string;
  label: string;           // "switch-oled"
  suggestedBy: 'LLM' | 'USER';
  firstSeenListingId: string;
  occurrenceCount: number; // 같은 제안 누적
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MERGED';
  reviewedBy?: string;
  createdAt: Date;
}
```

**자동 승격 규칙 (MVP 이후):**
- `occurrenceCount ≥ 20` + `distinct_listing_count ≥ 10` → 자동 CANDIDATE 생성
- MVP에서는 admin 수동 승인만

---

## 6. 기존 코드 재사용

| 기존 컴포넌트 | 재사용 방법 |
|---|---|
| `similar-listings.service.ts` — pgvector top-K | 후보 수집 (a) 경로 |
| `tag_idf_cache` 테이블 | IDF 점수 소스 |
| `weightedJaccard` | IG 프리필터에 사용 |
| `embedding.service.ts` — SHA-256 hash | 캐시 키 패턴 |
| `listing_embeddings` 테이블 | 유사 리스팅 검색 기반 |
| `packages/tag-core` | Status enum, config 확장 |

---

## 7. 신규 컴포넌트

### 7.1 DB 스키마 추가

- `tag_edges` — DAG 관계
- `tag_metadata_v2` (또는 기존 tags 확장) — idf, parents 배열, createdBy
- `tag_suggestions` — missing_tags 큐

### 7.2 서비스 (apps/api/src/services/)

- `tag-graph.service.ts` — DAG ancestors/descendants 쿼리
- `tag-candidate.service.ts` — L2 후보 수집 (a/b/c 3경로)
- `tag-placement-llm.service.ts` — L4~L6 LLM 호출 + ref 매핑
- `tag-placement.service.ts` — L0~L8 orchestrator

### 7.3 API 통합

- 리스팅 publish 훅에 `tag-placement.service` 호출 추가
- 관리자 엔드포인트: suggestions 검토, merge/approve

---

## 8. MVP vs Full 범위

### MVP (4월)
- ✅ Tag Graph (DAG) 스키마
- ✅ GPT-4o-mini 배치 파이프라인
- ✅ Ref id 매핑 + JSON strict
- ✅ 캐시 + fallback
- ✅ Missing tags 큐잉 (admin 수동 승인)
- ✅ Daily IDF 재계산
- ❌ 자동 promotion/demotion (수동만)
- ❌ Auto merge (제안만)
- ❌ Quarterly health report

### Full (post-MVP)
- Automated promotion/demotion
- Weekly similar-tag merge
- Monthly DAG refactoring
- A/B test infrastructure
- Per-user priority overrides

---

## 9. 확정 결정 (4/7 모임)

1. ✅ LLM 모델: **GPT-4o-mini**
2. ✅ 후보 수: 40 → **20개 프리필터**
3. ✅ Few-shot: **3개**
4. ✅ Ref id 형식: **t01~t20** (실수 원천 차단)
5. ✅ 선택 태그 수: **3~6개**
6. ✅ Output: JSON strict schema
7. ✅ 캐시 키: `sha256(title|desc|sorted(candidate_refs))`
8. ✅ Missing tags: admin 수동 승인 (MVP)

---

## 10. 다음 단계

1. 이 문서 리뷰 & 확정
2. DB 스키마 구현 (`tag_edges`, `tag_suggestions`)
3. Candidate 수집 서비스 구현
4. LLM 배치 서비스 구현
5. Orchestrator + API 훅 통합
6. 테스트 + 리스팅 publish 플로우 검증

*작성: 2026-04-08*
*관련 모임: 4/7 정기 미팅*
