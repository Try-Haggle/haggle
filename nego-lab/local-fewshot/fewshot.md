Electronics only. Each USER block is a live DECIDE memo. Read `sellerStatedFacts` and `requiredCriteria` before you invent a spec. Hard-gate failures → HOLD or keep talking, never ACCEPT on price alone. Soft-stance differences → different COUNTER and the message names that stance. Stay inside BOX. Buyer never counters below their own last offer. Seller never dumps to floor.

Tactics: anchoring, reciprocal_concession, condition_trade, time_pressure_close, nibble, bundling.

---
# phones / iphone  (tags: iphone, 아이폰, iphone-15-pro)

USER (buyer open — storage stance is weaker than preference)
LISTING:
  title: iPhone 15 Pro
  category: electronics
  tags: iphone-15-pro
  sellerStatedFacts: 저장 용량은 얼마인가요? = 128GB storage; 배터리 성능(%)은 얼마인가요? = battery health 90% or higher; 통신사 언락 상태인가요? = carrier-unlocked; IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요? = clean IMEI, not blacklisted, verifiable; Find My(활성화 잠금)가 해제되어 있나요? = Find My / activation lock is off
STRATEGY:
  preferences: 저장 용량은 얼마인가요? = at least 256GB
S:open|R1/8|buyer|auto
B:t$800.00/f$850.00/c$0.00/o$900.00/g$100.00
C:rec$820.00|anchoring|opp:unknown|conv:0.00|tp:0.40
BOX:
  Propose your COUNTER between $780.00 and $840.00 (your safe range this round; a price outside is clamped).
  baseline (engine's fair aim) = $820.00.
OPP_SAID: Unlocked, 90% battery, clean IMEI. Asking $900.
ASSISTANT
{"action":"COUNTER","price":795.00,"reasoning":"Storage stance is 128GB against my 256GB+ preference. Open under baseline and name that fact.","message":"You listed 128GB storage — I wanted 256GB+, so $795 is where I can start.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.35,"toughness":0.55,"est_reservation_price":860,"confidence":0.45}}

---
USER (seller — buyer priced a smaller SKU)
LISTING:
  title: iPhone 15 Pro
  tags: iphone
  sellerStatedFacts: 저장 용량은 얼마인가요? = 1TB or larger storage; 배터리 성능(%)은 얼마인가요? = battery health 90% or higher; 통신사 언락 상태인가요? = carrier-unlocked
S:bargain|R2/8|seller|auto
B:t$900.00/f$780.00/c$900.00/o$720.00/g$180.00
C:rec$860.00|reciprocal_concession|opp:aggressive|conv:0.10|tp:0.30
HIST:R1:$720.00/$900.00|g$180.00
BOX:
  Propose your COUNTER between $840.00 and $900.00.
  baseline (engine's fair aim) = $860.00.
OPP_SAID: Swappa 256GB comps are $720. I can do that.
ASSISTANT
{"action":"COUNTER","price":875.00,"reasoning":"They compared a 256GB comp to a 1TB stance. Hold above baseline; do not walk to the wrong SKU.","message":"Those $720 comps are 256GB. This is 1TB or larger storage — I can come to $875.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.4,"toughness":0.7,"est_reservation_price":800,"confidence":0.55}}

---
USER (seller concede — battery stance already disclosed as weak)
LISTING:
  title: iPhone 15 Pro
  tags: iphone-15-pro
  sellerStatedFacts: 저장 용량은 얼마인가요? = 256GB storage; 배터리 성능(%)은 얼마인가요? = battery health below 80%; 통신사 언락 상태인가요? = carrier-unlocked
S:bargain|R3/8|seller|auto
B:t$900.00/f$780.00/c$860.00/o$790.00/g$70.00
C:rec$820.00|reciprocal_concession|opp:fact_based|conv:0.40|tp:0.50
HIST:R1:$760.00/$900.00|g$140.00;R2:$790.00/$860.00|g$70.00
BOX:
  Propose your COUNTER between $800.00 and $845.00.
  baseline (engine's fair aim) = $820.00.
OPP_SAID: You listed battery health below 80%. A replacement is $90+ at Apple. $790 is as high as I go.
ASSISTANT
{"action":"COUNTER","price":818.00,"reasoning":"I already disclosed below 80%. Cannot defend $860. Sit on baseline.","message":"You're right — I disclosed battery health below 80%. $818 and we close.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.55,"toughness":0.75,"est_reservation_price":800,"confidence":0.6}}

---
USER (buyer — Find My still on; price is close)
LISTING:
  title: iPhone 15 Pro
  tags: iphone
  sellerStatedFacts: 저장 용량은 얼마인가요? = 256GB storage; Find My(활성화 잠금)가 해제되어 있나요? = Find My / activation lock still active; IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요? = IMEI not verified
STRATEGY:
  requiredCriteria: Find My(활성화 잠금)가 해제되어 있나요? = Find My / activation lock must be off before closing; IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요? = clean IMEI required — not lost or blacklisted
S:bargain|R3/8|buyer|auto
B:t$800.00/f$850.00/c$820.00/o$840.00/g$20.00
C:rec$830.00|reciprocal_concession|opp:firm|conv:0.50|tp:0.40
BOX:
  Propose your COUNTER between $820.00 and $845.00.
  baseline (engine's fair aim) = $830.00.
OPP_SAID: Price is fine at $840. Let's close now.
ASSISTANT
{"action":"HOLD","reasoning":"Find My still active and IMEI not verified. Hard gates beat a $20 gap.","message":"Price can wait. Find My is still on and IMEI is not verified — I need both cleared before I close.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.5,"toughness":0.55,"est_reservation_price":840,"confidence":0.55}}

---
# phones / samsung  (tags: samsung, galaxy, 삼성, 갤럭시)

USER (buyer — FRP still active)
LISTING:
  title: Galaxy S24 Ultra
  category: electronics
  tags: galaxy
  sellerStatedFacts: 저장 용량은 얼마인가요? = 256GB storage; 배터리 성능(%)은 얼마인가요? = battery health 90% or higher; Google 계정 잠금(FRP)이 해제되어 있나요? = FRP / Google account still active; 삼성 계정(Find My Mobile 재활성화 잠금)이 해제되어 있나요? = reactivation lock off, Samsung account cleared; IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요? = clean IMEI, not blacklisted, verifiable
STRATEGY:
  requiredCriteria: Google 계정 잠금(FRP)이 해제되어 있나요? = Google FRP must be removed
S:bargain|R2/8|buyer|auto
B:t$720.00/f$780.00/c$710.00/o$760.00/g$50.00
C:rec$735.00|reciprocal_concession|opp:firm|conv:0.30|tp:0.35
BOX:
  Propose your COUNTER between $720.00 and $760.00.
  baseline (engine's fair aim) = $735.00.
OPP_SAID: 256GB, 90% battery, I can do $760 today.
ASSISTANT
{"action":"HOLD","reasoning":"FRP is still active. That is a hard gate even though storage and battery look good.","message":"Specs are fine, but FRP / Google account is still active — I can't close until that's removed.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.45,"toughness":0.6,"est_reservation_price":750,"confidence":0.5}}

---
USER (seller — buyer ignored unlocked + paid-off)
LISTING:
  title: Galaxy S24
  tags: samsung
  sellerStatedFacts: 통신사 언락 상태인가요? = carrier-unlocked; 할부(약정)가 완납되어 블랙리스트 위험이 없나요? = fully paid off, no balance; 배터리 성능(%)은 얼마인가요? = battery health between 80% and 89%; Google 계정 잠금(FRP)이 해제되어 있나요? = FRP removed, Google account signed out
S:bargain|R2/8|seller|auto
B:t$640.00/f$540.00/c$640.00/o$480.00/g$160.00
C:rec$600.00|anchoring|opp:aggressive|conv:0.05|tp:0.25
BOX:
  Propose your COUNTER between $580.00 and $640.00.
  baseline (engine's fair aim) = $600.00.
OPP_SAID: Locked S24s are $480 on Swappa. That's my number.
ASSISTANT
{"action":"COUNTER","price":615.00,"reasoning":"They priced a locked/financed comp against unlocked and paid off. Hold above baseline.","message":"Those $480 comps are locked. This is carrier-unlocked and fully paid off — I can do $615.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.7,"est_reservation_price":520,"confidence":0.5}}

---
USER (buyer concede — they moved after FRP proof)
LISTING:
  title: Galaxy S23
  tags: 갤럭시
  sellerStatedFacts: 저장 용량은 얼마인가요? = 256GB storage; Google 계정 잠금(FRP)이 해제되어 있나요? = FRP removed, Google account signed out; 삼성 계정(Find My Mobile 재활성화 잠금)이 해제되어 있나요? = reactivation lock off, Samsung account cleared
S:bargain|R3/8|buyer|auto
B:t$420.00/f$470.00/c$410.00/o$445.00/g$35.00
C:rec$430.00|reciprocal_concession|opp:cooperative|conv:0.45|tp:0.50
HIST:R1:$400.00/$480.00|g$80.00;R2:$410.00/$460.00|g$50.00
BOX:
  Propose your COUNTER between $420.00 and $455.00.
  baseline (engine's fair aim) = $430.00.
OPP_SAID: FRP and Samsung lock are off. I came from $480 to $445.
ASSISTANT
{"action":"COUNTER","price":432.00,"reasoning":"They cleared both locks and moved $35 last round. Reciprocate less than they did, near baseline. Do not drop below my $410.","message":"Locks are clear — thanks. You moved to $445, I can meet at $432.","non_price_terms":{},"tactic_used":"reciprocal_concession","opponent_estimate":{"time_pressure":0.55,"toughness":0.45,"est_reservation_price":440,"confidence":0.6}}

---
# phones / pixel  (tags: pixel, google-pixel, 구글 픽셀)

USER (seller — water-damage stance is the weak fact)
LISTING:
  title: Pixel 8 Pro
  tags: google-pixel
  sellerStatedFacts: 저장 용량은 얼마인가요? = 256GB storage; 침수(액체 감지 표시)가 없는 상태인가요? = possible liquid exposure; Google 계정 잠금(FRP)이 해제되어 있나요? = FRP removed, Google account signed out; IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요? = clean IMEI, not blacklisted, verifiable
S:bargain|R2/8|seller|auto
B:t$520.00/f$430.00/c$520.00/o$390.00/g$130.00
C:rec$470.00|reciprocal_concession|opp:fact_based|conv:0.20|tp:0.40
BOX:
  Propose your COUNTER between $450.00 and $510.00.
  baseline (engine's fair aim) = $470.00.
OPP_SAID: You listed possible liquid exposure. I'm at $390.
ASSISTANT
{"action":"COUNTER","price":468.00,"reasoning":"Liquid exposure is already disclosed. Come to baseline; do not pretend it is a clean LCI unit.","message":"Fair — I disclosed possible liquid exposure. I can do $468, not a clean-LCI price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.4,"toughness":0.65,"est_reservation_price":420,"confidence":0.55}}

---
USER (buyer — they still financed)
LISTING:
  title: Pixel 8
  tags: pixel
  sellerStatedFacts: 할부(약정)가 완납되어 블랙리스트 위험이 없나요? = still under carrier installment; Google 계정 잠금(FRP)이 해제되어 있나요? = FRP removed, Google account signed out
STRATEGY:
  requiredCriteria: 할부(약정)가 완납되어 블랙리스트 위험이 없나요? = fully paid off — no outstanding carrier financing
S:open|R1/8|buyer|auto
B:t$380.00/f$420.00/c$0.00/o$450.00/g$70.00
C:rec$390.00|anchoring|opp:unknown|conv:0.00|tp:0.30
BOX:
  Propose your COUNTER between $360.00 and $410.00.
  baseline (engine's fair aim) = $390.00.
OPP_SAID: FRP is off. Asking $450.
ASSISTANT
{"action":"HOLD","reasoning":"Still under carrier installment is a hard mismatch with my paid-off requirement. Do not open a closeable price as if this is clear.","message":"FRP is fine, but it's still under carrier installment — I can't move on price until that's paid off.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.5,"est_reservation_price":430,"confidence":0.4}}

---
# tablets  (tags: tablet, ipad, 아이패드, galaxy-tab)

USER (buyer open — Wi-Fi unit vs cellular preference)
LISTING:
  title: iPad Air
  category: electronics
  tags: ipad
  sellerStatedFacts: Wi-Fi 전용인가요, 셀룰러 모델인가요? = Wi-Fi only model; 화면 상태(균열/데드픽셀/터치)는 어떤가요? = mint screen, no marks; 활성화 잠금(iCloud/계정)이 해제되어 있나요? = activation lock removed, signed out
STRATEGY:
  preferences: Wi-Fi 전용인가요, 셀룰러 모델인가요? = Wi-Fi + Cellular
S:open|R1/8|buyer|auto
B:t$380.00/f$430.00/c$0.00/o$470.00/g$90.00
C:rec$400.00|anchoring|opp:unknown|conv:0.00|tp:0.35
BOX:
  Propose your COUNTER between $370.00 and $420.00.
  baseline (engine's fair aim) = $400.00.
OPP_SAID: Mint screen, unlocked. $470.
ASSISTANT
{"action":"COUNTER","price":382.00,"reasoning":"Wi-Fi only against a cellular preference. Open under baseline and name connectivity.","message":"This is Wi-Fi only — I was looking for cellular. I can start at $382.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.35,"toughness":0.5,"est_reservation_price":440,"confidence":0.45}}

---
USER (seller — buyer used a cracked-screen comp)
LISTING:
  title: iPad Pro
  tags: 아이패드
  sellerStatedFacts: 화면 상태(균열/데드픽셀/터치)는 어떤가요? = mint screen, no marks; Wi-Fi 전용인가요, 셀룰러 모델인가요? = Wi-Fi + Cellular model; 활성화 잠금(iCloud/계정)이 해제되어 있나요? = activation lock removed, signed out
S:bargain|R2/8|seller|auto
B:t$720.00/f$600.00/c$720.00/o$520.00/g$200.00
C:rec$680.00|anchoring|opp:aggressive|conv:0.10|tp:0.25
BOX:
  Propose your COUNTER between $650.00 and $720.00.
  baseline (engine's fair aim) = $680.00.
OPP_SAID: Cracked iPad Pros are $520. I'll do that.
ASSISTANT
{"action":"COUNTER","price":695.00,"reasoning":"Mint screen + cellular is not a cracked-Wi-Fi comp. Hold above baseline.","message":"Those $520 comps are cracked. This is mint screen and cellular — I can do $695.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.25,"toughness":0.7,"est_reservation_price":580,"confidence":0.5}}

---
USER (buyer — activation lock still on)
LISTING:
  title: Galaxy Tab S9
  tags: galaxy-tab
  sellerStatedFacts: 활성화 잠금(iCloud/계정)이 해제되어 있나요? = activation lock still active; 화면 상태(균열/데드픽셀/터치)는 어떤가요? = screen has minor scratches
STRATEGY:
  requiredCriteria: 활성화 잠금(iCloud/계정)이 해제되어 있나요? = activation lock must be removed
S:bargain|R2/8|buyer|auto
B:t$410.00/f$460.00/c$400.00/o$440.00/g$40.00
BOX:
  Propose your COUNTER between $405.00 and $445.00.
  baseline (engine's fair aim) = $420.00.
OPP_SAID: Minor scratches only. $440 and it's yours.
ASSISTANT
{"action":"HOLD","reasoning":"Activation lock still active is a hard gate. Scratches are a price issue; lock is a close issue.","message":"Scratches I can live with. Activation lock is still on — I need that signed out before I talk closing price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.4,"toughness":0.55,"est_reservation_price":435,"confidence":0.5}}

---
# laptops  (tags: laptop, macbook, notebook, 노트북)

USER (buyer — parts-only boot stance)
LISTING:
  title: MacBook Pro 14
  category: electronics
  tags: macbook
  sellerStatedFacts: 전원이 켜지고 정상 부팅되나요(부품용 아님)? = does not boot — for parts; 활성화 잠금(Find My Mac/iCloud, EFI/MDM 조직 잠금)이 없나요? = no activation/firmware/MDM lock, signed out; CPU/RAM/저장 사양은 어떻게 되나요? = M2 Pro / 16GB / 512GB
S:open|R1/8|buyer|auto
B:t$280.00/f$350.00/c$0.00/o$700.00/g$420.00
C:rec$300.00|anchoring|opp:unknown|conv:0.00|tp:0.20
BOX:
  Propose your COUNTER between $260.00 and $330.00.
  baseline (engine's fair aim) = $300.00.
OPP_SAID: M2 Pro 16/512, asking $700.
ASSISTANT
{"action":"COUNTER","price":275.00,"reasoning":"It does not boot — for parts. Do not open near a working M2 Pro price.","message":"You listed it does not boot — that's a parts machine. $275 is where I can be.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.25,"toughness":0.6,"est_reservation_price":400,"confidence":0.4}}

---
USER (seller — they used a 256GB/8GB comp)
LISTING:
  title: MacBook Air
  tags: laptop
  sellerStatedFacts: 전원이 켜지고 정상 부팅되나요(부품용 아님)? = powers on and boots to OS; CPU/RAM/저장 사양은 어떻게 되나요? = M2 / 16GB / 512GB; 배터리 사이클 수는 얼마인가요? = about 180 cycles; 활성화 잠금(Find My Mac/iCloud, EFI/MDM 조직 잠금)이 없나요? = no activation/firmware/MDM lock, signed out
S:bargain|R2/8|seller|auto
B:t$780.00/f$650.00/c$780.00/o$560.00/g$220.00
C:rec$730.00|reciprocal_concession|opp:aggressive|conv:0.10|tp:0.30
BOX:
  Propose your COUNTER between $700.00 and $780.00.
  baseline (engine's fair aim) = $730.00.
OPP_SAID: Base Airs are $560. That's my offer.
ASSISTANT
{"action":"COUNTER","price":745.00,"reasoning":"16GB/512 and 180 cycles is not a base 8/256. Hold above baseline.","message":"Those $560 comps are 8GB/256. This is 16GB/512 with about 180 cycles — I can do $745.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.65,"est_reservation_price":620,"confidence":0.5}}

---
USER (buyer — MDM lock still on)
LISTING:
  title: ThinkPad T14
  tags: notebook
  sellerStatedFacts: 전원이 켜지고 정상 부팅되나요(부품용 아님)? = powers on and boots to OS; 활성화 잠금(Find My Mac/iCloud, EFI/MDM 조직 잠금)이 없나요? = has activation/firmware/MDM lock; 액체 손상(누수/부식) 이력이 없나요? = no liquid/spill history
STRATEGY:
  requiredCriteria: 활성화 잠금(Find My Mac/iCloud, EFI/MDM 조직 잠금)이 없나요? = no activation/firmware/MDM lock, signed out
S:bargain|R2/8|buyer|auto
B:t$420.00/f$480.00/c$410.00/o$460.00/g$50.00
BOX:
  Propose your COUNTER between $415.00 and $455.00.
  baseline (engine's fair aim) = $430.00.
OPP_SAID: It boots fine. $460.
ASSISTANT
{"action":"HOLD","reasoning":"MDM lock is on. A booting locked laptop is not a closeable personal machine.","message":"It boots, but it has an MDM lock — I can't close until that's removed.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.35,"toughness":0.55,"est_reservation_price":450,"confidence":0.5}}

---
USER (seller concede — high cycles already disclosed)
LISTING:
  title: MacBook Pro
  tags: 노트북
  sellerStatedFacts: 배터리 사이클 수는 얼마인가요? = about 920 cycles; 전원이 켜지고 정상 부팅되나요(부품용 아님)? = powers on and boots to OS; CPU/RAM/저장 사양은 어떻게 되나요? = M1 Pro / 16GB / 1TB
S:bargain|R3/8|seller|auto
B:t$900.00/f$740.00/c$880.00/o$790.00/g$90.00
C:rec$820.00|reciprocal_concession|opp:fact_based|conv:0.40|tp:0.55
BOX:
  Propose your COUNTER between $800.00 and $860.00.
  baseline (engine's fair aim) = $820.00.
OPP_SAID: 920 cycles is a battery-replacement machine. $790.
ASSISTANT
{"action":"COUNTER","price":822.00,"reasoning":"920 cycles is disclosed. Stop defending a low-cycle ask. Sit on baseline.","message":"You're right — about 920 cycles is already on the listing. $822 and we close.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.55,"toughness":0.7,"est_reservation_price":800,"confidence":0.6}}

---
# pc-parts  (tags: gpu, graphics-card, 그래픽카드)

USER (buyer — mining unknown + they want a gaming price)
LISTING:
  title: RTX 3080
  category: electronics
  tags: gpu
  sellerStatedFacts: 정확한 모델/VRAM 용량은 무엇인가요? = RTX 3080 10GB; 장기간 채굴(24/7 마이닝)에 사용된 이력이 없나요? = used for mining or unknown; 정상 출력되나요(아티팩트/사망 없음)? = posts and displays, no artifacts
S:open|R1/8|buyer|auto
B:t$220.00/f$260.00/c$0.00/o$320.00/g$100.00
C:rec$235.00|anchoring|opp:unknown|conv:0.00|tp:0.30
BOX:
  Propose your COUNTER between $210.00 and $250.00.
  baseline (engine's fair aim) = $235.00.
OPP_SAID: 3080 10GB, no artifacts. $320.
ASSISTANT
{"action":"COUNTER","price":218.00,"reasoning":"Mining history is unknown. Open under a clean-gaming 3080 baseline.","message":"It posts, but mining history is unknown — I can start at $218, not a clean gamer price.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.3,"toughness":0.55,"est_reservation_price":280,"confidence":0.4}}

---
USER (seller — they priced a 8GB card)
LISTING:
  title: RTX 4070
  tags: graphics-card
  sellerStatedFacts: 정확한 모델/VRAM 용량은 무엇인가요? = RTX 4070 12GB; 장기간 채굴(24/7 마이닝)에 사용된 이력이 없나요? = never used for mining; 전원 커넥터(12VHPWR/PCIe) 용융/탄 흔적이 없나요? = connector intact, no melting
S:bargain|R2/8|seller|auto
B:t$480.00/f$400.00/c$480.00/o$340.00/g$140.00
C:rec$450.00|anchoring|opp:aggressive|conv:0.10|tp:0.25
BOX:
  Propose your COUNTER between $430.00 and $480.00.
  baseline (engine's fair aim) = $450.00.
OPP_SAID: 4070 8GB listings are $340.
ASSISTANT
{"action":"COUNTER","price":458.00,"reasoning":"This is 12GB, never mined, connector clean. Wrong VRAM comp.","message":"Those $340 comps are 8GB. This is a 4070 12GB, never mined — I can do $458.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.25,"toughness":0.65,"est_reservation_price":390,"confidence":0.5}}

---
USER (buyer — melted connector)
LISTING:
  title: RTX 4090
  tags: 그래픽카드
  sellerStatedFacts: 전원 커넥터(12VHPWR/PCIe) 용융/탄 흔적이 없나요? = melted or burnt connector; 정상 출력되나요(아티팩트/사망 없음)? = posts and displays, no artifacts
STRATEGY:
  requiredCriteria: 전원 커넥터(12VHPWR/PCIe) 용융/탄 흔적이 없나요? = connector intact, no melting
S:bargain|R2/8|buyer|auto
B:t$900.00/f$1100.00/c$880.00/o$1200.00/g$320.00
BOX:
  Propose your COUNTER between $860.00 and $980.00.
  baseline (engine's fair aim) = $920.00.
OPP_SAID: It still displays fine. $1200.
ASSISTANT
{"action":"HOLD","reasoning":"Melted 12VHPWR is a hard fail even if it still posts. Do not chase a working-4090 price.","message":"It posts, but the power connector is melted — I can't treat this as a clean 4090 until that's resolved.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.35,"toughness":0.7,"est_reservation_price":1050,"confidence":0.55}}

---
# cameras  (tags: camera, dslr, mirrorless, 카메라)

USER (buyer — high shutter vs their ceiling)
LISTING:
  title: A7 III
  category: electronics
  tags: mirrorless
  sellerStatedFacts: 셔터 카운트(작동 횟수)는 얼마인가요? = about 148,000 actuations; 센서 상태(먼지/스크래치/데드픽셀)는 어떤가요? = light dust, no scratches; 전원이 켜지고 촬영되나요(사망 아님)? = powers on, takes photos; 도난품이 아니며 정당한 소유자인가요? = original/legitimate owner, not stolen
STRATEGY:
  preferences: 셔터 카운트(작동 횟수)는 얼마인가요? = under 50,000 actuations
S:open|R1/8|buyer|auto
B:t$620.00/f$700.00/c$0.00/o$850.00/g$230.00
C:rec$660.00|anchoring|opp:unknown|conv:0.00|tp:0.30
BOX:
  Propose your COUNTER between $600.00 and $680.00.
  baseline (engine's fair aim) = $660.00.
OPP_SAID: Body works, clean owner. $850.
ASSISTANT
{"action":"COUNTER","price":615.00,"reasoning":"148k shutter is far above my 50k preference. Open as a high-mileage body, not a low-count one.","message":"It shoots, but shutter is about 148k — I wanted under 50k. I can start at $615.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.3,"toughness":0.55,"est_reservation_price":780,"confidence":0.45}}

---
USER (seller — they used a dead-body price)
LISTING:
  title: R6
  tags: camera
  sellerStatedFacts: 전원이 켜지고 촬영되나요(사망 아님)? = powers on, takes photos; 셔터 카운트(작동 횟수)는 얼마인가요? = about 22,000 actuations; 도난품이 아니며 정당한 소유자인가요? = original/legitimate owner, not stolen
S:bargain|R2/8|seller|auto
B:t$1100.00/f$900.00/c$1100.00/o$600.00/g$500.00
C:rec$1020.00|anchoring|opp:aggressive|conv:0.05|tp:0.20
BOX:
  Propose your COUNTER between $980.00 and $1100.00.
  baseline (engine's fair aim) = $1020.00.
OPP_SAID: Parts R6s are $600.
ASSISTANT
{"action":"COUNTER","price":1040.00,"reasoning":"This powers on and shoots at 22k. Parts comps are the wrong class.","message":"Those $600 comps don't power on. This shoots, 22k shutter, clean owner — I can do $1040.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.2,"toughness":0.75,"est_reservation_price":850,"confidence":0.45}}

---
USER (buyer — provenance unknown)
LISTING:
  title: D850
  tags: dslr
  sellerStatedFacts: 도난품이 아니며 정당한 소유자인가요? = provenance unknown; 전원이 켜지고 촬영되나요(사망 아님)? = powers on, takes photos
STRATEGY:
  requiredCriteria: 도난품이 아니며 정당한 소유자인가요? = original/legitimate owner, not stolen
S:bargain|R2/8|buyer|auto
B:t$900.00/f$1000.00/c$880.00/o$980.00/g$100.00
BOX:
  Propose your COUNTER between $890.00 and $960.00.
  baseline (engine's fair aim) = $920.00.
OPP_SAID: It takes photos. $980 today.
ASSISTANT
{"action":"HOLD","reasoning":"Provenance unknown is a hard mismatch. Working shutter does not clear theft risk.","message":"It shoots, but ownership is listed as unknown — I need a clean provenance story before I close.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.45,"toughness":0.6,"est_reservation_price":960,"confidence":0.4}}

---
# cameras / lens  (tags: lens, 렌즈)

USER (seller — fungus disclosed)
LISTING:
  title: 24-70mm f/2.8
  tags: lens
  sellerStatedFacts: 렌즈 내부 곰팡이가 없나요? = fungus or haze present; 내부 헤이즈/발삼 분리(element separation)가 없나요? = haze or separation present; 마운트(EF/RF/E/Z/F 등)가 무엇인가요? = mount as described
S:bargain|R2/8|seller|auto
B:t$700.00/f$420.00/c$680.00/o$380.00/g$300.00
C:rec$520.00|reciprocal_concession|opp:fact_based|conv:0.25|tp:0.40
BOX:
  Propose your COUNTER between $480.00 and $600.00.
  baseline (engine's fair aim) = $520.00.
OPP_SAID: Fungus and haze. Optical 24-70s are not $680.
ASSISTANT
{"action":"COUNTER","price":525.00,"reasoning":"Fungus and haze are disclosed. Stop defending a clean-copy ask. Baseline.","message":"Agreed — I disclosed fungus and haze. $525, not a clean-copy price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.4,"toughness":0.7,"est_reservation_price":450,"confidence":0.55}}

---
USER (buyer — they quoted an RF price on an EF mount)
LISTING:
  title: 70-200mm
  tags: 렌즈
  sellerStatedFacts: 마운트(EF/RF/E/Z/F 등)가 무엇인가요? = Canon EF mount; 렌즈 내부 곰팡이가 없나요? = no fungus, clear elements
S:bargain|R2/8|buyer|auto
B:t$650.00/f$720.00/c$640.00/o$900.00/g$260.00
BOX:
  Propose your COUNTER between $630.00 and $700.00.
  baseline (engine's fair aim) = $670.00.
OPP_SAID: RF 70-200s go for $900. Meet me there.
ASSISTANT
{"action":"COUNTER","price":668.00,"reasoning":"Mount is EF, not RF. Do not walk toward an RF native price.","message":"That's an RF number. This is Canon EF mount — I can do $668.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.35,"toughness":0.6,"est_reservation_price":780,"confidence":0.5}}

---
# tv / monitor  (tags: tv, monitor, oled-tv, 모니터)

USER (buyer — cracked panel)
LISTING:
  title: 65" OLED
  category: electronics
  tags: oled-tv
  sellerStatedFacts: 패널에 물리적 균열이 없나요? = panel cracked/damaged; 전원이 켜지고 화면이 나오나요? = powers on, displays image; 패널/해상도(OLED/QLED, 4K/8K, 크기)는? = 65-inch OLED 4K
S:open|R1/8|buyer|auto
B:t$180.00/f$260.00/c$0.00/o$700.00/g$520.00
C:rec$200.00|anchoring|opp:unknown|conv:0.00|tp:0.20
BOX:
  Propose your COUNTER between $160.00 and $230.00.
  baseline (engine's fair aim) = $200.00.
OPP_SAID: 65" OLED 4K. $700.
ASSISTANT
{"action":"COUNTER","price":175.00,"reasoning":"Panel is cracked. Do not open near a working 65 OLED.","message":"It's a 65-inch OLED, but the panel is cracked — $175 is a parts/repair number.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.2,"toughness":0.55,"est_reservation_price":350,"confidence":0.4}}

---
USER (seller — they used an LCD 55" comp)
LISTING:
  title: 77" G3
  tags: television
  sellerStatedFacts: 패널/해상도(OLED/QLED, 4K/8K, 크기)는? = 77-inch OLED 4K; (OLED) 번인(잔상)이 없나요? = no burn-in / retention; 패널에 물리적 균열이 없나요? = panel intact, no cracks
S:bargain|R2/8|seller|auto
B:t$1400.00/f$1100.00/c$1400.00/o$700.00/g$700.00
C:rec$1280.00|anchoring|opp:aggressive|conv:0.05|tp:0.20
BOX:
  Propose your COUNTER between $1220.00 and $1400.00.
  baseline (engine's fair aim) = $1280.00.
OPP_SAID: 55" LCDs are $700.
ASSISTANT
{"action":"COUNTER","price":1310.00,"reasoning":"77 OLED with no burn-in is not a 55 LCD. Hold above baseline.","message":"Those $700 comps are 55-inch LCD. This is 77-inch OLED, no burn-in — I can do $1310.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.2,"toughness":0.7,"est_reservation_price":1000,"confidence":0.45}}

---
USER (seller concede — burn-in disclosed)
LISTING:
  title: C2 65
  tags: 티비
  sellerStatedFacts: (OLED) 번인(잔상)이 없나요? = burn-in present or not OLED; 전원이 켜지고 화면이 나오나요? = powers on, displays image; 패널/해상도(OLED/QLED, 4K/8K, 크기)는? = 65-inch OLED 4K
S:bargain|R3/8|seller|auto
B:t$650.00/f$420.00/c$620.00/o$480.00/g$140.00
C:rec$530.00|reciprocal_concession|opp:fact_based|conv:0.35|tp:0.50
BOX:
  Propose your COUNTER between $500.00 and $580.00.
  baseline (engine's fair aim) = $530.00.
OPP_SAID: You listed burn-in. Clean C2s are not $620.
ASSISTANT
{"action":"COUNTER","price":528.00,"reasoning":"Burn-in is disclosed. Come to baseline.","message":"Fair — burn-in is on the listing. $528, not a clean-panel price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.5,"toughness":0.65,"est_reservation_price":500,"confidence":0.6}}

---
# headphones  (tags: earbuds, airpods, 에어팟, 이어폰)

USER (buyer — clone / unverified)
LISTING:
  title: AirPods Pro 2
  category: electronics
  tags: airpods
  sellerStatedFacts: 정품(가품/클론 아님) 인가요? = clone or unverified; (에어팟) 이전 소유자 Find My/계정에서 해제되어 있나요? = still linked or not applicable; 양쪽 모두 충전/페어링 되나요(사망 아님)? = both buds charge and pair
STRATEGY:
  requiredCriteria: 정품(가품/클론 아님) 인가요? = genuine, serial-verifiable
S:open|R1/8|buyer|auto
B:t$40.00/f$80.00/c$0.00/o$180.00/g$140.00
BOX:
  Propose your COUNTER between $30.00 and $70.00.
  baseline (engine's fair aim) = $50.00.
OPP_SAID: They pair. $180.
ASSISTANT
{"action":"HOLD","reasoning":"Authenticity is clone/unverified. Pairing does not make them genuine AirPods.","message":"They pair, but authenticity is unverified — I can't treat these as genuine AirPods until the serial checks out.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.5,"est_reservation_price":120,"confidence":0.4}}

---
USER (seller — they priced buds-only)
LISTING:
  title: AirPods Pro
  tags: 에어팟
  sellerStatedFacts: 정품(가품/클론 아님) 인가요? = genuine, serial-verifiable; 충전 케이스가 포함되나요? = charging case included; (에어팟) 이전 소유자 Find My/계정에서 해제되어 있나요? = removed from previous Find My/account; 양쪽 모두 충전/페어링 되나요(사망 아님)? = both buds charge and pair
S:bargain|R2/8|seller|auto
B:t$160.00/f$120.00/c$160.00/o$90.00/g$70.00
C:rec$145.00|reciprocal_concession|opp:aggressive|conv:0.15|tp:0.35
BOX:
  Propose your COUNTER between $135.00 and $160.00.
  baseline (engine's fair aim) = $145.00.
OPP_SAID: Buds-only pairs are $90.
ASSISTANT
{"action":"COUNTER","price":148.00,"reasoning":"Genuine, unpaired, case included. Buds-only is the wrong bundle.","message":"Those $90 comps are buds only. This is genuine, unpaired, case included — I can do $148.","non_price_terms":{},"tactic_used":"bundling","opponent_estimate":{"time_pressure":0.35,"toughness":0.6,"est_reservation_price":120,"confidence":0.5}}

---
USER (buyer — one bud dead)
LISTING:
  title: Galaxy Buds
  tags: 이어폰
  sellerStatedFacts: 양쪽 모두 충전/페어링 되나요(사망 아님)? = one side dead or faulty; 충전 케이스가 포함되나요? = charging case included
S:bargain|R2/8|buyer|auto
B:t$35.00/f$55.00/c$32.00/o$70.00/g$38.00
BOX:
  Propose your COUNTER between $30.00 and $50.00.
  baseline (engine's fair aim) = $40.00.
OPP_SAID: Case is included. $70.
ASSISTANT
{"action":"COUNTER","price":38.00,"reasoning":"One side is dead. A case does not restore a working pair price.","message":"Case is there, but one side is dead — $38 is a single-bud/parts number.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.4,"toughness":0.55,"est_reservation_price":55,"confidence":0.5}}

---
# consoles  (tags: ps5, xbox, nintendo, 플스)

USER (buyer — banned console)
LISTING:
  title: PS5 Disc
  category: electronics
  tags: ps5
  sellerStatedFacts: 온라인 밴(PSN/Xbox/Nintendo 하드웨어 밴)이 없나요? = banned or unknown; 개조/탈옥(모드칩, MiG 등)되지 않았나요? = stock firmware, not modded; 전원이 켜지고 디스크/카트리지를 읽나요? = boots, reads discs, HDMI works; 정확한 모델/리비전(디스크/디지털, OLED/Lite 등)은? = PS5 disc edition
STRATEGY:
  requiredCriteria: 온라인 밴(PSN/Xbox/Nintendo 하드웨어 밴)이 없나요? = not banned, clean account status
S:open|R1/8|buyer|auto
B:t$220.00/f$280.00/c$0.00/o$400.00/g$180.00
BOX:
  Propose your COUNTER between $200.00 and $250.00.
  baseline (engine's fair aim) = $230.00.
OPP_SAID: Disc edition, reads games. $400.
ASSISTANT
{"action":"HOLD","reasoning":"Ban status is banned/unknown. A working disc drive does not make it a clean PSN machine.","message":"It reads discs, but ban status is unknown — I can't close on a clean-PS5 price until that's confirmed.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.55,"est_reservation_price":350,"confidence":0.4}}

---
USER (seller — they priced a digital Slim against a disc unit)
LISTING:
  title: PS5
  tags: 플스
  sellerStatedFacts: 정확한 모델/리비전(디스크/디지털, OLED/Lite 등)은? = PS5 disc edition; 개조/탈옥(모드칩, MiG 등)되지 않았나요? = stock firmware, not modded; 온라인 밴(PSN/Xbox/Nintendo 하드웨어 밴)이 없나요? = not banned, clean account status
S:bargain|R2/8|seller|auto
B:t$420.00/f$340.00/c$420.00/o$300.00/g$120.00
C:rec$390.00|reciprocal_concession|opp:aggressive|conv:0.10|tp:0.30
BOX:
  Propose your COUNTER between $370.00 and $420.00.
  baseline (engine's fair aim) = $390.00.
OPP_SAID: Digital Slims are $300.
ASSISTANT
{"action":"COUNTER","price":398.00,"reasoning":"Disc edition, stock, not banned. Digital Slim is the wrong revision.","message":"Those $300 comps are digital Slim. This is a disc edition, not banned — I can do $398.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.65,"est_reservation_price":340,"confidence":0.5}}

---
USER (seller concede — it is modded)
LISTING:
  title: Switch OLED
  tags: nintendo-switch
  sellerStatedFacts: 개조/탈옥(모드칩, MiG 등)되지 않았나요? = modded / jailbroken; 전원이 켜지고 디스크/카트리지를 읽나요? = boots, reads discs, HDMI works; 정확한 모델/리비전(디스크/디지털, OLED/Lite 등)은? = Switch OLED
S:bargain|R3/8|seller|auto
B:t$280.00/f$160.00/c$260.00/o$170.00/g$90.00
C:rec$200.00|reciprocal_concession|opp:fact_based|conv:0.35|tp:0.45
BOX:
  Propose your COUNTER between $185.00 and $230.00.
  baseline (engine's fair aim) = $200.00.
OPP_SAID: It's modded. Stock OLEDs are not $260.
ASSISTANT
{"action":"COUNTER","price":202.00,"reasoning":"Modded is disclosed. Do not defend a stock OLED ask.","message":"You're right — it's modded. $202, not a stock OLED price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.45,"toughness":0.7,"est_reservation_price":180,"confidence":0.6}}

---
# smartwatch  (tags: smartwatch, apple-watch, 워치)

USER (buyer — 41mm vs 45mm preference)
LISTING:
  title: Apple Watch
  category: electronics
  tags: apple-watch
  sellerStatedFacts: 케이스 크기/소재(41/45mm, 알루미늄/티타늄 등)는? = 41mm aluminum; 활성화 잠금(iCloud/삼성 계정)이 해제되어 있나요? = activation lock removed, signed out; 전원이 켜지고 정상 부팅되나요? = powers on and boots
STRATEGY:
  preferences: 케이스 크기/소재(41/45mm, 알루미늄/티타늄 등)는? = 45mm
S:open|R1/8|buyer|auto
B:t$140.00/f$180.00/c$0.00/o$220.00/g$80.00
BOX:
  Propose your COUNTER between $130.00 and $165.00.
  baseline (engine's fair aim) = $150.00.
OPP_SAID: Unlocked, boots. $220.
ASSISTANT
{"action":"COUNTER","price":138.00,"reasoning":"41mm aluminum against a 45mm preference. Open under baseline.","message":"It's 41mm aluminum — I was looking for 45mm. I can start at $138.","non_price_terms":{},"tactic_used":"anchoring","opponent_estimate":{"time_pressure":0.35,"toughness":0.5,"est_reservation_price":190,"confidence":0.45}}

---
USER (buyer — activation lock still on)
LISTING:
  title: Galaxy Watch
  tags: 스마트워치
  sellerStatedFacts: 활성화 잠금(iCloud/삼성 계정)이 해제되어 있나요? = activation lock still active; 전원이 켜지고 정상 부팅되나요? = powers on and boots
STRATEGY:
  requiredCriteria: 활성화 잠금(iCloud/삼성 계정)이 해제되어 있나요? = activation lock removed, signed out
S:bargain|R2/8|buyer|auto
B:t$90.00/f$120.00/c$85.00/o$110.00/g$25.00
BOX:
  Propose your COUNTER between $85.00 and $110.00.
  baseline (engine's fair aim) = $95.00.
OPP_SAID: It turns on. $110 and done.
ASSISTANT
{"action":"HOLD","reasoning":"Lock still active. A $25 gap does not clear an activation lock.","message":"It boots, but activation lock is still on — I need that signed out before I close.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.45,"toughness":0.55,"est_reservation_price":108,"confidence":0.5}}

---
# drones  (tags: drone, dji, mavic, 드론)

USER (buyer — still bound to previous DJI account)
LISTING:
  title: Mini 3
  category: electronics
  tags: dji
  sellerStatedFacts: 이전 소유자 계정 바인딩(DJI 등)이 해제되어 있나요? = still bound or unknown; 전원이 켜지고 짐벌/모터가 정상 비행되나요? = powers on, gimbal calibrates, flies; 정확한 모델/콤보(Fly More 등)는? = Mini 3 Fly More
STRATEGY:
  requiredCriteria: 이전 소유자 계정 바인딩(DJI 등)이 해제되어 있나요? = unbound from previous account
S:open|R1/8|buyer|auto
B:t$280.00/f$340.00/c$0.00/o$420.00/g$140.00
BOX:
  Propose your COUNTER between $260.00 and $310.00.
  baseline (engine's fair aim) = $285.00.
OPP_SAID: Fly More, flies fine. $420.
ASSISTANT
{"action":"HOLD","reasoning":"Still bound. A flying Fly More is not transferable until unbound.","message":"It flies, but it's still bound to a previous DJI account — I can't close until that's unbound.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.3,"toughness":0.55,"est_reservation_price":380,"confidence":0.4}}

---
USER (seller — they priced a crash airframe)
LISTING:
  title: Air 2S
  tags: mavic
  sellerStatedFacts: 추락/플라이어웨이/수몰 이력이 없나요? = no crashes or flyaways; 전원이 켜지고 짐벌/모터가 정상 비행되나요? = powers on, gimbal calibrates, flies; 정확한 모델/콤보(Fly More 등)는? = Air 2S Fly More
S:bargain|R2/8|seller|auto
B:t$620.00/f$500.00/c$620.00/o$380.00/g$240.00
C:rec$570.00|anchoring|opp:aggressive|conv:0.10|tp:0.25
BOX:
  Propose your COUNTER between $540.00 and $620.00.
  baseline (engine's fair aim) = $570.00.
OPP_SAID: Crashed Air 2S bodies are $380.
ASSISTANT
{"action":"COUNTER","price":585.00,"reasoning":"No crash history, flies, Fly More. Crash-body comps are the wrong class.","message":"Those $380 comps are crash airframes. This has no crash history and it's Fly More — I can do $585.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.25,"toughness":0.7,"est_reservation_price":480,"confidence":0.5}}

---
USER (seller concede — prior crash disclosed)
LISTING:
  title: Mini 2
  tags: 드론
  sellerStatedFacts: 추락/플라이어웨이/수몰 이력이 없나요? = prior crash / repaired; 전원이 켜지고 짐벌/모터가 정상 비행되나요? = powers on, gimbal calibrates, flies
S:bargain|R3/8|seller|auto
B:t$280.00/f$160.00/c$260.00/o$175.00/g$85.00
C:rec$210.00|reciprocal_concession|opp:fact_based|conv:0.40|tp:0.50
BOX:
  Propose your COUNTER between $190.00 and $235.00.
  baseline (engine's fair aim) = $210.00.
OPP_SAID: You listed a prior crash. Clean Minis are not $260.
ASSISTANT
{"action":"COUNTER","price":208.00,"reasoning":"Prior crash is disclosed. Come to baseline.","message":"Fair — I disclosed a prior crash. $208, not a clean-airframe price.","non_price_terms":{},"tactic_used":"condition_trade","opponent_estimate":{"time_pressure":0.5,"toughness":0.7,"est_reservation_price":185,"confidence":0.6}}
