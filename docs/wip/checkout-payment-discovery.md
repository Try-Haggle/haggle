# 실제 checkout 결제 수단과 지갑 연결 안내

- 작업: `W2026-08-08-01`의 독립 checkout UX slice
- 담당: 정행 (`jeonghaeng`), 사용자 별칭 `jeonghaengheo`
- 브랜치: `feature/w2026-08-08-01-checkout-payment-discovery`
- 사용자 지시: 실제 checkout의 한국어 혼선과 카드/USDC·MetaMask 선택 경로를 찾아 수정하고 staging에 push
- 상태: 로컬 검증 중, 같은 head SHA 최종 CI 성공 후 staging 통합·배포
- 기존 인오 proposed 배정은 보존하며 리뷰 요청·승인은 이 slice의 필수 조건이 아니다.

## 사용자 결과와 기준

실제 checkout은 [전체 합의 SoT](./checkout-full-agreement-sot.md)에 따라 합의 전체를 보여주고
`Pay as agreed` / `이대로 결제`를 확인한 다음에만 실제 결제 UI를 연다.
기존에는 결제 수단이 이 확인 뒤에만 나타났고, 긴 합의 화면 맨 아래에서 확인해도 새 화면으로
포커스·스크롤을 옮기지 않았다. 배송 테스트를 고르지 않았을 때 두 결제 수단이 비활성화되는
이유도 표시하지 않았다. 합의 UI만 번역되고 결제 UI는 영어에 고정돼 언어가 섞였다.

- 합의 확인 화면에 카드(Stripe의 USDC 구매), 직접 지갑 결제, 다음 단계의 MetaMask 등
  지원 지갑을 설명한다. 이 안내는 읽기 전용이며 실제 결제 선택·지갑은 확인 뒤에만 열린다.
- 확인 버튼 아래에 합의 확인만 수행하며 아직 결제를 보내지 않는다고 설명한다.
- 합의 정보가 부족해 확인할 수 없으면 협상으로 돌아가 내용을 완성해야 함을 표시한다.
- 확인 후 새 결제 영역으로 포커스와 스크롤을 이동한다. 카드·직접 결제 옵션을 유지한다.
- 배송 테스트 미선택으로 결제 수단이 막힌 이유를 명시한다.
- 기본 언어는 기존 English. checkout에서 설정 언어를 확인·변경할 수 있고, 명시적인 Korean
  선택은 합의·결제 안내·버튼·wallet chooser에 함께 적용한다. 숫자·가격·주소·합의 조건·해시는
  원본을 유지한다. 원본 협상 사실·서버/외부 서비스 오류는 번역해 다시 해석하지 않는다.

기준은 [i18n Scope A](./i18n-scope-a-sot.md)와
[staging Onramp 경로](./staging-onramp-test-mode-map.md)다.
API 결제 요청·승인 조건·수수료 계산·계약 호출·원자적 승인/예치·중복 제출 보호는 변경하지 않는다.
모델, live provider, 실제 가치 자산, 컨트랙트 배포, DB migration은 이 slice의 범위가 아니다.

## 검증과 완료 조건

- 기존 합의 확인·payment 회귀 및 한국어 선택 검사: 확인 전 rail 미생성, 원본 terms hash 전달,
  불완전 합의 차단, 확인 후 포커스 이동, 지갑 변경/네트워크/재시도/중복 제출 보호.
- 실제 CheckoutPayment + PaymentStep + WalletProvider를 Vite fixture로 렌더링한 Playwright
  desktop/mobile 6건 통과. 카드·hUSDC 양쪽 선택, 실제 RainbowKit MetaMask chooser,
  EN/KO 변경·다시 English 선택 후 재진입, 미완성 합의 안내를 확인했다.
- 해당 브라우저 검증의 `/api/payments` 요청은 0건. 돈 이동·지갑 권한 승인·서명은 하지 않았다.
- 관련 단위 검사와 Web 타입 검사 통과. Web 빌드 통과. 같은 SHA 최종 CI를 확인한다.
- 전체 로컬 Web 검사에서 기존 stall watchdog 3건의 5초 timeout 및 기존 confetti/jsdom 오류가
  관찰됐다. 해당 파일은 이 slice에서 수정하지 않는다. 기준 staging b3c222a3의 전체 CI는 성공이며,
  이 slice도 전체 테스트를 포함한 최종 CI 성공 전 병합하지 않는다.
- 실제 staging 도메인이 통합 SHA의 READY 배포를 가리키는지 확인하고 PR에 배포 증거를 남긴다.
- 최초 CI에서 전체 타입·테스트·빌드와 의존성 보안은 통과했다. 별도 browser job은 공통 패키지의
  `dist`가 없는 깨끗한 환경에서 fixture를 열어 실패했다. 해당 job에서 `@haggle/shared`를 먼저
  빌드하도록 수정하고 깨끗한 worktree에서 검증했다. 최종 head의 CI 성공을 다시 확인한다.

`pnpm work:me -- jeonghaengheo`는 기존 `HAGA-88`의 누락된 의존 작업 `HAGA-94`로 실패했다.
그래프에서 정행의 기존 `W2026-08-08-01` 담당과 선행 작업 없음은 직접 확인했다.
상위 결제·실배송·분쟁 리허설과 실제 자금 검증은 별도 남은 범위이며, 이 UX slice로 상위 작업 전체를
완료 처리하지 않는다.
