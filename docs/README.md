# Haggle Docs

> 문서 라우터. 모든 문서는 여기서 찾는다.

---

## 현행 문서 (Living Docs)

살아있는 문서. 변경 시 업데이트 필수.

| 문서 | 용도 | 관리자 |
|------|------|--------|
| [MVP_Final_Implementation_Plan.md](./MVP_Final_Implementation_Plan.md) | MVP vertical slice 계획 + 진행 상황 | CEO + Arch |
| [MVP_TECH_DEBT.md](./MVP_TECH_DEBT.md) | MVP에서 의도적으로 단순화한 결정 추적 | Arch |
| [Main_Branch_Release_Policy.md](./Main_Branch_Release_Policy.md) | main 브랜치 운영 원칙 | CEO |
| [smart-contract-security-report.md](./smart-contract-security-report.md) | 스마트 컨트랙트 보안 감사 | Arch |
| [engine/00_INDEX.md](./engine/00_INDEX.md) | 엔진 + HNP 프로토콜 기술 사양 (24개 문서) | Arch |

## 설계 문서 (Design — 미구현)

구현 전까지 유지. 구현 완료 시 archive로 이동.

| 문서 | 대상 | 상태 |
|------|------|------|
| [분쟁_시스템_v2.md](./분쟁_시스템_v2.md) | 분쟁 비용 v2 (T1/T2/T3) | Phase 3 DB/API 연동 대기 |
| [게이미피케이션_설계.md](./게이미피케이션_설계.md) | 캐릭터 가챠 + 레벨 시스템 | Post-MVP |
| [Haggle_Moat_Strategy.md](./Haggle_Moat_Strategy.md) | 해자 전략 + LegitApp 리서치 | 전략 참고 |
| [engine/Haggle_Gap_Analysis.md](./engine/Haggle_Gap_Analysis.md) | 엔진 vs 논문 갭 분석 | 엔진 개선 방향 |

## 작업 문서 (WIP)

구현 중 임시 문서. **구현 완료 → 즉시 삭제 또는 archive 이동.**

> `docs/wip/` 폴더 사용. 여기 있는 파일은 일시적.

## 미팅

`docs/meetings/` — 미팅 노트, 아젠다, 의사결정 기록.

## Archive

`docs/archive/` — 구현 완료되었거나 대체된 문서. 참고용으로만 보존.

---

## 문서 관리 규칙

1. **구현 완료 → archive**: 설계 문서의 내용이 코드에 반영되면 `docs/archive/`로 이동
2. **WIP → 삭제**: `docs/wip/` 파일은 구현 완료 시 삭제
3. **한 주제 한 문서**: 같은 주제의 문서가 여러 개면 하나로 합침
4. **이 README 업데이트**: 문서 추가/이동 시 반드시 이 테이블도 업데이트

*Last Updated: 2026-04-03*
