# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 55 — Attestation Commit Backend (Supabase Storage)

### Context

Part A (Step 54-후속)에서 `seller_attestation_commits` 테이블 + `attestation-hash.ts` 유틸 완성. 이번 스텝은 **외부에서 호출 가능한 REST 엔드포인트 + 저장소 연동 + 검증 서비스**를 붙인다.

프론트엔드 판매 위자드는 Project Owner가 별도로 만든다. **이 스텝은 서버측만.**

### Locked Decisions

1. **저장소 = Supabase Storage** (S3 아님). 이유: 이미 `@supabase/supabase-js`가 deps에 있음, 신규 자격증명 불필요, presigned upload 네이티브 지원.
2. **Bucket name**: `attestation-evidence` (Project Owner가 Supabase 대시보드에서 생성. Bob은 코드만 작성, 버킷 생성 자체는 인프라.)
3. **Bucket privacy**: Private (public read 금지). RLS 또는 signed URL로만 접근.
4. **90일 lifecycle**: 이번 스텝에서는 구현 안 함. Step 57+에서 Supabase cron 또는 Edge Function으로 처리. 이번엔 `expires_at` 컬럼만 정확히 기록.
5. **IMEI 암호화**: **Supabase Vault (pgsodium) 사용**. `imei_encrypted` 컬럼에 Vault로 암호화된 ciphertext 저장. 읽기 시 `vault.decrypted_secrets` view 또는 `pgsodium.crypto_aead_det_decrypt()` 사용. Vault key는 Supabase 대시보드에서 Project Owner가 생성(`attestation_imei_key`). Bob은 SQL/서비스 레이어에서 encrypt/decrypt 호출만 작성. 평문 저장 금지.
6. **Canonical hash**: 기존 `apps/api/src/lib/attestation-hash.ts` 그대로 사용. 수정 금지.

### API Surface

**1) `POST /api/attestation/presigned-upload`**
- 판매자 위자드가 각 사진 업로드 직전에 호출
- Request body:
  ```json
  { "listingId": "uuid", "filename": "front.jpg", "contentType": "image/jpeg" }
  ```
- Response:
  ```json
  { "uploadUrl": "https://...signed...", "storagePath": "attestation-evidence/{listingId}/front.jpg", "expiresIn": 600 }
  ```
- 제약: 인증 필수(`requireAuth`), 호출자가 해당 listing의 seller여야 함
- Supabase SDK: `supabase.storage.from('attestation-evidence').createSignedUploadUrl(path)`
- 파일명 sanitization: filename은 alphanumeric + `.` 만 허용, 나머지는 거부

**2) `POST /api/attestation/commit`**
- 모든 사진 업로드 완료 후 위자드 submit 시 호출
- Request body:
  ```json
  {
    "listingId": "uuid",
    "imei": "123456789012345",
    "batteryHealthPct": 92,
    "findMyOff": true,
    "photoStoragePaths": ["attestation-evidence/{listingId}/front.jpg", ...]
  }
  ```
- 처리 순서:
  1. 인증 + seller 소유권 검증
  2. 해당 listing에 이미 commit 있으면 409 Conflict (append-only)
  3. 모든 `photoStoragePaths`가 실제 Supabase에 존재하는지 head 요청으로 확인
  4. `canonicalizeAttestation()` 호출 → canonical string
  5. `computeCommitHash()` → sha256
  6. `sellerAttestationCommits` insert (expiresAt = now + 30일, 임시값, 실제 리뷰 기간은 arp-core가 주문 단계에서 따로 계산)
  7. 응답: `{ commitId, commitHash, committedAt }`
- 실패 시 rollback 정책: upload된 파일은 그대로 둔다 (90일 cron이 치움). DB insert만 롤백.

**3) `GET /api/attestation/:listingId`**
- 분쟁 시 조회용
- 인증 필수. 접근 제어:
  - seller 본인 → 전체 반환
  - buyer (해당 listing 구매자) → 전체 반환
  - admin → 전체 반환
  - 그 외 → 404 (존재 여부 숨김)
- Response: commit row + signed view URLs (10분 유효) for each photo path
- IMEI는 `imei_encrypted` 필드명으로 그대로 반환 (암호화 미구현이지만 계약은 유지)

**4) 서비스: `verifyAttestationCommit(listingId, submittedPayload)`**
- 라우트 아님. 서비스 함수. `dispute-core`에서 호출 예정.
- 처리:
  1. DB에서 stored commit 조회
  2. `submittedPayload`를 다시 canonicalize + hash
  3. stored `commitHash`와 비교
  4. `{ match: boolean, storedHash, computedHash, divergence?: string[] }` 반환
- 단위 테스트: 동일 payload → match true / field 1개 변경 → match false / photoStoragePaths 순서 뒤섞임 → match false

### 파일 구조

```
apps/api/src/
├── routes/attestation.ts           ← 신규 (3개 엔드포인트)
├── services/
│   ├── attestation.service.ts      ← 신규 (commit, read, verify)
│   └── supabase-storage.service.ts ← 신규 (presigned URL, head 존재 체크)
├── lib/attestation-hash.ts          ← 기존 (수정 금지)
└── __tests__/
    ├── attestation.service.test.ts ← 신규 (hash verify, access control, 409 conflict)
    └── attestation.routes.test.ts  ← 신규 (엔드포인트 레벨, 인증 포함)
```

### 제약

- **DO NOT TOUCH**: `packages/shared`, `packages/db` 코어, `apps/api/src/lib/attestation-hash.ts`, 기존 route 파일들.
- **DO NOT ADD**: 새 npm 패키지. Supabase SDK는 이미 있음.
- **DO NOT**: 프론트 코드 손대기. 이번 스텝은 서버만.
- **DO**: IMEI는 Supabase Vault로 암호화. insert 시 `pgsodium.crypto_aead_det_encrypt()`, select 시 `vault.decrypted_secrets` 또는 decrypt 함수. Vault key 이름: `attestation_imei_key` (Project Owner가 대시보드에서 생성).
- **DO NOT**: 90일 TTL cron 구현. Step 57+.
- **DO**: 기존 `requireAuth` 미들웨어 패턴 따르기 — `apps/api/src/routes/tags.ts` 참고.
- **DO**: 기존 에러 응답 형식 따르기.
- **DO**: 모든 path/filename 입력 sanitization.
- **DO**: Supabase 버킷명/경로 상수는 `apps/api/src/lib/supabase-storage-paths.ts`에 분리.

### Environment Variables

기존에 이미 있어야 할 것들 (확인만, 추가 금지):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Bob 확인사항: `apps/api/.env.example`에 위 두 개가 있는지 grep. 없으면 `.env.example`에만 추가 (실제 값은 Project Owner가 설정).

### Known Risks (BUILD-LOG에 기록)

1. **Supabase Vault key 관리** — key rotation은 Project Owner 책임. Bob은 key 이름만 참조.
2. **Supabase head() 호출 비용** — commit 당 N개 (사진 수) head 요청. 사진 5개 기준 5 calls. 무시 가능.
3. **PhotoStoragePaths 순서 의존성** — canonical hash는 순서 보존. 판매자가 재업로드 시 순서 바뀌면 hash 달라짐. 위자드 UX에서 순서 고정 필요 — 프론트 책임.

### Success Criteria

- [ ] 3개 엔드포인트 구현 완료
- [ ] `verifyAttestationCommit()` 서비스 구현 + 단위 테스트 3개 이상
- [ ] 접근 제어 테스트 (seller/buyer/admin/기타)
- [ ] 409 Conflict 중복 commit 테스트
- [ ] `pnpm --filter @haggle/api typecheck` clean
- [ ] `pnpm --filter @haggle/api test` green (기존 263 + 신규)
- [ ] `pnpm test` 전체 green
- [ ] BUILD-LOG에 Known Risks 3개 명시
- [ ] REVIEW-REQUEST.md 작성

### Build Order (Bob)

1. Supabase storage 서비스 (`supabase-storage.service.ts`) — presigned URL, head 체크
2. Attestation 서비스 (`attestation.service.ts`) — commit, read, verify
3. Attestation 라우트 (`attestation.ts`) — 3개 엔드포인트 + 인증
4. 단위 테스트
5. 통합 테스트 (라우트 레벨)
6. BUILD-LOG 업데이트 (append, don't overwrite)
7. REVIEW-REQUEST.md 작성

### Handoff

Bob: 이 브리프 + `apps/api/src/lib/attestation-hash.ts` + `packages/db/src/schema/seller-attestation-commits.ts` 읽고 시작. 의문점은 ARCHITECT-BRIEF 확인 요청으로 돌려보내. 브리프 불완전하다고 느끼면 코드 한 줄도 쓰지 말 것.

Richard: Bob이 REVIEW-REQUEST 쓰면 대기. 핵심 리뷰 포인트는 접근 제어(특히 `GET /attestation/:listingId`의 404 숨김), canonical hash 무수정 확인, 그리고 Supabase SDK 사용 패턴이 기존 코드 컨벤션과 일치하는지.
