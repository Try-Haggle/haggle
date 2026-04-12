# Haggle Docs

> 문서 라우터. 모든 문서는 여기서 찾는다.

---

## 폴더 구조

| 폴더 | 내용 | INDEX |
|------|------|-------|
| [`mvp/`](./mvp/00_INDEX.md) | MVP 출시 계획, 기술 부채, 운영 정책 | [00_INDEX](./mvp/00_INDEX.md) |
| [`engine/`](./engine/00_INDEX.md) | 엔진 + HNP 프로토콜 기술 사양 (24개 문서) | [00_INDEX](./engine/00_INDEX.md) |
| [`contracts/`](./contracts/00_INDEX.md) | 스마트 컨트랙트 보안 감사 | [00_INDEX](./contracts/00_INDEX.md) |
| [`strategy/`](./strategy/00_INDEX.md) | 사업 전략, 해자, 파트너 리서치 | [00_INDEX](./strategy/00_INDEX.md) |
| [`features/`](./features/00_INDEX.md) | 기능별 설계 문서 (태그, 분쟁, 게이미피케이션) | [00_INDEX](./features/00_INDEX.md) |
| [`meetings/`](./meetings/) | 미팅 노트, overview, 의사결정 기록 | — |
| [`wip/`](./wip/) | 구현 중 임시 문서 (완료 시 삭제) | — |
| [`archive/`](./archive/) | 구현 완료 또는 대체된 문서 (보존용) | — |

---

## 자주 찾는 문서

| 문서 | 경로 |
|------|------|
| MVP 구현 계획 | [mvp/MVP_Final_Implementation_Plan.md](./mvp/MVP_Final_Implementation_Plan.md) |
| MVP 기술 부채 | [mvp/MVP_TECH_DEBT.md](./mvp/MVP_TECH_DEBT.md) |
| 스마트 컨트랙트 보안 | [contracts/smart-contract-security-report.md](./contracts/smart-contract-security-report.md) |
| 해자 전략 | [strategy/Haggle_Moat_Strategy.md](./strategy/Haggle_Moat_Strategy.md) |
| 태그 시스템 설계 | [features/tag-system-design.md](./features/tag-system-design.md) |
| 분쟁 시스템 v2 | [features/분쟁_시스템_v2.md](./features/분쟁_시스템_v2.md) |
| 게이미피케이션 | [features/게이미피케이션_설계.md](./features/게이미피케이션_설계.md) |
| 엔진 아키텍처 | [engine/01_아키텍처_개요.md](./engine/01_아키텍처_개요.md) |
| 미팅 overview | [meetings/overview.html](./meetings/overview.html) |

---

## 문서 관리 규칙

1. **구현 완료 → archive**: 설계 문서 내용이 코드에 반영되면 `docs/archive/`로 이동
2. **WIP → 삭제**: `docs/wip/` 파일은 구현 완료 시 삭제
3. **한 주제 한 문서**: 같은 주제의 문서가 여러 개면 하나로 합침
4. **INDEX 업데이트**: 문서 추가/이동 시 해당 폴더의 `00_INDEX.md`와 이 README 둘 다 업데이트
5. **단일 파일 → 폴더 승격**: 같은 주제에 2개 이상 문서 쌓이면 전용 폴더 생성

*Last Updated: 2026-04-08*
