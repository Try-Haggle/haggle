# 태그 패밀리별 시스템 프롬프트

같은 `resolveChecks` 결과가 나오는 태그는 같은 프롬프트를 쓴다.
리스팅 `category` + `tags`에서 토큰/별칭이 잡히면 아래 path가 매칭된다.
`iphone-15-pro` → `iphone` 토큰 → `electronics/phones/iphone`.

공통 앞부분(역할 페르소나, BOX, B:/C:, JSON 스키마)은 이미 `DeepSeekAdapter.buildSystemPrompt`에 있다.
아래에 붙일 것은 **이 태그 묶음에서 sellerStatedFacts / requiredCriteria를 어떻게 읽을지**다.
질문 목록은 엔진이 이미 `## Category checks`로 넣으니 다시 나열하지 말고, stance를 인용하는 예시만 넣는다.

캐시: (buyer|seller) × 아래 패밀리 하나가 하나의 system prefix다.

---

## 지금 쓸 패밀리 (MVP)

### phones / iphone

**매칭:** `iphone`, `아이폰`, `iphone-15-pro` 같은 하이픈 태그, category `electronics`

**하드:** IMEI, 할부 완납, 침수, Find My
**가격:** 용량, 배터리%, 언락, 외관

```
This listing matched electronics/phones/iphone.
Hard gates (do not ACCEPT while these fail; do not contradict a disclosed fail):
- IMEI clean & verifiable
- financing paid off
- no liquid damage
- Find My / activation lock off
Price levers (if two memos differ only here, COUNTER must differ and message must name the stance):
- storage_capacity: "128GB storage" | "256GB storage" | "512GB storage" | "1TB or larger storage"
- battery_health: "90% or higher" | "80–89%" | "below 80%" | "not checked"
- carrier_lock: "carrier-unlocked" | "locked to a carrier"
Cite one sellerStatedFacts or requiredCriteria stance in message.
```

### phones / samsung

**매칭:** `samsung`, `galaxy`, `삼성`, `갤럭시`

아이폰과 같되 Find My 대신:
- Google FRP removed
- Samsung reactivation lock off

### phones / pixel

**매칭:** `pixel`, `google-pixel`, `pixel-phone`, `구글 픽셀`

아이폰과 같되 Find My 대신:
- Google FRP removed
(삼성 재활성화 잠금은 없음)

### laptops

**매칭:** `laptop`, `macbook`, `notebook`, `노트북`

```
This listing matched electronics/laptops.
Hard gates: boots and is not parts-only; no Find My Mac / EFI / MDM lock; no liquid damage.
Price levers: battery cycle count; CPU/RAM/storage spec; cosmetic grade.
Do not price a non-booting or locked machine as a working laptop.
```

### sneakers

**매칭:** `sneakers`, `jordan`, `yeezy`, `dunk`, `스니커즈`

```
This listing matched clothing/sneakers.
Hard gates: authenticity / proof. Do not ACCEPT a pair with no proof if requiredCriteria says authentic only.
Price levers: size match; deadstock vs worn; original box; cosmetic grade.
A size miss or no-box pair must not reuse a DS-with-box price.
```

### vehicles

**매칭:** category `vehicles` (브랜드 태그만 있어도 VIN 질문이 붙음)

```
This listing matched vehicles.
Hard gates: clean title in hand; no undisclosed lien; VIN matches and is not stolen; odometer not rolled; no flood; no frame damage.
Price levers: mileage (use the exact number in LISTING/OPP_SAID, not a bucket); service history; accident history.
Do not ACCEPT on price if a hard title/VIN/flood fact is missing or failed.
```

차량 하위는 같은 프롬프트에 한 줄만 더한다.

- `tesla` / `전기차` → battery state of health, battery warranty
- `cummins` / `디젤` → emissions delete status
- `motorcycle` / `오토바이` → dropped/crash evidence, tire/chain
- `rv` / `캠핑카` → water intrusion, propane, appliances
- `boats` / `보트` → HIN, hull, engine hours
- `atv` / `사륜` → frame crack/bent, hours

### generic (태그 매칭 실패)

```
General marketplace item.
Judge condition, completeness, and fair market value on the item's own merits.
Raise verification only when LISTING or STRATEGY actually states it.
```

---

## 나머지 패밀리 — 프롬프트에 넣을 한 줄

질문이 이미 system에 붙으니, few-shot은 **하드 / 가격 레버**만 가르치면 된다.

| 패밀리 | 매칭 별칭 | 하드 | 가격 레버 |
|---|---|---|---|
| electronics (bare) | category만 electronics | 없음 | 작동, 외관 |
| phones (브랜드 없음) | phones | IMEI, 할부, 침수 | 배터리, 언락, 용량 |
| tablets | tablet, ipad, 아이패드 | 활성화 잠금 | 화면, Wi-Fi/셀룰러 |
| pc-parts | gpu, 그래픽카드 | 채굴, 출력, 커넥터 탄 흔적 | 모델/VRAM |
| cameras | camera, dslr, 미러리스 | 도난, 촬영됨 | 셔터, 센서 |
| cameras/lens | lens, 렌즈 | 곰팡이, 헤이즈, 마운트 | (카메라 상속) |
| tv | tv, monitor, 모니터 | 패널 균열, 점등, OLED 번인 | 패널 스펙 |
| headphones | airpods, 에어팟, 이어폰 | 가품, Find My 언페어, 페어링 | 케이스 포함 |
| consoles | ps5, xbox, 플스 | 밴, 모드칩, 디스크 읽힘 | 모델 리비전 |
| smartwatch | apple-watch, 워치 | 활성화 잠금, 전원 | 케이스 사이즈 |
| drones | drone, dji, 드론 | 계정 바인딩, 추락/플라이어웨이, 비행 | 모델 |
| clothing | fashion, 의류 | 정품 | 사이즈, 착용 상태 |
| handbags | lv, chanel, 명품가방 | 정품 | 컨디션 등급 |
| watches | rolex, 명품시계 | 정품, 박스/페이퍼 | 오버홀 |
| jewelry | 주얼리, 반지 | 함량각, 다이아 감정, 천연/랩 | 사이즈 |
| sunglasses | ray-ban, 선글라스 | 정품 | 렌즈/테 상태 |
| collectibles | 수집품, 피규어 | COA | 등급, 구성품 |
| trading-cards | pokemon, 포켓몬카드 | 슬랩/가품 | 등급 |
| coins | 주화, 화폐 | 감정, 위조 | 등급 |
| comics | 코믹스 | 감정, 복원 | 등급 |
| vinyl | 엘피, 레코드 | 부틀렉 | 미디어/슬리브 등급 |
| artwork | 그림, 판화 | 원작 vs 복제, COA | 상태 |
| instruments | guitar, 기타 | 도난, 정품 | 작동 |
| bicycles | bike, 자전거 | 시리얼 | 프레임, 구동계, 사이즈 |
| ebike | 전기자전거 | 시리얼, 배터리 리콜 | 모터/배터리 |
| golf | 골프채 | 가품 | 샤프트 스펙 |
| skis | 스키, 스노보드 | 바인딩 안전, 구조 | 사이즈 |
| fitness | peloton, 덤벨 | 전원, 펠로톤 잠금 | 마모 |
| furniture | 가구 | 없음 | 치수, 재질, 손상, 펫/스모크 |
| mattress | 매트리스 | 빈대, 체액, 곰팡이 | (가구 상속) |
| upholstered | sofa, 소파 | 빈대, 프레임 | 냄새 |
| wood | 책상, 서랍장 | 수분, 구조 | 목재 |
| office-chair | aeron, 의자 | 가스실린더, 정품 | 메커니즘 |
| appliances | 가전 | 작동, 리콜 | 치수 |
| refrigerator | 냉장고 | 냉각, 곰팡이/냄새 | |
| laundry | 세탁기, 건조기 | 작동, 누수, 전원 타입 | |
| stove | 오븐, 인덕션 | 화구, 가스 누설 | |
| microwave | 전자레인지 | 작동, 리콜 | |
| air-conditioner | 에어컨 | 냉각, 냉매/곰팡이 | |
| space-heater | 히터 | 전기 안전, 안전장치 | |
| tools | 공구, 드릴 | 모터, 코드 안전 | |
| cordless-tool | dewalt, milwaukee | 배터리/충전기 | |
| baby/car-seat | 카시트 | 유효기간, 사고, 리콜 | 거래 자체를 보수적으로 |
| baby/stroller | 유모차 | 리콜, 브레이크/하네스 | |
| baby/crib | 아기 침대 | 드롭사이드, 하드웨어 리콜 | |
| baby/carrier | 아기띠 | 버클 리콜 | |
| board-games | 보드게임 | 구성 완비 | 에디션 |
| kitchenware | 냄비, 팬 | 코팅, 균열 | |
| pet-supplies | 케이지, 수족관 | 소독, 누수 | |
| outdoor-power | 잔디깎이, 그릴 | 엔진 시동, 가스/녹 | |
| books | 책 | 없음 | 판본, 상태, 구성 |
| textbook | 교재 | ISBN/판 일치 | 액세스 코드 |
| tires | 타이어, 휠 | DOT 연식, 사이드월 | 트레드 |
| scooters | 킥보드 | 시리얼, 도난, 배터리 리콜 | 배터리 |

---

## 쓰지 말 것

- 리스팅마다 다른 가격을 system에 넣지 않는다. stance 문자열과 읽는 법만 고정한다.
- Faratin beta/alpha, w_p 같은 레거시 엔진 숫자는 넣지 않는다.
- 아이폰 IMEI 문장을 노트북/옷에 복사하지 않는다.
