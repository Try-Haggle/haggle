# 협상 모드 사용자 문구 수정

- 작업: `W2026-08-22-02`의 독립 협상 UX slice
- 담당: 정행 (`jeonghaeng`), 사용자 별칭 `jeonghaengheo`
- 브랜치: `feature/w2026-08-22-02-negotiation-mode-copy`
- 상태: 로컬 검증 완료, 같은 SHA 최종 CI 성공 후 사용자 요청대로 staging에 통합·배포
- 기존 리뷰어 배정은 보존하며 리뷰 요청·승인은 이 slice의 필수 조건이 아니다.

## 사용자 결과

구매자·판매자 협상에서 공용 토글의 `Haggle AI Soft turns`를 `Negotiation mode`로 바꾼다.
Auto는 `Haggle AI negotiates for you`, Manual은 `you or your own agent negotiate`로
설명한다. 계정 설정의 모드 제목·설명·접근성 이름도 같은 표현을 사용한다.
설정의 Hard Authority 문구는 두 모드 모두 가격 한도와 승인 조건을 따른다고 설명한다.

기준은 [i18n Scope A](./i18n-scope-a-sot.md) §1–§2의 사용자용 쉬운 표현과
[Auto/Manual SoT](./auto-manual-control-mode-sot.md)의 모드 의미다.
프로토콜 식별자와 동작, 가격 한도·승인·과금·결제·모델 설정은 변경하지 않는다.

## 완료 조건과 검증

- 협상 공용 토글과 계정 기본 모드 설정에서 내부 Soft/Hard 용어가 노출되지 않는다.
- Auto/Manual 설정 저장과 재진입, 서버 모드 변경, 진행 중 호출 뒤 전환 동작이 유지된다.
- 기존 관련 테스트 15건, Web 타입 검사·빌드, 변경 파일 Biome·공백 검사 통과.
- 공개 화면 Playwright smoke 3건 통과.
- 실제 컴포넌트를 Browser의 Playwright로 렌더링해 Auto/Manual 문구, 전환, 설정 저장과 새로고침 뒤 Manual 유지 확인.
- 같은 SHA의 최종 CI(품질·빌드·테스트, Playwright, production dependency audit) 성공 후 staging 통합.
- 실제 staging 도메인이 통합 SHA의 준비 완료 배포를 가리키는지 확인한다.

`pnpm work:me -- jeonghaengheo`는 기존 `HAGA-88`의 누락된 의존 작업 `HAGA-94` 때문에
실패했다. 기존 작업 그래프에서 정행의 `W2026-08-22-02` 담당과 선행 작업 없음은 직접 확인했다.
무관한 담당자·의존 작업은 수정하지 않는다. 상위 작업의 남은 전략 품질 재측정은 그대로 두며
이 문구 slice로 상위 작업 전체를 완료 처리하지 않는다.
