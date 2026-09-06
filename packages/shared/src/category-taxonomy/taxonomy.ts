import type { CategoryNode, NegotiationCheck } from "./types.js";

/**
 * Seed taxonomy (thin — proves the hierarchy across a few top categories; more
 * categories/checks are added incrementally). Top level aligns with
 * LISTING_CATEGORIES. featureKey values must match FEATURE_SCHEMA keys.
 */
export const CATEGORY_TAXONOMY: readonly CategoryNode[] = [
  {
    path: "electronics",
    checks: [
      {
        id: "working_status",
        questionKo: "정상 작동하나요? 결함이 있나요?",
        buyerAskKo: "Should the agent only consider fully working units?",
        enforcement: "soft",
      },
      {
        id: "cosmetic_grade",
        questionKo: "외관 상태(등급)는 어떤가요?",
        buyerAskKo: "What cosmetic condition are you comfortable with?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/phones",
    checks: [
      {
        // Shared blacklist/theft gate for ALL phones (iPhone, Galaxy, Pixel) — moved up
        // from the iphone node so Android inherits it too. IMEI/ESN reported lost/stolen/
        // financed → blocklisted on the GSMA registry, unusable on any carrier.
        id: "imei_verification",
        questionKo: "IMEI가 깨끗한지(블랙리스트 아님) 확인 가능한가요?",
        buyerAskKo: "Should the agent require a clean IMEI (not lost/blacklisted) before closing?",
        featureKey: "imei_verification",
        enforcement: "hard",
        // Topic-specific only. Generic condition words (정상/깨끗/이력/clean) were removed
        // — they matched unrelated "works normally / clean exterior / no repair history".
        answerHints: ["imei", "블랙리스트", "blacklist", "분실", "도난", "장물", "esn"],
        answerOptions: [
          {
            label: "Require clean IMEI",
            stance: "clean IMEI required — not lost or blacklisted",
            requirement: "required",
          },
          { label: "Not required", stance: "no IMEI preference", requirement: "optional" },
        ],
        sellerAsk: "IMEI / blacklist status?",
        sellerOptions: [
          {
            label: "Clean & verifiable",
            stance: "clean IMEI, not blacklisted, verifiable",
            requirement: "required",
          },
          { label: "Can't verify", stance: "IMEI not verified", requirement: "required" },
        ],
      },
      {
        // A financed phone (unpaid carrier installment/EIP) can be blocklisted AFTER sale.
        id: "financing_paid_off",
        questionKo: "할부(약정)가 완납되어 블랙리스트 위험이 없나요?",
        buyerAskKo: "Should the agent require the phone be fully paid off (no carrier financing)?",
        enforcement: "hard",
        answerHints: ["할부", "약정", "financed", "installment", "eip", "미납", "잔액"],
        answerOptions: [
          {
            label: "Must be paid off",
            stance: "fully paid off — no outstanding carrier financing",
            requirement: "required",
          },
          { label: "Not required", stance: "no financing preference", requirement: "optional" },
        ],
        sellerAsk: "Carrier financing?",
        sellerOptions: [
          { label: "Paid off", stance: "fully paid off, no balance", requirement: "required" },
          {
            label: "Still financed",
            stance: "still under carrier installment",
            requirement: "required",
          },
        ],
      },
      {
        id: "water_damage",
        questionKo: "침수(액체 감지 표시)가 없는 상태인가요?",
        buyerAskKo: "Should the agent require no liquid/water damage (LCI not tripped)?",
        enforcement: "hard",
        answerHints: ["침수", "물", "water damage", "liquid", "lci", "corrosion", "습기"],
        answerOptions: [
          {
            label: "No water damage",
            stance: "no liquid/water damage — LCI not tripped",
            requirement: "required",
          },
          { label: "Not required", stance: "no water-damage preference", requirement: "optional" },
        ],
        sellerAsk: "Water damage?",
        sellerOptions: [
          { label: "None", stance: "no liquid damage, LCI clean", requirement: "required" },
          { label: "Has/unknown", stance: "possible liquid exposure", requirement: "required" },
        ],
      },
      {
        id: "battery_health",
        questionKo: "배터리 성능(%)은 얼마인가요?",
        buyerAskKo: "What minimum battery health do you want?",
        featureKey: "battery_health",
        enforcement: "soft",
        answerOptions: [
          { label: "90%+", stance: "battery health 90% or higher", requirement: "optional" },
          { label: "80%+", stance: "battery health 80% or higher", requirement: "optional" },
          { label: "Any", stance: "no battery-health minimum", requirement: "optional" },
        ],
        sellerAsk: "Battery health?",
        sellerOptions: [
          { label: "90%+", stance: "battery health 90% or higher", requirement: "optional" },
          {
            label: "80–89%",
            stance: "battery health between 80% and 89%",
            requirement: "optional",
          },
          { label: "Below 80%", stance: "battery health below 80%", requirement: "optional" },
          { label: "Not checked", stance: "battery health not checked", requirement: "optional" },
        ],
      },
      {
        id: "carrier_lock",
        questionKo: "통신사 언락 상태인가요?",
        buyerAskKo: "Is an unlocked model required?",
        featureKey: "carrier_lock",
        enforcement: "soft",
        answerOptions: [
          { label: "Unlocked only", stance: "carrier-unlocked required", requirement: "optional" },
          { label: "Any", stance: "carrier lock acceptable", requirement: "optional" },
        ],
        sellerAsk: "Carrier lock status?",
        sellerOptions: [
          { label: "Unlocked", stance: "carrier-unlocked", requirement: "optional" },
          { label: "Locked to carrier", stance: "locked to a carrier", requirement: "optional" },
        ],
      },
      {
        id: "storage_capacity",
        questionKo: "저장 용량은 얼마인가요?",
        buyerAskKo: "What storage capacity do you want?",
        featureKey: "storage_capacity",
        enforcement: "soft",
        answerOptions: [
          { label: "128GB+", stance: "at least 128GB", requirement: "optional" },
          { label: "256GB+", stance: "at least 256GB", requirement: "optional" },
          { label: "512GB+", stance: "at least 512GB", requirement: "optional" },
          { label: "Any", stance: "no storage minimum", requirement: "optional" },
        ],
        // Capacities are discrete, so the seller states the exact one — no bucketing loss.
        sellerAsk: "Storage capacity?",
        sellerOptions: [
          { label: "128GB", stance: "128GB storage", requirement: "optional" },
          { label: "256GB", stance: "256GB storage", requirement: "optional" },
          { label: "512GB", stance: "512GB storage", requirement: "optional" },
          { label: "1TB+", stance: "1TB or larger storage", requirement: "optional" },
        ],
      },
    ],
  },
  {
    path: "electronics/phones/iphone",
    aliases: ["iphone", "아이폰"],
    checks: [
      {
        id: "find_my_status",
        questionKo: "Find My(활성화 잠금)가 해제되어 있나요?",
        buyerAskKo: "Should the agent require Find My / activation lock to be off before closing?",
        featureKey: "find_my_status",
        enforcement: "hard",
        // Topic-specific only. Bare "해제" removed — it collided with carrier "잠금 해제".
        answerHints: [
          "find my",
          "파인드마이",
          "icloud",
          "아이클라우드",
          "활성화 잠금",
          "activation lock",
          "나의 찾기",
        ],
        answerOptions: [
          {
            label: "Require Find My off",
            stance: "Find My / activation lock must be off before closing",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no activation-lock preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Find My / activation lock?",
        sellerOptions: [
          {
            label: "Off / deactivated",
            stance: "Find My / activation lock is off",
            requirement: "required",
          },
          {
            label: "Still on",
            stance: "Find My / activation lock still active",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "electronics/phones/samsung",
    aliases: ["samsung", "galaxy", "삼성", "갤럭시"],
    checks: [
      {
        id: "google_frp_lock",
        questionKo: "Google 계정 잠금(FRP)이 해제되어 있나요?",
        buyerAskKo: "Should the agent require Google FRP (factory reset protection) to be removed?",
        enforcement: "hard",
        answerHints: [
          "frp",
          "factory reset protection",
          "google 계정",
          "google account",
          "구글 잠금",
        ],
        answerOptions: [
          {
            label: "Require FRP removed",
            stance: "Google FRP must be removed",
            requirement: "required",
          },
          { label: "Not required", stance: "no FRP preference", requirement: "optional" },
        ],
        sellerAsk: "Google FRP status?",
        sellerOptions: [
          {
            label: "Removed",
            stance: "FRP removed, Google account signed out",
            requirement: "required",
          },
          {
            label: "Still active",
            stance: "FRP / Google account still active",
            requirement: "required",
          },
        ],
      },
      {
        id: "samsung_reactivation_lock",
        questionKo: "삼성 계정(Find My Mobile 재활성화 잠금)이 해제되어 있나요?",
        buyerAskKo: "Should the agent require the Samsung reactivation lock to be off?",
        enforcement: "hard",
        answerHints: [
          "reactivation lock",
          "find my mobile",
          "삼성 계정",
          "samsung account",
          "재활성화",
        ],
        answerOptions: [
          {
            label: "Require it off",
            stance: "Samsung reactivation lock must be off",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no reactivation-lock preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Samsung reactivation lock?",
        sellerOptions: [
          {
            label: "Off",
            stance: "reactivation lock off, Samsung account cleared",
            requirement: "required",
          },
          { label: "Still on", stance: "reactivation lock still active", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "electronics/phones/pixel",
    // Bare "pixel" is an inference stopword ("no dead pixel" appears in monitor/TV/laptop
    // listings), so Pixel phones are reached through unambiguous multi-word forms
    // ("google-pixel", "pixel-phone", "pixel 8"/"pixel-8", …). Keep bare "pixel" as an
    // alias for exact/model-child tag matching; matchedCategoryPaths treats it as an
    // ambiguous token so "dead-pixel" does not open phone gates.
    aliases: [
      "pixel",
      "google-pixel",
      "pixel-phone",
      "pixel-8",
      "pixel-9",
      "pixel-7",
      "pixel-6",
      "pixel 8",
      "pixel 9",
      "pixel 7",
      "pixel 6",
      "구글 픽셀",
      "픽셀폰",
    ],
    checks: [
      {
        id: "google_frp_lock",
        questionKo: "Google 계정 잠금(FRP)이 해제되어 있나요?",
        buyerAskKo: "Should the agent require Google FRP (factory reset protection) to be removed?",
        enforcement: "hard",
        answerHints: [
          "frp",
          "factory reset protection",
          "google 계정",
          "google account",
          "구글 잠금",
        ],
        answerOptions: [
          {
            label: "Require FRP removed",
            stance: "Google FRP must be removed",
            requirement: "required",
          },
          { label: "Not required", stance: "no FRP preference", requirement: "optional" },
        ],
        sellerAsk: "Google FRP status?",
        sellerOptions: [
          {
            label: "Removed",
            stance: "FRP removed, Google account signed out",
            requirement: "required",
          },
          {
            label: "Still active",
            stance: "FRP / Google account still active",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "electronics/tablets",
    aliases: ["tablet", "ipad", "아이패드", "galaxy-tab", "태블릿"],
    checks: [
      {
        id: "activation_lock",
        questionKo: "활성화 잠금(iCloud/계정)이 해제되어 있나요?",
        buyerAskKo: "Should the agent require the activation lock (iCloud/account) to be removed?",
        enforcement: "hard",
        answerHints: ["activation lock", "icloud", "find my", "활성화 잠금", "아이클라우드", "frp"],
        answerOptions: [
          {
            label: "Require it removed",
            stance: "activation lock must be removed",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no activation-lock preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Activation lock?",
        sellerOptions: [
          {
            label: "Removed",
            stance: "activation lock removed, signed out",
            requirement: "required",
          },
          { label: "Still on", stance: "activation lock still active", requirement: "required" },
        ],
      },
      {
        id: "screen_condition",
        questionKo: "화면 상태(균열/데드픽셀/터치)는 어떤가요?",
        buyerAskKo: "What screen condition is acceptable (cracks / dead pixels / touch)?",
        enforcement: "soft",
        answerOptions: [
          { label: "Mint", stance: "mint screen, no marks", requirement: "optional" },
          {
            label: "Minor scratches OK",
            stance: "minor scratches acceptable",
            requirement: "optional",
          },
          { label: "Any", stance: "no screen-condition preference", requirement: "optional" },
        ],
        sellerAsk: "Screen condition?",
        sellerOptions: [
          { label: "Mint", stance: "mint screen, no marks", requirement: "optional" },
          {
            label: "Minor scratches",
            stance: "screen has minor scratches",
            requirement: "optional",
          },
          {
            label: "Cracked / dead pixels",
            stance: "screen cracked or has dead pixels",
            requirement: "optional",
          },
        ],
      },
      {
        id: "connectivity_type",
        questionKo: "Wi-Fi 전용인가요, 셀룰러 모델인가요?",
        buyerAskKo: "Wi-Fi only or cellular?",
        enforcement: "soft",
        answerOptions: [
          { label: "Wi-Fi only", stance: "Wi-Fi only", requirement: "optional" },
          { label: "Cellular", stance: "Wi-Fi + Cellular", requirement: "optional" },
          { label: "Either", stance: "no connectivity preference", requirement: "optional" },
        ],
        sellerAsk: "Wi-Fi or cellular?",
        sellerOptions: [
          { label: "Wi-Fi only", stance: "Wi-Fi only model", requirement: "optional" },
          { label: "Cellular", stance: "Wi-Fi + Cellular model", requirement: "optional" },
        ],
      },
    ],
  },
  {
    path: "electronics/laptops",
    aliases: ["laptop", "macbook", "notebook", "노트북"],
    checks: [
      {
        id: "boots_ok",
        questionKo: "전원이 켜지고 정상 부팅되나요(부품용 아님)?",
        buyerAskKo:
          "Should the agent require the laptop to power on and boot (not a dead/for-parts unit)?",
        enforcement: "hard",
        answerHints: ["부팅", "boots", "won't turn on", "안 켜짐", "dead", "for parts", "부품용"],
        answerOptions: [
          { label: "Must boot", stance: "must power on and boot to OS", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / not booting acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Powers on & boots?",
        sellerOptions: [
          { label: "Boots fine", stance: "powers on and boots to OS", requirement: "required" },
          {
            label: "No boot / parts",
            stance: "does not boot — for parts",
            requirement: "required",
          },
        ],
      },
      {
        id: "activation_lock",
        questionKo: "활성화 잠금(Find My Mac/iCloud, EFI/MDM 조직 잠금)이 없나요?",
        buyerAskKo:
          "Should the agent require no activation/firmware/MDM lock (Find My Mac, EFI, org enrollment)?",
        enforcement: "hard",
        answerHints: [
          "activation lock",
          "find my mac",
          "icloud",
          "efi",
          "firmware password",
          "mdm",
          "intune",
          "조직 잠금",
        ],
        answerOptions: [
          {
            label: "Require no lock",
            stance: "no activation / firmware / MDM lock",
            requirement: "required",
          },
          { label: "Not required", stance: "no lock preference", requirement: "optional" },
        ],
        sellerAsk: "Account / firmware / MDM lock?",
        sellerOptions: [
          {
            label: "None (signed out)",
            stance: "no activation/firmware/MDM lock, signed out",
            requirement: "required",
          },
          {
            label: "Locked / org-enrolled",
            stance: "has activation/firmware/MDM lock",
            requirement: "required",
          },
        ],
      },
      {
        id: "liquid_damage",
        questionKo: "액체 손상(누수/부식) 이력이 없나요?",
        buyerAskKo: "Should the agent require no liquid/spill damage?",
        enforcement: "hard",
        answerHints: ["액체", "누수", "liquid damage", "spill", "corrosion", "부식", "물"],
        answerOptions: [
          { label: "No liquid damage", stance: "no liquid/spill damage", requirement: "required" },
          { label: "Not required", stance: "no liquid-damage preference", requirement: "optional" },
        ],
        sellerAsk: "Liquid damage?",
        sellerOptions: [
          { label: "None", stance: "no liquid/spill history", requirement: "required" },
          { label: "Has/unknown", stance: "possible liquid exposure", requirement: "required" },
        ],
      },
      {
        id: "battery_cycles",
        questionKo: "배터리 사이클 수는 얼마인가요?",
        buyerAskKo: "Any maximum battery cycle count you want?",
        enforcement: "soft",
      },
      {
        id: "spec_summary",
        questionKo: "CPU/RAM/저장 사양은 어떻게 되나요?",
        buyerAskKo: "Any required CPU/RAM/storage specs?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/pc-parts",
    aliases: ["gpu", "graphics-card", "그래픽카드", "cpu", "pc-parts", "video-card"],
    checks: [
      {
        id: "gpu_mining_history",
        questionKo: "장기간 채굴(24/7 마이닝)에 사용된 이력이 없나요?",
        buyerAskKo:
          "Should the agent require no crypto-mining history (24/7 use degrades the card)?",
        enforcement: "hard",
        answerHints: ["채굴", "마이닝", "mining", "mined", "crypto", "24/7", "hash", "farm"],
        answerOptions: [
          { label: "No mining", stance: "no crypto-mining history", requirement: "required" },
          { label: "Not required", stance: "mining history acceptable", requirement: "optional" },
        ],
        sellerAsk: "Mining history?",
        sellerOptions: [
          { label: "Never mined", stance: "never used for mining", requirement: "required" },
          {
            label: "Mined / unknown",
            stance: "used for mining or unknown",
            requirement: "required",
          },
        ],
      },
      {
        id: "gpu_works",
        questionKo: "정상 출력되나요(아티팩트/사망 없음)?",
        buyerAskKo: "Should the agent require the card to post and display without artifacts?",
        enforcement: "hard",
        answerHints: ["아티팩트", "artifact", "no display", "출력 안됨", "dead", "doa", "먹통"],
        answerOptions: [
          { label: "Must work", stance: "must post and display cleanly", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / artifacting acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Works / displays?",
        sellerOptions: [
          {
            label: "Works cleanly",
            stance: "posts and displays, no artifacts",
            requirement: "required",
          },
          {
            label: "Artifacts / dead",
            stance: "artifacting or no display",
            requirement: "required",
          },
        ],
      },
      {
        id: "power_connector_burnt",
        questionKo: "전원 커넥터(12VHPWR/PCIe) 용융/탄 흔적이 없나요?",
        buyerAskKo: "Should the agent require no melted/burnt power connector?",
        enforcement: "hard",
        answerHints: ["용융", "탄", "melted", "burnt", "12vhpwr", "connector", "scorched"],
        answerOptions: [
          {
            label: "No burn damage",
            stance: "power connector intact, no melting",
            requirement: "required",
          },
          { label: "Not required", stance: "no connector preference", requirement: "optional" },
        ],
        sellerAsk: "Power connector?",
        sellerOptions: [
          { label: "Intact", stance: "connector intact, no melting", requirement: "required" },
          { label: "Burnt/melted", stance: "melted or burnt connector", requirement: "required" },
        ],
      },
      {
        id: "gpu_model_vram",
        questionKo: "정확한 모델/VRAM 용량은 무엇인가요?",
        buyerAskKo: "Any required GPU model / VRAM?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/cameras",
    aliases: ["camera", "dslr", "mirrorless", "카메라", "미러리스"],
    checks: [
      {
        id: "stolen_provenance",
        questionKo: "도난품이 아니며 정당한 소유자인가요?",
        buyerAskKo: "Should the agent require proof the camera is not stolen (legitimate owner)?",
        enforcement: "hard",
        answerHints: ["도난", "stolen", "serial reported", "lenstag", "장물", "정당한 소유"],
        answerOptions: [
          {
            label: "Require proof",
            stance: "legitimate owner, not reported stolen",
            requirement: "required",
          },
          { label: "Not required", stance: "no provenance preference", requirement: "optional" },
        ],
        sellerAsk: "Ownership / theft?",
        sellerOptions: [
          {
            label: "Legit owner",
            stance: "original/legitimate owner, not stolen",
            requirement: "required",
          },
          { label: "Unknown", stance: "provenance unknown", requirement: "required" },
        ],
      },
      {
        id: "powers_on_shoots",
        questionKo: "전원이 켜지고 촬영되나요(사망 아님)?",
        buyerAskKo: "Should the agent require the body to power on and take a photo?",
        enforcement: "hard",
        answerHints: ["작동", "촬영", "powers on", "shoots", "dead", "doa", "먹통", "for parts"],
        answerOptions: [
          { label: "Must work", stance: "powers on and shoots", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / not working acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Powers on & shoots?",
        sellerOptions: [
          { label: "Works", stance: "powers on, takes photos", requirement: "required" },
          {
            label: "Dead / parts",
            stance: "does not power on — for parts",
            requirement: "required",
          },
        ],
      },
      {
        id: "shutter_count",
        questionKo: "셔터 카운트(작동 횟수)는 얼마인가요?",
        buyerAskKo: "Any maximum shutter count?",
        enforcement: "soft",
      },
      {
        id: "sensor_condition",
        questionKo: "센서 상태(먼지/스크래치/데드픽셀)는 어떤가요?",
        buyerAskKo: "What sensor condition is acceptable?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/cameras/lens",
    aliases: ["lens", "lenses", "렌즈"],
    checks: [
      {
        id: "lens_fungus",
        questionKo: "렌즈 내부 곰팡이가 없나요?",
        buyerAskKo: "Should the agent require no internal fungus?",
        enforcement: "hard",
        answerHints: ["곰팡이", "fungus", "mold", "haze", "거미줄", "곰팡이 흔적"],
        answerOptions: [
          { label: "No fungus", stance: "no internal fungus", requirement: "required" },
          { label: "Not required", stance: "no fungus preference", requirement: "optional" },
        ],
        sellerAsk: "Internal fungus?",
        sellerOptions: [
          { label: "None", stance: "no fungus, clear elements", requirement: "required" },
          { label: "Has fungus/haze", stance: "fungus or haze present", requirement: "required" },
        ],
      },
      {
        id: "lens_haze_separation",
        questionKo: "내부 헤이즈/발삼 분리(element separation)가 없나요?",
        buyerAskKo: "Should the agent require no haze / element separation?",
        enforcement: "hard",
        answerHints: ["헤이즈", "haze", "separation", "발삼", "분리", "oil"],
        answerOptions: [
          {
            label: "Clear glass",
            stance: "no haze or element separation",
            requirement: "required",
          },
          { label: "Not required", stance: "no haze preference", requirement: "optional" },
        ],
        sellerAsk: "Haze / separation?",
        sellerOptions: [
          { label: "Clear", stance: "clear, no haze/separation", requirement: "required" },
          { label: "Has haze", stance: "haze or separation present", requirement: "required" },
        ],
      },
      {
        id: "mount_compatibility",
        questionKo: "마운트(EF/RF/E/Z/F 등)가 무엇인가요?",
        buyerAskKo: "Which lens mount do you need (EF/RF/E/Z/F/MFT)?",
        enforcement: "hard",
        // Anchored — bare "ef"/"rf" matched prefer/chef/surf/before.
        answerHints: [
          "마운트",
          "mount",
          "e-mount",
          "z-mount",
          "f-mount",
          "ef mount",
          "rf mount",
          "mft",
        ],
        answerOptions: [
          {
            label: "Must match my mount",
            stance: "must match my camera's mount",
            requirement: "required",
          },
          { label: "Any", stance: "no mount preference", requirement: "optional" },
        ],
        sellerAsk: "Lens mount?",
        sellerOptions: [
          { label: "State mount", stance: "mount as described", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "electronics/tv",
    // Monitors share every check here (cracked panel, powers-on/image, OLED burn-in,
    // panel spec) and are high-volume, so they resolve to this node too.
    aliases: [
      "tv",
      "television",
      "oled-tv",
      "qled",
      "monitor",
      "monitors",
      "gaming-monitor",
      "텔레비전",
      "티비",
      "모니터",
    ],
    checks: [
      {
        id: "panel_cracked",
        questionKo: "패널에 물리적 균열이 없나요?",
        buyerAskKo: "Should the agent require an intact (uncracked) panel?",
        enforcement: "hard",
        answerHints: ["균열", "cracked", "shattered", "깨짐", "spider crack", "패널 손상"],
        answerOptions: [
          {
            label: "Intact only",
            stance: "panel must be intact, not cracked",
            requirement: "required",
          },
          { label: "Not required", stance: "no panel-crack preference", requirement: "optional" },
        ],
        sellerAsk: "Panel intact?",
        sellerOptions: [
          { label: "Intact", stance: "panel intact, no cracks", requirement: "required" },
          { label: "Cracked", stance: "panel cracked/damaged", requirement: "required" },
        ],
      },
      {
        id: "powers_on_image",
        questionKo: "전원이 켜지고 화면이 나오나요?",
        buyerAskKo: "Should the agent require it to power on and display an image?",
        enforcement: "hard",
        answerHints: [
          "화면 나옴",
          "powers on",
          "no picture",
          "안 켜짐",
          "dead",
          "no image",
          "먹통",
        ],
        answerOptions: [
          {
            label: "Must work",
            stance: "powers on and displays an image",
            requirement: "required",
          },
          {
            label: "For-parts OK",
            stance: "for-parts / no image acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Powers on & displays?",
        sellerOptions: [
          { label: "Works", stance: "powers on, displays image", requirement: "required" },
          { label: "Dead / parts", stance: "no image — for parts", requirement: "required" },
        ],
      },
      {
        id: "oled_burn_in",
        questionKo: "(OLED) 번인(잔상)이 없나요?",
        buyerAskKo: "For OLED — should the agent require no burn-in / image retention?",
        enforcement: "hard",
        answerHints: ["번인", "burn-in", "image retention", "잔상", "ghosting", "logo ghost"],
        answerOptions: [
          { label: "No burn-in", stance: "no OLED burn-in / retention", requirement: "required" },
          { label: "Not required", stance: "no burn-in preference", requirement: "optional" },
        ],
        sellerAsk: "OLED burn-in?",
        sellerOptions: [
          { label: "None", stance: "no burn-in / retention", requirement: "required" },
          {
            label: "Has burn-in / N-A",
            stance: "burn-in present or not OLED",
            requirement: "required",
          },
        ],
      },
      {
        id: "panel_spec",
        questionKo: "패널/해상도(OLED/QLED, 4K/8K, 크기)는?",
        buyerAskKo: "Any required panel type / size / resolution?",
        enforcement: "soft",
      },
    ],
  },
  {
    // Leaf "headphones" (not "audio") — "audio" collides with audio-cable/audio-interface.
    path: "electronics/headphones",
    aliases: ["earbuds", "airpods", "이어폰", "헤드폰", "에어팟"],
    checks: [
      {
        id: "counterfeit_authenticity",
        questionKo: "정품(가품/클론 아님) 인가요?",
        buyerAskKo: "Should the agent require genuine (not a clone/fake) unit?",
        enforcement: "hard",
        answerHints: ["가품", "클론", "fake", "clone", "replica", "counterfeit", "짝퉁", "정품"],
        answerOptions: [
          { label: "Genuine only", stance: "genuine only, no clones", requirement: "required" },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Genuine / clone?",
        sellerOptions: [
          { label: "Genuine", stance: "genuine, serial-verifiable", requirement: "required" },
          { label: "Clone / unknown", stance: "clone or unverified", requirement: "required" },
        ],
      },
      {
        id: "find_my_unpaired",
        questionKo: "(에어팟) 이전 소유자 Find My/계정에서 해제되어 있나요?",
        buyerAskKo:
          "For AirPods — should the agent require them removed from the prior owner's Find My?",
        enforcement: "hard",
        answerHints: ["find my", "icloud", "이전 소유자", "unpair", "해제", "previous owner"],
        answerOptions: [
          {
            label: "Require unpaired",
            stance: "removed from prior owner's Find My",
            requirement: "required",
          },
          { label: "Not required", stance: "no Find My preference", requirement: "optional" },
        ],
        sellerAsk: "Removed from Find My?",
        sellerOptions: [
          {
            label: "Removed",
            stance: "removed from previous Find My/account",
            requirement: "required",
          },
          {
            label: "Still linked / N-A",
            stance: "still linked or not applicable",
            requirement: "required",
          },
        ],
      },
      {
        id: "powers_pairs",
        questionKo: "양쪽 모두 충전/페어링 되나요(사망 아님)?",
        buyerAskKo: "Should the agent require both sides to power, charge, and pair?",
        enforcement: "hard",
        answerHints: [
          "페어링",
          "충전 안됨",
          "한쪽 사망",
          "won't charge",
          "one side dead",
          "not pairing",
        ],
        answerOptions: [
          { label: "Must work", stance: "both sides charge and pair", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "one side dead / for-parts acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Both sides work?",
        sellerOptions: [
          { label: "Both work", stance: "both buds charge and pair", requirement: "required" },
          {
            label: "One dead / faulty",
            stance: "one side dead or faulty",
            requirement: "required",
          },
        ],
      },
      {
        id: "case_included",
        questionKo: "충전 케이스가 포함되나요?",
        buyerAskKo: "Any requirement on the charging case being included?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/consoles",
    // No bare "console" (console-table/center-console) or "switch" (network/light switch).
    aliases: ["ps5", "playstation", "xbox", "nintendo", "nintendo-switch", "콘솔", "플스"],
    checks: [
      {
        id: "console_ban_status",
        questionKo: "온라인 밴(PSN/Xbox/Nintendo 하드웨어 밴)이 없나요?",
        buyerAskKo: "Should the agent require the console not be online/hardware-banned?",
        enforcement: "hard",
        answerHints: ["밴", "ban", "banned", "psn ban", "xbox ban", "nintendo ban", "정지"],
        answerOptions: [
          {
            label: "Require not banned",
            stance: "not online/hardware banned",
            requirement: "required",
          },
          { label: "Not required", stance: "no ban-status preference", requirement: "optional" },
        ],
        sellerAsk: "Online / hardware ban?",
        sellerOptions: [
          {
            label: "Not banned",
            stance: "not banned, clean account status",
            requirement: "required",
          },
          { label: "Banned / unknown", stance: "banned or unknown", requirement: "required" },
        ],
      },
      {
        id: "modchip_piracy_flag",
        questionKo: "개조/탈옥(모드칩, MiG 등)되지 않았나요?",
        buyerAskKo: "Should the agent require a stock (not modded/jailbroken) console?",
        enforcement: "hard",
        answerHints: ["개조", "탈옥", "modded", "jailbreak", "modchip", "mig", "cfw", "piracy"],
        answerOptions: [
          { label: "Stock only", stance: "stock, not modded/jailbroken", requirement: "required" },
          { label: "Not required", stance: "no mod-status preference", requirement: "optional" },
        ],
        sellerAsk: "Modded / stock?",
        sellerOptions: [
          { label: "Stock", stance: "stock firmware, not modded", requirement: "required" },
          { label: "Modded", stance: "modded / jailbroken", requirement: "required" },
        ],
      },
      {
        id: "powers_reads_disc",
        questionKo: "전원이 켜지고 디스크/카트리지를 읽나요?",
        buyerAskKo: "Should the agent require it to boot and read discs/cartridges?",
        enforcement: "hard",
        answerHints: ["부팅", "디스크", "powers on", "disc drive", "hdmi", "안 켜짐", "먹통"],
        answerOptions: [
          { label: "Must work", stance: "boots and reads discs/carts", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / faulty acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Boots & reads media?",
        sellerOptions: [
          { label: "Works", stance: "boots, reads discs, HDMI works", requirement: "required" },
          {
            label: "Faulty / parts",
            stance: "boot/disc/HDMI fault — for parts",
            requirement: "required",
          },
        ],
      },
      {
        id: "model_revision",
        questionKo: "정확한 모델/리비전(디스크/디지털, OLED/Lite 등)은?",
        buyerAskKo: "Any required model/revision (disc vs digital, Slim/Pro, OLED/Lite)?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/smartwatch",
    aliases: ["smartwatch", "apple-watch", "galaxy-watch", "워치", "스마트워치"],
    checks: [
      {
        id: "activation_lock",
        questionKo: "활성화 잠금(iCloud/삼성 계정)이 해제되어 있나요?",
        buyerAskKo:
          "Should the agent require the activation lock removed (iCloud / Samsung account)?",
        enforcement: "hard",
        answerHints: [
          "activation lock",
          "icloud",
          "find my",
          "활성화 잠금",
          "samsung account",
          "삼성 계정",
        ],
        answerOptions: [
          {
            label: "Require it removed",
            stance: "activation lock removed",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no activation-lock preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Activation lock?",
        sellerOptions: [
          {
            label: "Removed",
            stance: "activation lock removed, signed out",
            requirement: "required",
          },
          { label: "Still on", stance: "activation lock still active", requirement: "required" },
        ],
      },
      {
        id: "powers_on",
        questionKo: "전원이 켜지고 정상 부팅되나요?",
        buyerAskKo: "Should the agent require it to power on (not dead/boot-loop)?",
        enforcement: "hard",
        answerHints: ["부팅", "powers on", "boot loop", "안 켜짐", "dead", "먹통"],
        answerOptions: [
          { label: "Must power on", stance: "powers on and boots", requirement: "required" },
          { label: "For-parts OK", stance: "for-parts / dead acceptable", requirement: "optional" },
        ],
        sellerAsk: "Powers on?",
        sellerOptions: [
          { label: "Works", stance: "powers on and boots", requirement: "required" },
          {
            label: "Dead / parts",
            stance: "dead / boot-loop — for parts",
            requirement: "required",
          },
        ],
      },
      {
        id: "case_size_material",
        questionKo: "케이스 크기/소재(41/45mm, 알루미늄/티타늄 등)는?",
        buyerAskKo: "Any required case size / material?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "electronics/drones",
    aliases: ["drone", "dji", "mavic", "드론"],
    checks: [
      {
        id: "account_binding_unbound",
        questionKo: "이전 소유자 계정 바인딩(DJI 등)이 해제되어 있나요?",
        buyerAskKo: "Should the agent require the drone unbound from the prior owner's account?",
        enforcement: "hard",
        answerHints: ["바인딩", "binding", "bound", "unbind", "dji account", "계정", "해제"],
        answerOptions: [
          {
            label: "Require unbound",
            stance: "unbound from previous owner's account",
            requirement: "required",
          },
          { label: "Not required", stance: "no binding preference", requirement: "optional" },
        ],
        sellerAsk: "Account binding?",
        sellerOptions: [
          { label: "Unbound", stance: "unbound from previous account", requirement: "required" },
          { label: "Bound / unknown", stance: "still bound or unknown", requirement: "required" },
        ],
      },
      {
        id: "crash_flyaway_history",
        questionKo: "추락/플라이어웨이/수몰 이력이 없나요?",
        buyerAskKo: "Should the agent require no crash / flyaway / water-landing history?",
        enforcement: "hard",
        answerHints: ["추락", "crash", "flyaway", "수몰", "water landing", "hard landing", "사고"],
        answerOptions: [
          {
            label: "No crash history",
            stance: "no crash/flyaway/water history",
            requirement: "required",
          },
          { label: "Not required", stance: "no crash-history preference", requirement: "optional" },
        ],
        sellerAsk: "Crash history?",
        sellerOptions: [
          { label: "None", stance: "no crashes or flyaways", requirement: "required" },
          {
            label: "Crashed / repaired",
            stance: "prior crash / repaired",
            requirement: "required",
          },
        ],
      },
      {
        id: "powers_flies",
        questionKo: "전원이 켜지고 짐벌/모터가 정상 비행되나요?",
        buyerAskKo: "Should the agent require it to power on and fly (gimbal/motors OK)?",
        enforcement: "hard",
        answerHints: ["비행", "짐벌", "powers on", "gimbal", "motor", "안 켜짐", "먹통"],
        answerOptions: [
          { label: "Must fly", stance: "powers on and flies, gimbal OK", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / not flying acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Powers on & flies?",
        sellerOptions: [
          {
            label: "Flies",
            stance: "powers on, gimbal calibrates, flies",
            requirement: "required",
          },
          {
            label: "Faulty / parts",
            stance: "gimbal/motor fault — for parts",
            requirement: "required",
          },
        ],
      },
      {
        id: "model_variant",
        questionKo: "정확한 모델/콤보(Fly More 등)는?",
        buyerAskKo: "Any required model / combo?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "clothing",
    aliases: ["fashion", "패션", "의류"],
    checks: [
      {
        id: "size",
        questionKo: "사이즈는 무엇인가요?",
        buyerAskKo: "What size are you looking for?",
        enforcement: "soft",
      },
      {
        id: "authenticity",
        questionKo: "정품 인증(택/영수증 등)이 가능한가요?",
        buyerAskKo:
          "Should the agent only consider items with proof of authenticity (tags/receipt)?",
        enforcement: "hard",
        // Topic-specific only. Bare "택" removed — it matched 택배(delivery)/선택(choice).
        answerHints: [
          "정품",
          "authentic",
          "가품",
          "짝퉁",
          "영수증",
          "시리얼",
          "serial",
          "보증서",
          "정가품",
        ],
        answerOptions: [
          {
            label: "Require proof of authenticity",
            stance: "authentic only, with proof (tags/receipt/serial)",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no authenticity-proof preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Authenticity proof?",
        sellerOptions: [
          {
            label: "Have proof",
            stance: "authentic, proof available (tags/receipt/serial)",
            requirement: "required",
          },
          { label: "No proof", stance: "no authenticity proof available", requirement: "required" },
        ],
      },
      {
        id: "cosmetic_grade",
        questionKo: "착용감/상태(등급)는 어떤가요?",
        buyerAskKo: "What condition / wear level are you comfortable with?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles",
    checks: [
      {
        // DELIBERATELY buyer-only. The buyer picks a CEILING ("Under 30k"); the seller
        // has an exact odometer reading. A bucket picker would let them tap "60k–100k"
        // and feel done, and the agent would then negotiate on the bucket instead of the
        // real 72,431 — a precision loss on the number car buyers care most about. The
        // seller states it in the title/description, which the agent reads. Every other
        // buyer-tappable soft check has a seller counterpart; this is the one exception.
        id: "mileage",
        questionKo: "주행거리는 얼마인가요?",
        buyerAskKo: "What maximum mileage do you want?",
        enforcement: "soft",
        answerOptions: [
          { label: "Under 30k", stance: "max 30,000 miles", requirement: "optional" },
          { label: "30k–60k", stance: "max 60,000 miles", requirement: "optional" },
          { label: "60k–100k", stance: "max 100,000 miles", requirement: "optional" },
          { label: "Any mileage", stance: "no mileage limit", requirement: "optional" },
        ],
      },
      {
        id: "title_status",
        questionKo: "명의/소유권(등록증)이 명확한가요?",
        buyerAskKo: "Should the agent only consider clean-title vehicles?",
        enforcement: "hard",
        // Topic-specific only. Bare "이전" removed — it matched 이전에(previously/before).
        answerHints: ["명의", "소유권", "등록증", "title", "서류", "차주", "등본"],
        answerOptions: [
          { label: "Clean title only", stance: "clean title only", requirement: "required" },
          {
            label: "Salvage/rebuilt OK",
            stance: "salvage or rebuilt title acceptable",
            requirement: "optional",
          },
          { label: "Doesn't matter", stance: "no title preference", requirement: "optional" },
        ],
        sellerAsk: "What's the title status?",
        sellerOptions: [
          { label: "Clean title", stance: "clean title, in hand", requirement: "required" },
          {
            label: "Salvage/rebuilt",
            stance: "salvage or rebuilt title",
            requirement: "required",
          },
        ],
      },
      {
        id: "lien_status",
        questionKo: "잔여 대출/저당(lien)이 없이 완전한 소유인가요?",
        buyerAskKo: "Should the agent require the vehicle be free & clear of any loan/lien?",
        enforcement: "hard",
        answerHints: ["대출", "저당", "lien", "융자", "payoff", "할부 잔액", "담보"],
        answerOptions: [
          {
            label: "Free & clear",
            stance: "no lien — free and clear title",
            requirement: "required",
          },
          {
            label: "Payoff at closing OK",
            stance: "active lien, payoff at closing acceptable",
            requirement: "optional",
          },
          { label: "Not required", stance: "no lien preference", requirement: "optional" },
        ],
        sellerAsk: "Loan / lien on title?",
        sellerOptions: [
          { label: "No lien", stance: "free and clear, no lien", requirement: "required" },
          {
            label: "Active lien",
            stance: "active lien, payoff at closing",
            requirement: "required",
          },
        ],
      },
      {
        id: "vin_theft_check",
        questionKo: "VIN(차대번호)이 서류와 일치하고 도난 이력이 없나요?",
        buyerAskKo: "Should the agent require the VIN to match the title and be theft-clear?",
        enforcement: "hard",
        answerHints: ["vin", "차대번호", "도난", "stolen", "theft", "nicb", "번호 일치", "restamp"],
        answerOptions: [
          {
            label: "Require VIN/theft check",
            stance: "VIN matches title, not reported stolen",
            requirement: "required",
          },
          { label: "Not required", stance: "no VIN/theft preference", requirement: "optional" },
        ],
        sellerAsk: "VIN match / theft?",
        sellerOptions: [
          {
            label: "Verified clean",
            stance: "VIN matches title, theft-clear",
            requirement: "required",
          },
          { label: "Not checked", stance: "VIN/theft not verified", requirement: "required" },
        ],
      },
      {
        id: "odometer_integrity",
        questionKo: "주행거리(오도미터)가 조작 없이 정확한가요?",
        buyerAskKo: "Should the agent require a genuine odometer (no rollback)?",
        enforcement: "hard",
        answerHints: [
          "오도미터",
          "주행거리 조작",
          "rollback",
          "odometer",
          "not actual",
          "tmu",
          "미터 조작",
        ],
        answerOptions: [
          {
            label: "Require genuine",
            stance: "genuine odometer, no rollback",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no odometer-integrity preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Odometer genuine?",
        sellerOptions: [
          { label: "Genuine", stance: "odometer accurate, no rollback", requirement: "required" },
          {
            label: "TMU / exempt",
            stance: "true-mileage-unknown or exempt",
            requirement: "required",
          },
        ],
      },
      {
        id: "flood_damage",
        questionKo: "침수(수해) 이력이 없나요?",
        buyerAskKo: "Should the agent require no flood/water damage?",
        enforcement: "hard",
        answerHints: ["침수", "수해", "flood", "water damage", "silt", "곰팡이 냄새", "물에 잠긴"],
        answerOptions: [
          { label: "No flood", stance: "no flood/water damage", requirement: "required" },
          { label: "Not required", stance: "no flood preference", requirement: "optional" },
        ],
        sellerAsk: "Flood damage?",
        sellerOptions: [
          { label: "None", stance: "no flood/water damage", requirement: "required" },
          {
            label: "Flood/suspected",
            stance: "flood title or suspected water damage",
            requirement: "required",
          },
        ],
      },
      {
        id: "frame_damage",
        questionKo: "프레임/구조부(주요 사고) 손상이 없나요?",
        buyerAskKo: "Should the agent require no frame/structural (major-accident) damage?",
        enforcement: "hard",
        answerHints: [
          "프레임",
          "구조",
          "frame damage",
          "structural",
          "unibody",
          "주요 사고",
          "framerail",
        ],
        answerOptions: [
          {
            label: "No frame damage",
            stance: "no frame/structural damage",
            requirement: "required",
          },
          { label: "Not required", stance: "no frame-damage preference", requirement: "optional" },
        ],
        sellerAsk: "Frame / structural damage?",
        sellerOptions: [
          { label: "None", stance: "no frame/structural damage", requirement: "required" },
          {
            label: "Repaired / structural",
            stance: "prior frame/structural repair",
            requirement: "required",
          },
        ],
      },
      {
        id: "service_history",
        questionKo: "정비 이력이 있나요?",
        buyerAskKo: "Do you want vehicles with service history?",
        enforcement: "soft",
        answerOptions: [
          {
            label: "Full history",
            stance: "full service records preferred",
            requirement: "optional",
          },
          { label: "Some history", stance: "partial service records OK", requirement: "optional" },
          { label: "Not needed", stance: "no service-history preference", requirement: "optional" },
        ],
        sellerAsk: "Service records?",
        sellerOptions: [
          { label: "Full records", stance: "full service records", requirement: "optional" },
          { label: "Some records", stance: "partial service records", requirement: "optional" },
          { label: "None", stance: "no service records", requirement: "optional" },
        ],
      },
      {
        id: "accident_history",
        questionKo: "사고(비구조부) 이력은 어떤가요?",
        buyerAskKo: "What accident history is acceptable (non-structural)?",
        enforcement: "soft",
        answerOptions: [
          { label: "None only", stance: "no accident history", requirement: "optional" },
          { label: "Minor OK", stance: "minor accidents acceptable", requirement: "optional" },
          { label: "Any", stance: "no accident-history preference", requirement: "optional" },
        ],
        sellerAsk: "Accident history?",
        sellerOptions: [
          { label: "None", stance: "no accident history", requirement: "optional" },
          {
            label: "Minor (disclosed)",
            stance: "minor accident, disclosed",
            requirement: "optional",
          },
          { label: "Structural", stance: "structural accident damage", requirement: "optional" },
        ],
      },
    ],
  },
  {
    path: "sports",
    aliases: ["sporting", "스포츠", "운동"],
    checks: [
      {
        id: "sports_condition",
        questionKo: "사용감/마모 상태는 어떤가요?",
        buyerAskKo: "What wear / condition level are you comfortable with?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
      {
        id: "sizing",
        questionKo: "사이즈/치수가 맞나요?",
        buyerAskKo: "Any required size or fit?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "sports/bicycles",
    aliases: ["bike", "bikes", "bicycle", "자전거", "mtb", "로드바이크", "road-bike"],
    checks: [
      {
        // Safety gate — a used bike's frame serial should verify against stolen-bike
        // registries (Bike Index / Project 529). A filed-off serial is a red flag.
        id: "bike_serial",
        questionKo: "시리얼(프레임) 번호로 도난 여부를 확인할 수 있나요?",
        buyerAskKo: "Should the agent require a verifiable serial number (not reported stolen)?",
        enforcement: "hard",
        // Topic-specific only — avoid everyday-substring false matches. "529"
        // removed (matches $529 / model numbers); "bike index" keeps the registry cue.
        answerHints: [
          "시리얼",
          "serial",
          "프레임 번호",
          "frame number",
          "도난",
          "stolen",
          "장물",
          "bike index",
        ],
        answerOptions: [
          {
            label: "Require verifiable serial",
            stance: "verifiable serial number, not reported stolen",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no serial-verification preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Serial number?",
        sellerOptions: [
          {
            label: "Verifiable serial",
            stance: "verifiable serial, not reported stolen",
            requirement: "required",
          },
          { label: "No serial", stance: "no verifiable serial number", requirement: "required" },
        ],
      },
      {
        id: "frame_condition",
        questionKo: "프레임에 균열/찌그러짐이 있나요?",
        buyerAskKo: "Any tolerance for frame cracks or dents?",
        enforcement: "soft",
      },
      {
        id: "frame_size",
        questionKo: "프레임 사이즈는 무엇인가요?",
        buyerAskKo: "What frame size do you need?",
        enforcement: "soft",
      },
      {
        id: "drivetrain_brakes",
        questionKo: "구동계/브레이크 상태는 어떤가요?",
        buyerAskKo: "Any drivetrain / brake condition requirement?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "collectibles",
    aliases: ["collectible", "memorabilia", "수집품", "굿즈", "피규어"],
    checks: [
      {
        // Safety/value gate — used collectibles are counterfeited; a COA, graded slab,
        // or a cert number verifiable against PSA/CGC/Beckett is the standard proof.
        id: "coa_authenticity",
        questionKo: "정품 인증(COA/감정서/등급 슬랩)이 가능한가요?",
        buyerAskKo:
          "Should the agent require proof of authenticity (COA / graded slab / cert number)?",
        enforcement: "hard",
        // Topic-specific only. Dropped generic substrings that fail the gate open:
        // "coa" (matches coach/cocoa), "cert" (certain/concert), bare "감정" (감정적).
        // Specific forms kept: 인증서/감정서/psa/cgc/beckett/slab.
        answerHints: [
          "인증서",
          "감정서",
          "정품",
          "authentic",
          "가품",
          "위조",
          "psa",
          "cgc",
          "beckett",
          "슬랩",
          "slab",
        ],
        answerOptions: [
          {
            label: "Require authenticity proof",
            stance: "authentic only, with COA / graded slab / cert number",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no authenticity-proof preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Authenticity (COA / grading)?",
        sellerOptions: [
          {
            label: "Has COA / graded",
            stance: "authentic, COA / graded slab / cert available",
            requirement: "required",
          },
          { label: "No COA", stance: "no COA / cert available", requirement: "required" },
        ],
      },
      {
        id: "grade_condition",
        questionKo: "상태 등급(그레이드)은 어떻게 되나요?",
        buyerAskKo: "What condition grade do you want?",
        enforcement: "soft",
      },
      {
        id: "completeness",
        questionKo: "구성품/원본 포장이 완전한가요?",
        buyerAskKo: "Do you require complete / original packaging?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "furniture",
    aliases: ["furnishing", "가구"],
    checks: [
      {
        id: "dimensions",
        questionKo: "치수(가로/세로/높이)는 어떻게 되나요?",
        buyerAskKo: "Any size / dimension constraints for your space?",
        enforcement: "soft",
      },
      {
        id: "material",
        questionKo: "소재(원목/합판 등)는 무엇인가요?",
        buyerAskKo: "Any required material (e.g. solid wood)?",
        enforcement: "soft",
      },
      {
        id: "damage",
        questionKo: "흠집/얼룩/구조적 손상이 있나요?",
        buyerAskKo: "What damage level (scratches / stains / structural) is acceptable?",
        featureKey: "cosmetic_grade",
        enforcement: "soft",
      },
      {
        id: "smoke_pet_free",
        questionKo: "흡연/반려동물 없는 환경인가요?",
        buyerAskKo: "Do you require a smoke-free / pet-free source?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "books",
    aliases: ["book", "도서", "책"],
    checks: [
      {
        id: "edition",
        questionKo: "판/쇄(초판 여부 등)는 어떻게 되나요?",
        buyerAskKo: "Any edition / printing requirement (e.g. first edition)?",
        enforcement: "soft",
      },
      {
        id: "book_condition",
        questionKo: "책 상태(밑줄/필기/변색)는 어떤가요?",
        buyerAskKo: "What book condition (markings / wear) is acceptable?",
        enforcement: "soft",
      },
      {
        id: "book_completeness",
        questionKo: "구성(표지/부록/페이지)이 온전한가요?",
        buyerAskKo: "Do you require it complete (dust jacket / all pages / inserts)?",
        enforcement: "soft",
      },
    ],
  },
  // ── vehicles: cross-cutting tags (EV/diesel) + subtypes ──────────────────
  {
    // Leaf "electric-vehicle" (not "ev"/"electric-car") — "ev" collides with ev-charger/
    // ev-battery (accessories that would wrongly inherit the whole vehicle title spine),
    // "electric" with electric-anything. Matches via "tesla" / exact "electric-vehicle" / Korean.
    path: "vehicles/electric-vehicle",
    aliases: ["tesla", "전기차"],
    checks: [
      {
        id: "battery_state_of_health",
        questionKo: "고전압 배터리 성능(SOH %)/열화 상태는 어떤가요?",
        buyerAskKo: "Any minimum EV battery state-of-health (SOH) you require?",
        enforcement: "soft",
        answerOptions: [
          { label: "90%+", stance: "battery SOH 90%+", requirement: "optional" },
          { label: "80%+", stance: "battery SOH 80%+", requirement: "optional" },
          { label: "Any", stance: "no SOH minimum", requirement: "optional" },
        ],
        sellerAsk: "EV battery SOH?",
        sellerOptions: [
          { label: "90%+", stance: "battery SOH 90% or higher", requirement: "optional" },
          { label: "80–89%", stance: "battery SOH between 80% and 89%", requirement: "optional" },
          { label: "Below 80%", stance: "battery SOH below 80%", requirement: "optional" },
          { label: "Not measured", stance: "battery SOH not measured", requirement: "optional" },
        ],
      },
      {
        id: "battery_warranty_remaining",
        questionKo: "고전압 배터리 보증이 남아있나요(양도 가능)?",
        buyerAskKo: "Do you want remaining (transferable) HV battery warranty?",
        enforcement: "soft",
      },
    ],
  },
  {
    // Leaf "diesel-truck" (not "diesel") — the bare "diesel" leaf/alias is a denim/watch
    // brand and would inject the car title spine onto apparel. Korean "디젤" is safe.
    path: "vehicles/diesel-truck",
    aliases: ["cummins", "powerstroke", "duramax", "디젤"],
    checks: [
      {
        id: "emissions_delete_status",
        questionKo: "배기가스 장치(DPF/EGR/DEF)가 삭제/개조되지 않았나요?",
        buyerAskKo: "Should the agent require stock emissions (no DPF/EGR/DEF delete)?",
        enforcement: "hard",
        answerHints: [
          "딜리트",
          "delete",
          "dpf",
          "egr",
          "def delete",
          "def system",
          "튜닝",
          "straight pipe",
          "배기 삭제",
        ],
        answerOptions: [
          { label: "Stock only", stance: "stock emissions, no delete", requirement: "required" },
          { label: "Delete OK", stance: "emissions delete acceptable", requirement: "optional" },
        ],
        sellerAsk: "Emissions delete?",
        sellerOptions: [
          { label: "Stock", stance: "stock emissions, nothing deleted", requirement: "required" },
          {
            label: "Deleted / tuned",
            stance: "DPF/EGR/DEF deleted or tuned",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "vehicles/motorcycles",
    aliases: ["motorcycle", "motorbike", "harley", "ducati", "오토바이", "바이크"],
    checks: [
      {
        id: "dropped_crash_evidence",
        questionKo: "전도/사고(굽은 프레임 등) 흔적이 없나요?",
        buyerAskKo: "What drop/crash evidence is acceptable?",
        enforcement: "soft",
        answerOptions: [
          { label: "Never dropped", stance: "no drop/crash evidence", requirement: "optional" },
          {
            label: "Minor drop OK",
            stance: "minor cosmetic drop acceptable",
            requirement: "optional",
          },
          { label: "Any", stance: "no drop-evidence preference", requirement: "optional" },
        ],
        sellerAsk: "Dropped or crashed?",
        sellerOptions: [
          { label: "Never dropped", stance: "never dropped or crashed", requirement: "optional" },
          {
            label: "Minor drop",
            stance: "minor drop, cosmetic only",
            requirement: "optional",
          },
          { label: "Crashed", stance: "has crash damage", requirement: "optional" },
        ],
      },
      {
        id: "tire_chain_condition",
        questionKo: "타이어/체인·스프라켓 상태는 어떤가요?",
        buyerAskKo: "Any tire / chain / sprocket condition requirement?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles/rv",
    aliases: ["rv", "camper", "motorhome", "travel-trailer", "캠핑카", "모터홈"],
    checks: [
      {
        id: "water_intrusion_damage",
        questionKo: "물 침투(soft spot/박리/썩음) 손상이 없나요?",
        buyerAskKo:
          "Should the agent require no water-intrusion damage (soft spots / delamination / rot)?",
        enforcement: "hard",
        answerHints: [
          "물 침투",
          "soft spot",
          "delamination",
          "박리",
          "누수",
          "썩음",
          "곰팡이",
          "rot",
        ],
        answerOptions: [
          {
            label: "No water damage",
            stance: "no water-intrusion damage",
            requirement: "required",
          },
          { label: "Not required", stance: "no water-damage preference", requirement: "optional" },
        ],
        sellerAsk: "Water intrusion?",
        sellerOptions: [
          { label: "None", stance: "no water intrusion, dry", requirement: "required" },
          {
            label: "Some / unknown",
            stance: "soft spots or water damage present",
            requirement: "required",
          },
        ],
      },
      {
        id: "propane_lp_system",
        questionKo: "LP(프로판) 시스템이 누출 없이 점검되었나요?",
        buyerAskKo: "Should the agent require the propane/LP system leak-tested?",
        enforcement: "hard",
        answerHints: ["프로판", "propane", "lp", "가스 누출", "regulator", "leak test"],
        answerOptions: [
          {
            label: "Leak-tested",
            stance: "propane system leak-tested, safe",
            requirement: "required",
          },
          { label: "Not required", stance: "no propane preference", requirement: "optional" },
        ],
        sellerAsk: "Propane / LP system?",
        sellerOptions: [
          {
            label: "Tested safe",
            stance: "LP system leak-tested, no leaks",
            requirement: "required",
          },
          { label: "Not inspected", stance: "LP system not inspected", requirement: "required" },
        ],
      },
      {
        id: "appliances_functional",
        questionKo: "냉장고/난방/에어컨/온수기 등 가전이 작동하나요?",
        buyerAskKo: "Any requirement on appliances (fridge/furnace/AC/water heater) working?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles/boats",
    // No bare "boat" (boat-shoes/gravy-boat/boat-neck) — would inject the car title spine.
    // Unambiguous boat words are safe and cover most real listings.
    aliases: ["jetski", "watercraft", "sailboat", "motorboat", "pontoon", "boats", "보트", "요트"],
    checks: [
      {
        id: "hin_match",
        questionKo: "선체 식별번호(HIN)가 서류와 일치하나요?",
        buyerAskKo: "Should the agent require the Hull ID (HIN) to match the title/registration?",
        enforcement: "hard",
        answerHints: ["hin", "hull id", "선체 번호", "transom", "선체 식별", "ground off"],
        answerOptions: [
          {
            label: "Require HIN match",
            stance: "HIN matches title/registration",
            requirement: "required",
          },
          { label: "Not required", stance: "no HIN preference", requirement: "optional" },
        ],
        sellerAsk: "HIN match?",
        sellerOptions: [
          { label: "Matches", stance: "HIN matches docs", requirement: "required" },
          {
            label: "Mismatch / missing",
            stance: "HIN mismatch or missing",
            requirement: "required",
          },
        ],
      },
      {
        id: "hull_integrity",
        questionKo: "선체 구조(트랜섬/스트링거/균열)가 견고한가요?",
        buyerAskKo:
          "Should the agent require sound hull structure (no soft transom/stringers/cracks)?",
        enforcement: "hard",
        answerHints: [
          "트랜섬",
          "transom",
          "stringer",
          "스트링거",
          "선체 균열",
          "hull crack",
          "blister",
        ],
        answerOptions: [
          {
            label: "Sound hull",
            stance: "sound hull, no structural issues",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no hull-structure preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Hull structure?",
        sellerOptions: [
          {
            label: "Sound",
            stance: "hull sound, solid transom/stringers",
            requirement: "required",
          },
          {
            label: "Soft / cracked",
            stance: "soft transom/stringers or cracks",
            requirement: "required",
          },
        ],
      },
      {
        id: "engine_hours",
        questionKo: "엔진 사용 시간(hours)은 얼마인가요?",
        buyerAskKo: "Any maximum engine hours?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "vehicles/atv",
    // No bare "quad" (quad-core CPU); no "quad-bike" (its "bike" token hits bicycles).
    aliases: ["atv", "utv", "side-by-side", "사륜", "사발이"],
    checks: [
      {
        id: "frame_crack_bent",
        questionKo: "프레임 균열/휨(전복 손상)이 없나요?",
        buyerAskKo: "Should the agent require no cracked/bent frame (rollover damage)?",
        enforcement: "hard",
        answerHints: [
          "프레임 균열",
          "bent frame",
          "cracked",
          "전복",
          "rollover",
          "welded",
          "swingarm",
        ],
        answerOptions: [
          { label: "No frame damage", stance: "no cracked/bent frame", requirement: "required" },
          { label: "Not required", stance: "no frame preference", requirement: "optional" },
        ],
        sellerAsk: "Frame condition?",
        sellerOptions: [
          { label: "Sound", stance: "frame sound, no cracks/bends", requirement: "required" },
          {
            label: "Bent / cracked",
            stance: "frame bent, cracked, or welded",
            requirement: "required",
          },
        ],
      },
      {
        id: "hours_use_type",
        questionKo: "사용 시간/용도(트레일/머드/렌탈 등)는?",
        buyerAskKo: "Any usage / hours preference (trail vs mud vs rental abuse)?",
        enforcement: "soft",
      },
    ],
  },
  {
    // STANDALONE (not under vehicles) — tires/wheels are NOT titled, so they must NOT
    // inherit the vehicle title/lien/VIN/odometer spine. Only tire-safety gates apply.
    path: "tires",
    aliases: ["tire", "tires", "wheel", "wheels", "rim", "rims", "타이어", "휠"],
    checks: [
      {
        id: "tire_age_dot_code",
        questionKo: "DOT 제조일(타이어 나이)이 안전 범위(6년 이내)인가요?",
        buyerAskKo: "Should the agent require tires within safe age (DOT date under ~6 years)?",
        enforcement: "hard",
        answerHints: ["dot", "제조일", "타이어 나이", "date code", "6년", "노후 타이어", "dry rot"],
        answerOptions: [
          { label: "Within 6 years", stance: "DOT date within ~6 years", requirement: "required" },
          { label: "Not required", stance: "no tire-age preference", requirement: "optional" },
        ],
        sellerAsk: "Tire age (DOT)?",
        sellerOptions: [
          { label: "Recent", stance: "DOT date recent, within safe age", requirement: "required" },
          {
            label: "Older / unknown",
            stance: "older than ~6 years or unknown",
            requirement: "required",
          },
        ],
      },
      {
        id: "sidewall_damage",
        questionKo: "측면(사이드월) 균열/부풀음/찢김이 없나요?",
        buyerAskKo: "Should the agent require no sidewall damage (bulge / crack / cut)?",
        enforcement: "hard",
        answerHints: ["사이드월", "sidewall", "bulge", "부풀음", "균열", "crack", "cut", "찢김"],
        answerOptions: [
          {
            label: "No sidewall damage",
            stance: "no sidewall bulge/crack/cut",
            requirement: "required",
          },
          { label: "Not required", stance: "no sidewall preference", requirement: "optional" },
        ],
        sellerAsk: "Sidewall condition?",
        sellerOptions: [
          { label: "Sound", stance: "sidewalls sound, no damage", requirement: "required" },
          { label: "Damaged", stance: "sidewall bulge/crack/cut present", requirement: "required" },
        ],
      },
      {
        id: "tread_depth",
        questionKo: "잔여 트레드(마모) 깊이는 얼마인가요?",
        buyerAskKo: "Any minimum tread depth?",
        enforcement: "soft",
      },
    ],
  },
  // ── scooters (standalone — not titled → theft + battery-fire, no VIN spine) ──
  {
    path: "scooters",
    aliases: [
      "scooter",
      "e-scooter",
      "escooter",
      "electric-scooter",
      "kickscooter",
      "전동킥보드",
      "킥보드",
    ],
    checks: [
      {
        id: "serial_intact",
        questionKo: "시리얼/식별번호가 훼손 없이 남아있나요?",
        buyerAskKo: "Should the agent require an intact, unaltered serial number?",
        enforcement: "hard",
        answerHints: [
          "시리얼",
          "serial",
          "식별번호",
          "removed",
          "altered",
          "긁어냄",
          "scratched off",
        ],
        answerOptions: [
          {
            label: "Require intact serial",
            stance: "serial intact, unaltered",
            requirement: "required",
          },
          { label: "Not required", stance: "no serial preference", requirement: "optional" },
        ],
        sellerAsk: "Serial number?",
        sellerOptions: [
          { label: "Intact", stance: "serial present and unaltered", requirement: "required" },
          {
            label: "Missing / altered",
            stance: "serial removed or altered",
            requirement: "required",
          },
        ],
      },
      {
        id: "stolen_registry_check",
        questionKo: "도난 등록(분실/도난 신고)이 없나요?",
        buyerAskKo: "Should the agent require it not be reported stolen?",
        enforcement: "hard",
        answerHints: ["도난", "stolen", "분실 신고", "registry", "장물", "도난 신고"],
        answerOptions: [
          { label: "Require theft-clear", stance: "not reported stolen", requirement: "required" },
          { label: "Not required", stance: "no theft-check preference", requirement: "optional" },
        ],
        sellerAsk: "Theft status?",
        sellerOptions: [
          {
            label: "Clear",
            stance: "not reported stolen, proof of ownership",
            requirement: "required",
          },
          { label: "Unknown", stance: "theft status unknown", requirement: "required" },
        ],
      },
      {
        id: "battery_fire_recall",
        questionKo: "배터리가 인증(UL)되어 있고 리콜/화재 위험이 없나요?",
        buyerAskKo: "Should the agent require a certified (non-recalled, UL-listed) battery?",
        enforcement: "hard",
        // Anchored — bare "ul" matched would/could/should/adult, bare "인증" any cert mention.
        answerHints: [
          "배터리 화재",
          "battery fire",
          "ul listed",
          "ul 2272",
          "리콜",
          "recall",
          "uncertified",
          "배터리 인증",
        ],
        answerOptions: [
          {
            label: "Require certified",
            stance: "certified (UL) battery, not recalled",
            requirement: "required",
          },
          { label: "Not required", stance: "no battery-cert preference", requirement: "optional" },
        ],
        sellerAsk: "Battery certification?",
        sellerOptions: [
          {
            label: "Certified",
            stance: "UL-listed battery, not recalled",
            requirement: "required",
          },
          {
            label: "Uncertified / recalled",
            stance: "uncertified or recalled battery",
            requirement: "required",
          },
        ],
      },
      {
        id: "battery_health_range",
        questionKo: "배터리 성능/주행거리(range)는 어떤가요?",
        buyerAskKo: "Any minimum battery range / health?",
        enforcement: "soft",
      },
    ],
  },
  // ── clothing: luxury / resale subtypes ───────────────────────────────────
  {
    path: "clothing/sneakers",
    // D3 CTO: shoe-family taxonomy/HARD entirely no-op. No aliases (incl. jordan/yeezy/dunk/
    // 스니커즈/운동화/sneakers) open sneaker HARD. Keep electronics galaxy/pixel/phone HARD only.
    aliases: [],
    checks: [
      {
        id: "sneaker_authenticity",
        questionKo: "정품(레플리카/UA 아님)인가요? (StockX/GOAT 인증 포함)",
        buyerAskKo: "Should the agent require authenticity (platform-verified / not replica)?",
        enforcement: "soft",
        answerHints: [
          "정품",
          "레플리카",
          "replica",
          "ua",
          "fake",
          "stockx",
          "goat",
          "legit check",
          "가품",
        ],
        answerOptions: [
          {
            label: "Authentic only",
            stance: "authentic only — platform-verified or verified legit",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          {
            label: "Platform-verified",
            stance: "StockX/GOAT verified authentic",
            requirement: "required",
          },
          {
            label: "Unverified",
            stance: "authentic but not platform-verified",
            requirement: "required",
          },
        ],
      },
      {
        id: "deadstock_condition",
        questionKo: "상태(데드스탁/사용감)는 어떤가요?",
        buyerAskKo: "What condition (deadstock vs used)?",
        enforcement: "soft",
        answerOptions: [
          { label: "Deadstock (new)", stance: "deadstock / brand new", requirement: "optional" },
          { label: "Like new", stance: "like-new / VNDS", requirement: "optional" },
          { label: "Used OK", stance: "used acceptable", requirement: "optional" },
        ],
        sellerAsk: "Deadstock or used?",
        sellerOptions: [
          { label: "Deadstock (new)", stance: "deadstock, never worn", requirement: "optional" },
          { label: "Like new", stance: "worn once or twice, like new", requirement: "optional" },
          { label: "Used", stance: "used with visible wear", requirement: "optional" },
        ],
      },
      {
        id: "original_box",
        questionKo: "정품 박스가 포함되나요?",
        buyerAskKo: "Do you require the original box?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "clothing/handbags",
    aliases: [
      "handbag",
      "handbags",
      "purse",
      "louis-vuitton",
      "chanel",
      "gucci",
      "hermes",
      "명품가방",
      "가방",
    ],
    checks: [
      {
        id: "bag_authenticity",
        questionKo: "정품 인증(플랫폼 감정/카드 등)이 가능한가요?",
        buyerAskKo:
          "Should the agent require authenticity (platform-authenticated / not counterfeit)?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "counterfeit",
          "super fake",
          "replica",
          "감정",
          "authenticated",
          "짝퉁",
        ],
        answerOptions: [
          {
            label: "Authenticated only",
            stance: "authenticated genuine only",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          {
            label: "Authenticated",
            stance: "platform-authenticated genuine",
            requirement: "required",
          },
          { label: "Unverified", stance: "genuine but not authenticated", requirement: "required" },
        ],
      },
      {
        id: "date_code_chip",
        questionKo:
          "데이트코드/시리얼/RFID 등 식별 표식이 일관되나요? (2021년 이후 LV는 코드 없음이 정상)",
        buyerAskKo:
          "Should the agent require a consistent date code / serial / chip (note: post-2021 LV has no date code)?",
        enforcement: "hard",
        answerHints: [
          "데이트코드",
          "date code",
          "serial",
          "시리얼",
          "rfid",
          "microchip",
          "hologram",
          "홀로그램",
        ],
        answerOptions: [
          {
            label: "Require consistent code",
            stance: "date code / serial consistent with era",
            requirement: "required",
          },
          { label: "Not required", stance: "no date-code preference", requirement: "optional" },
        ],
        sellerAsk: "Date code / serial?",
        sellerOptions: [
          {
            label: "Present & consistent",
            stance: "date code / serial / chip present and consistent",
            requirement: "required",
          },
          {
            label: "N/A (post-2021)",
            stance: "no date code — normal for era (RFID)",
            requirement: "required",
          },
        ],
      },
      {
        id: "condition_grade",
        questionKo: "상태 등급(코너/파티나 등)은 어떤가요?",
        buyerAskKo: "What condition grade is acceptable?",
        enforcement: "soft",
        answerOptions: [
          {
            label: "Pristine/Excellent",
            stance: "pristine or excellent only",
            requirement: "optional",
          },
          { label: "Very good", stance: "very good acceptable", requirement: "optional" },
          { label: "Any", stance: "no condition preference", requirement: "optional" },
        ],
        sellerAsk: "Condition grade?",
        sellerOptions: [
          {
            label: "Pristine/Excellent",
            stance: "pristine or excellent condition",
            requirement: "optional",
          },
          { label: "Very good", stance: "very good condition", requirement: "optional" },
          { label: "Fair", stance: "fair condition, visible wear", requirement: "optional" },
        ],
      },
    ],
  },
  {
    path: "clothing/watches",
    // NB: no bare "watch" — it collides with "apple-watch"/"galaxy-watch" (smartwatches).
    // Luxury watches match via brand or the plural/Korean forms.
    aliases: ["watches", "rolex", "omega", "patek", "손목시계", "명품시계"],
    checks: [
      {
        id: "watch_authenticity",
        questionKo: "정품(가품/프랑켄 아님)이며 무브먼트가 순정인가요?",
        buyerAskKo:
          "Should the agent require authenticity (genuine, not fake/franken, original movement)?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "fake",
          "franken",
          "replica",
          "무브먼트",
          "movement",
          "swapped",
          "정품 인증",
        ],
        answerOptions: [
          {
            label: "Authentic + original movement",
            stance: "authentic, original movement (no franken)",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity / movement?",
        sellerOptions: [
          {
            label: "Authentic (certified)",
            stance: "authentic, original movement, dealer/Chrono24 certified",
            requirement: "required",
          },
          {
            label: "Unverified",
            stance: "authentic but not independently verified",
            requirement: "required",
          },
        ],
      },
      {
        id: "box_and_papers",
        questionKo: "박스와 보증서(풀세트, 시리얼 일치)가 있나요?",
        buyerAskKo: "Should the agent require box & papers (full set, matching serial)?",
        enforcement: "hard",
        answerHints: [
          "박스",
          "보증서",
          "box and papers",
          "full set",
          "warranty card",
          "풀세트",
          "서류",
        ],
        answerOptions: [
          {
            label: "Require full set",
            stance: "full set — box & papers with matching serial",
            requirement: "required",
          },
          {
            label: "Watch only OK",
            stance: "watch-only acceptable (no papers)",
            requirement: "optional",
          },
        ],
        sellerAsk: "Box & papers?",
        sellerOptions: [
          {
            label: "Full set",
            stance: "full set — box & papers, matching serial",
            requirement: "required",
          },
          { label: "Watch only", stance: "watch only, no box/papers", requirement: "required" },
        ],
      },
      {
        id: "service_condition",
        questionKo: "서비스 이력/외관 상태(폴리싱 등)는 어떤가요?",
        buyerAskKo: "Any service-history / condition (polishing) preference?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "clothing/jewelry",
    // NB: no bare "gold" (matches gold-colored electronics) or "ring" (ring doorbell/
    // light). Jewelry matches via diamond/necklace/jewelry or the Korean forms.
    aliases: ["jewelry", "jewellery", "diamond", "necklace", "주얼리", "보석", "반지"],
    checks: [
      {
        id: "metal_hallmark",
        questionKo: "금속 순도 각인(14K/18K/750/585/925 등)이 있나요?",
        buyerAskKo: "Should the agent require a metal purity hallmark (karat/925 stamp)?",
        enforcement: "hard",
        answerHints: [
          "각인",
          "hallmark",
          "karat",
          "750",
          "585",
          "925",
          "순도",
          "gold plated",
          "도금",
        ],
        answerOptions: [
          {
            label: "Require hallmark",
            stance: "verified metal hallmark / purity",
            requirement: "required",
          },
          { label: "Not required", stance: "no hallmark preference", requirement: "optional" },
        ],
        sellerAsk: "Metal hallmark?",
        sellerOptions: [
          {
            label: "Stamped/verified",
            stance: "hallmark stamped and verified",
            requirement: "required",
          },
          { label: "Unstamped/plated", stance: "no hallmark or plated", requirement: "required" },
        ],
      },
      {
        id: "diamond_cert",
        questionKo: "다이아몬드 감정서(GIA/IGI 등)가 있나요?",
        buyerAskKo: "Should the agent require a diamond grading report (GIA/IGI)?",
        enforcement: "hard",
        answerHints: ["gia", "igi", "감정서", "grading report", "certificate", "4c", "gcal"],
        answerOptions: [
          {
            label: "Require cert",
            stance: "GIA/IGI grading report required",
            requirement: "required",
          },
          { label: "Not required", stance: "no diamond-cert preference", requirement: "optional" },
        ],
        sellerAsk: "Diamond cert?",
        sellerOptions: [
          { label: "GIA/IGI cert", stance: "GIA/IGI report available", requirement: "required" },
          { label: "None", stance: "no grading report", requirement: "required" },
        ],
      },
      {
        id: "stone_natural_lab",
        questionKo: "천연/랩그로운/모조 여부가 공개되나요?",
        buyerAskKo: "Should the agent require disclosure of natural vs lab-grown vs simulant?",
        enforcement: "hard",
        answerHints: [
          "천연",
          "랩그로운",
          "lab grown",
          "natural",
          "moissanite",
          "cz",
          "모조",
          "합성",
        ],
        answerOptions: [
          { label: "Natural only", stance: "natural stone required", requirement: "required" },
          {
            label: "Lab-grown OK",
            stance: "lab-grown acceptable (disclosed)",
            requirement: "optional",
          },
          {
            label: "Any (disclosed)",
            stance: "any, as long as disclosed",
            requirement: "optional",
          },
        ],
        sellerAsk: "Stone origin?",
        sellerOptions: [
          { label: "Natural", stance: "natural stone", requirement: "required" },
          { label: "Lab-grown", stance: "lab-grown stone", requirement: "required" },
          { label: "Simulant", stance: "simulant (CZ/moissanite)", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "clothing/sunglasses",
    aliases: ["sunglasses", "eyewear", "ray-ban", "oakley", "선글라스", "안경"],
    checks: [
      {
        id: "sunglasses_authenticity",
        questionKo: "정품(렌즈 각인/모델번호 확인)인가요?",
        buyerAskKo: "Should the agent require authenticity (lens etching / model number)?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "fake",
          "replica",
          "렌즈 각인",
          "lens etching",
          "model number",
          "knockoff",
        ],
        answerOptions: [
          {
            label: "Authentic only",
            stance: "authentic — lens etching / model verified",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          { label: "Genuine", stance: "genuine, etching/model verified", requirement: "required" },
          { label: "Unverified", stance: "authenticity not verified", requirement: "required" },
        ],
      },
      {
        id: "eyewear_condition",
        questionKo: "렌즈/프레임 상태(스크래치 등)는 어떤가요?",
        buyerAskKo: "What lens/frame condition is acceptable?",
        enforcement: "soft",
      },
    ],
  },
  // ── collectibles: graded/authenticated subtypes ──────────────────────────
  {
    path: "collectibles/trading-cards",
    // No bare "cards" (sd-cards/memory-cards/gift-cards/graphics-cards).
    aliases: [
      "trading-card",
      "trading-cards",
      "pokemon",
      "mtg",
      "sports-card",
      "카드",
      "포켓몬카드",
    ],
    checks: [
      {
        id: "graded_status",
        questionKo: "제3자 등급(PSA/BGS/CGC 등) 슬랩인가요, 로우(raw)인가요?",
        buyerAskKo: "Should the agent require third-party graded (PSA/BGS/CGC) slabs?",
        enforcement: "hard",
        answerHints: ["psa", "bgs", "cgc", "sgc", "슬랩", "slab", "등급", "graded", "raw", "로우"],
        answerOptions: [
          {
            label: "Graded only",
            stance: "third-party graded (PSA/BGS/CGC) only",
            requirement: "required",
          },
          { label: "Raw OK", stance: "raw / ungraded acceptable", requirement: "optional" },
        ],
        sellerAsk: "Graded or raw?",
        sellerOptions: [
          { label: "Graded", stance: "third-party graded slab", requirement: "required" },
          { label: "Raw", stance: "raw / ungraded", requirement: "required" },
        ],
      },
      {
        id: "cert_slab_authenticity",
        questionKo: "인증번호가 DB와 일치하고 슬랩이 진품(재가공/가짜 슬랩 아님)인가요?",
        buyerAskKo:
          "Should the agent require a matching cert number & genuine slab (not recased/fake)?",
        enforcement: "hard",
        answerHints: [
          "cert number",
          "인증번호",
          "cert verification",
          "recased",
          "fake slab",
          "가짜 슬랩",
          "population",
          "재가공",
        ],
        answerOptions: [
          {
            label: "Require cert match",
            stance: "cert number matches DB, genuine slab",
            requirement: "required",
          },
          { label: "Not required", stance: "no cert-match preference", requirement: "optional" },
        ],
        sellerAsk: "Cert / slab authenticity?",
        sellerOptions: [
          { label: "Verified", stance: "cert matches DB, slab genuine", requirement: "required" },
          { label: "Unverified", stance: "cert/slab not verified", requirement: "required" },
        ],
      },
      {
        id: "counterfeit_card",
        questionKo: "카드 자체가 진품(리프린트/프록시/리백 아님)인가요?",
        buyerAskKo: "Should the agent require an authentic card (not reprint/proxy/rebacked)?",
        enforcement: "hard",
        answerHints: [
          "리프린트",
          "reprint",
          "proxy",
          "프록시",
          "rebacked",
          "리백",
          "counterfeit",
          "위조",
          "가짜 카드",
        ],
        answerOptions: [
          {
            label: "Authentic only",
            stance: "authentic card, no reprint/proxy/reback",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no counterfeit-check preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Card authenticity?",
        sellerOptions: [
          {
            label: "Authentic",
            stance: "authentic, verified genuine card",
            requirement: "required",
          },
          { label: "Unverified", stance: "authenticity not verified", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "collectibles/coins",
    aliases: ["coin", "coins", "currency", "bullion", "동전", "주화", "화폐"],
    checks: [
      {
        id: "coin_graded_status",
        questionKo: "제3자 등급(PCGS/NGC 등)인가요, 로우인가요?",
        buyerAskKo: "Should the agent require third-party graded (PCGS/NGC) coins?",
        enforcement: "hard",
        answerHints: ["pcgs", "ngc", "anacs", "슬랩", "slab", "등급", "graded", "raw", "로우"],
        answerOptions: [
          { label: "Graded only", stance: "PCGS/NGC graded only", requirement: "required" },
          { label: "Raw OK", stance: "raw / ungraded acceptable", requirement: "optional" },
        ],
        sellerAsk: "Graded or raw?",
        sellerOptions: [
          { label: "Graded", stance: "PCGS/NGC graded slab", requirement: "required" },
          { label: "Raw", stance: "raw / ungraded", requirement: "required" },
        ],
      },
      {
        id: "counterfeit_coin",
        questionKo: "위조(주조/타조 가품)가 아닌 진품인가요?",
        buyerAskKo: "Should the agent require a genuine coin (not counterfeit/cast)?",
        enforcement: "hard",
        answerHints: ["위조", "counterfeit", "가품", "cast", "replica", "무게", "자석", "diameter"],
        answerOptions: [
          {
            label: "Genuine only",
            stance: "genuine, not counterfeit/cast",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no counterfeit-check preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          { label: "Genuine", stance: "genuine, verified authentic", requirement: "required" },
          { label: "Unverified", stance: "authenticity not verified", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "collectibles/comics",
    aliases: ["comic", "comics", "만화책", "코믹스"],
    checks: [
      {
        id: "comic_graded_status",
        questionKo: "제3자 등급(CGC/CBCS)인가요, 로우인가요?",
        buyerAskKo: "Should the agent require third-party graded (CGC/CBCS)?",
        enforcement: "hard",
        answerHints: ["cgc", "cbcs", "슬랩", "slab", "등급", "graded", "raw", "universal"],
        answerOptions: [
          { label: "Graded only", stance: "CGC/CBCS graded only", requirement: "required" },
          { label: "Raw OK", stance: "raw / ungraded acceptable", requirement: "optional" },
        ],
        sellerAsk: "Graded or raw?",
        sellerOptions: [
          { label: "Graded", stance: "CGC/CBCS graded", requirement: "required" },
          { label: "Raw", stance: "raw / ungraded", requirement: "required" },
        ],
      },
      {
        id: "restoration_check",
        questionKo: "복원/수리(트리밍/컬러터치 등)가 없나요?",
        buyerAskKo:
          "Should the agent require no restoration (color touch / trimming / married pages)?",
        enforcement: "hard",
        answerHints: [
          "복원",
          "restoration",
          "restored",
          "트리밍",
          "trimming",
          "color touch",
          "conserved",
          "수리",
        ],
        answerOptions: [
          { label: "No restoration", stance: "unrestored only", requirement: "required" },
          {
            label: "Restoration OK",
            stance: "restoration acceptable (disclosed)",
            requirement: "optional",
          },
        ],
        sellerAsk: "Restoration?",
        sellerOptions: [
          {
            label: "None (unrestored)",
            stance: "unrestored, no color touch/trimming",
            requirement: "required",
          },
          { label: "Restored/conserved", stance: "restored or conserved", requirement: "required" },
        ],
      },
    ],
  },
  {
    // Leaf "vinyl-records" (not "vinyl") — bare "vinyl" hits vinyl-flooring/siding/decal;
    // bare "record(s)" hits business records; 2-char "lp" hits lp-gas.
    path: "collectibles/vinyl-records",
    aliases: ["vinyl-record", "lp-record", "바이닐", "엘피", "레코드"],
    checks: [
      {
        id: "counterfeit_bootleg",
        questionKo: "공식 프레싱(부틀렉/가짜 아님)인가요?",
        buyerAskKo: "Should the agent require an official pressing (not bootleg/counterfeit)?",
        enforcement: "hard",
        answerHints: [
          "부틀렉",
          "bootleg",
          "unofficial",
          "counterfeit",
          "가짜 프레싱",
          "위조",
          "official",
        ],
        answerOptions: [
          {
            label: "Official only",
            stance: "official pressing only, no bootlegs",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no pressing-authenticity preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Official or bootleg?",
        sellerOptions: [
          { label: "Official", stance: "official pressing", requirement: "required" },
          { label: "Bootleg/unknown", stance: "bootleg or unverified", requirement: "required" },
        ],
      },
      {
        id: "media_sleeve_grade",
        questionKo: "음반/커버 등급(Goldmine 등)은 어떤가요?",
        buyerAskKo: "What media / sleeve grade is acceptable?",
        enforcement: "soft",
      },
    ],
  },
  {
    // Leaf "artwork" (not bare "art"/"print") — "art" collides with art-supplies/wall-art,
    // "print" with 3d-print/screen-print. Matches via artwork/painting/Korean forms.
    path: "collectibles/artwork",
    aliases: ["painting", "그림", "미술", "판화"],
    checks: [
      {
        id: "original_vs_reproduction",
        questionKo: "원본/한정 프린트인가요, 복제(지클레/포스터)인가요?",
        buyerAskKo:
          "Should the agent require an original / hand-pulled print (not a giclée repro/poster)?",
        enforcement: "hard",
        answerHints: [
          "원본",
          "original",
          "지클레",
          "giclee",
          "reproduction",
          "복제",
          "poster",
          "hand pulled",
          "판화",
        ],
        answerOptions: [
          {
            label: "Original/limited only",
            stance: "original or hand-pulled limited print only",
            requirement: "required",
          },
          {
            label: "Repro OK",
            stance: "reproduction / poster acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Original or reproduction?",
        sellerOptions: [
          {
            label: "Original/hand-pulled",
            stance: "original or hand-pulled print",
            requirement: "required",
          },
          {
            label: "Reproduction",
            stance: "giclée / reproduction / poster",
            requirement: "required",
          },
        ],
      },
      {
        id: "art_authenticity_coa",
        questionKo: "진품 인증(COA/에스테이트 스탬프)이 있나요?",
        buyerAskKo: "Should the agent require a COA / provenance (artist/estate/gallery)?",
        enforcement: "hard",
        answerHints: [
          "certificate of authenticity",
          "coa cert",
          "estate stamp",
          "provenance",
          "감정서",
          "출처",
        ],
        answerOptions: [
          {
            label: "Require COA",
            stance: "COA / documented provenance required",
            requirement: "required",
          },
          { label: "Not required", stance: "no COA preference", requirement: "optional" },
        ],
        sellerAsk: "COA / provenance?",
        sellerOptions: [
          { label: "Has COA", stance: "COA / provenance available", requirement: "required" },
          { label: "None", stance: "no COA / provenance", requirement: "required" },
        ],
      },
    ],
  },
  // ── instruments (standalone — no music category) ─────────────────────────
  {
    path: "instruments",
    // NB: no bare "bass" (bass speaker/subwoofer) or "keyboard" (computer keyboard) —
    // both collide with electronics. Basses match via "guitar"/"bass-guitar" tokens.
    aliases: [
      "instrument",
      "guitar",
      "guitars",
      "synth",
      "piano",
      "midi",
      "악기",
      "기타",
      "신디사이저",
    ],
    checks: [
      {
        id: "instrument_stolen_check",
        questionKo: "도난 등록(분실/도난 신고)이 없고 소유 증빙이 있나요?",
        buyerAskKo: "Should the agent require it not be reported stolen (proof of ownership)?",
        enforcement: "hard",
        answerHints: [
          "도난",
          "stolen",
          "분실",
          "playchecked",
          "registry",
          "장물",
          "소유 증빙",
          "proof of ownership",
        ],
        answerOptions: [
          {
            label: "Require theft-clear",
            stance: "not reported stolen, proof of ownership",
            requirement: "required",
          },
          { label: "Not required", stance: "no theft-check preference", requirement: "optional" },
        ],
        sellerAsk: "Theft / ownership?",
        sellerOptions: [
          {
            label: "Clear + proof",
            stance: "not stolen, proof of ownership",
            requirement: "required",
          },
          { label: "Unknown", stance: "ownership/theft unknown", requirement: "required" },
        ],
      },
      {
        id: "instrument_authenticity",
        questionKo: "정품(가품/'치브슨' 클론 아님)이며 시리얼이 일관되나요?",
        buyerAskKo:
          "Should the agent require genuine brand (not counterfeit/clone) with consistent serial?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "counterfeit",
          "clone",
          "chibson",
          "fake",
          "시리얼",
          "serial",
          "위조",
        ],
        answerOptions: [
          {
            label: "Genuine only",
            stance: "genuine brand, consistent serial",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity / serial?",
        sellerOptions: [
          {
            label: "Genuine",
            stance: "genuine, serial legible and consistent",
            requirement: "required",
          },
          { label: "Unverified", stance: "authenticity not verified", requirement: "required" },
        ],
      },
      {
        id: "instrument_functionality",
        questionKo: "연주 상태(데드 키/노이즈, 넥/프렛 등)는 어떤가요?",
        buyerAskKo: "Any playability requirement (dead keys / noise / neck / frets)?",
        enforcement: "soft",
      },
    ],
  },
  // ── sports: subtypes ─────────────────────────────────────────────────────
  {
    path: "sports/bicycles/ebike",
    aliases: ["ebike", "e-bike", "electric-bike", "전기자전거", "이바이크"],
    checks: [
      {
        id: "ebike_battery_fire_recall",
        questionKo: "배터리가 인증(UL 2849)되어 리콜/화재 위험이 없나요?",
        buyerAskKo: "Should the agent require a certified (UL-listed, non-recalled) battery?",
        enforcement: "hard",
        answerHints: [
          "배터리 화재",
          "battery fire",
          "ul 2849",
          "리콜",
          "recall",
          "uncertified",
          "인증",
        ],
        answerOptions: [
          {
            label: "Require certified",
            stance: "certified (UL 2849) battery, not recalled",
            requirement: "required",
          },
          { label: "Not required", stance: "no battery-cert preference", requirement: "optional" },
        ],
        sellerAsk: "Battery certification?",
        sellerOptions: [
          {
            label: "Certified",
            stance: "UL-listed battery, not recalled",
            requirement: "required",
          },
          {
            label: "Uncertified / recalled",
            stance: "uncertified or recalled battery",
            requirement: "required",
          },
        ],
      },
      {
        id: "ebike_motor_battery_health",
        questionKo: "모터/배터리 성능(주행거리·사이클)은 어떤가요?",
        buyerAskKo: "Any motor / battery health (range / cycles) preference?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "sports/golf",
    // No bare "driver" (impact-driver/screwdriver) — use golf-driver.
    aliases: ["golf", "golf-club", "golf-clubs", "golf-driver", "irons", "골프", "골프채"],
    checks: [
      {
        id: "golf_counterfeit_check",
        questionKo: "정품(가품/클론 아님)인가요? (Titleist/Callaway/PING 등)",
        buyerAskKo: "Should the agent require genuine clubs (not counterfeit/clone)?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "counterfeit",
          "clone",
          "fake",
          "짝퉁",
          "shaft band",
          "authorized dealer",
        ],
        answerOptions: [
          {
            label: "Genuine only",
            stance: "genuine clubs, not counterfeit/clone",
            requirement: "required",
          },
          { label: "Not required", stance: "no authenticity preference", requirement: "optional" },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          { label: "Genuine", stance: "genuine, from authorized source", requirement: "required" },
          { label: "Unverified", stance: "authenticity not verified", requirement: "required" },
        ],
      },
      {
        id: "shaft_flex_spec",
        questionKo: "샤프트 플렉스/스펙(길이·로프트 등)은?",
        buyerAskKo: "Any required shaft flex / spec?",
        enforcement: "soft",
      },
    ],
  },
  {
    // Leaf "skis" (not bare "ski") — "ski" collides with ski-jacket/ski-mask/ski-goggles
    // (apparel that shouldn't get binding-safety gates). Matches via "skis"/"snowboard"/Korean.
    path: "sports/skis",
    aliases: ["snowboard", "스키", "스노보드"],
    checks: [
      {
        id: "binding_safety_indemnified",
        questionKo: "바인딩이 현행(indemnified, DIN 조정 가능)인가요? (구형 바인딩 위험)",
        buyerAskKo: "Should the agent require current (indemnified, not obsolete) bindings?",
        enforcement: "hard",
        answerHints: [
          "바인딩",
          "binding",
          "din setting",
          "indemnified",
          "obsolete",
          "구형 바인딩",
          "release",
        ],
        answerOptions: [
          {
            label: "Require current",
            stance: "current indemnified bindings",
            requirement: "required",
          },
          { label: "Not required", stance: "no binding preference", requirement: "optional" },
        ],
        sellerAsk: "Bindings?",
        sellerOptions: [
          {
            label: "Current/indemnified",
            stance: "current, indemnified bindings",
            requirement: "required",
          },
          {
            label: "Obsolete / none",
            stance: "obsolete bindings or none",
            requirement: "required",
          },
        ],
      },
      {
        id: "ski_structural_integrity",
        questionKo: "구조(박리/코어 손상)가 없나요?",
        buyerAskKo: "Should the agent require no delamination / core damage?",
        enforcement: "hard",
        answerHints: ["박리", "delamination", "코어", "core shot", "topsheet crack", "구조 손상"],
        answerOptions: [
          {
            label: "Sound only",
            stance: "structurally sound, no delamination/core damage",
            requirement: "required",
          },
          { label: "Not required", stance: "no structure preference", requirement: "optional" },
        ],
        sellerAsk: "Structure?",
        sellerOptions: [
          { label: "Sound", stance: "no delamination or core damage", requirement: "required" },
          {
            label: "Damaged",
            stance: "delamination or core damage present",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "sports/fitness",
    aliases: [
      "fitness",
      "treadmill",
      "peloton",
      "dumbbell",
      "dumbbells",
      "barbell",
      "weights",
      "런닝머신",
      "덤벨",
      "헬스",
    ],
    checks: [
      {
        id: "fitness_powers_on_tested",
        questionKo: "전원이 켜지고(모터/콘솔) 정상 작동하나요?",
        buyerAskKo: "Should the agent require it to power on and run (motor/console tested)?",
        enforcement: "hard",
        answerHints: [
          "작동",
          "powers on",
          "motor",
          "모터",
          "console",
          "tested",
          "안 켜짐",
          "burning smell",
        ],
        answerOptions: [
          { label: "Must work", stance: "powers on and runs, tested", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / untested acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Powers on & runs?",
        sellerOptions: [
          { label: "Tested works", stance: "powers on and runs, tested", requirement: "required" },
          { label: "Untested / faulty", stance: "untested or faulty", requirement: "required" },
        ],
      },
      {
        id: "peloton_activation_lock",
        questionKo: "(펠로톤) 렌탈 잠금이 아니며 활성화 가능한가요?",
        buyerAskKo:
          "For Peloton — should the agent require it NOT be a locked rental unit (activatable)?",
        enforcement: "hard",
        answerHints: [
          "펠로톤",
          "peloton",
          "rental",
          "렌탈",
          "activate",
          "cannot activate",
          "locked",
          "serial",
        ],
        answerOptions: [
          {
            label: "Require activatable",
            stance: "owned unit, activatable (not rental-locked)",
            requirement: "required",
          },
          {
            label: "Not applicable",
            stance: "not a Peloton / no lock concern",
            requirement: "optional",
          },
        ],
        sellerAsk: "Rental lock (Peloton)?",
        sellerOptions: [
          {
            label: "Owned / activatable",
            stance: "owned, activatable, proof of ownership",
            requirement: "required",
          },
          {
            label: "Rental / N-A",
            stance: "rental unit or not applicable",
            requirement: "required",
          },
        ],
      },
      {
        id: "fitness_wear_condition",
        questionKo: "마모/부식(벨트·놉·프레임 등) 상태는 어떤가요?",
        buyerAskKo: "Any wear / corrosion preference (belt / knurling / frame)?",
        enforcement: "soft",
      },
    ],
  },
  // ── furniture: subtypes (HARD gates only on children — root stays soft) ───
  {
    path: "furniture/mattress",
    aliases: ["mattress", "mattresses", "boxspring", "매트리스", "침대 매트리스"],
    checks: [
      {
        id: "bed_bugs",
        questionKo: "빈대(베드버그) 흔적이 없나요?",
        buyerAskKo: "Should the agent require it inspected clear of bed bugs?",
        enforcement: "hard",
        answerHints: ["빈대", "베드버그", "bed bug", "bed bugs", "seams", "casings", "fecal"],
        answerOptions: [
          {
            label: "Require bed-bug-free",
            stance: "inspected clear of bed bugs",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no bed-bug-inspection preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Bed bugs?",
        sellerOptions: [
          { label: "Inspected clear", stance: "inspected, no bed bugs", requirement: "required" },
          { label: "Unknown", stance: "not inspected for bed bugs", requirement: "required" },
        ],
      },
      {
        id: "fluid_stains",
        questionKo: "체액/오염 얼룩(소변·혈흔 등)이 없나요?",
        buyerAskKo: "Should the agent require no bodily-fluid stains?",
        enforcement: "hard",
        answerHints: ["얼룩", "stains", "소변", "urine", "혈흔", "yellowing", "sanitary", "오염"],
        answerOptions: [
          { label: "No stains", stance: "no fluid/staining", requirement: "required" },
          { label: "Not required", stance: "no stain preference", requirement: "optional" },
        ],
        sellerAsk: "Stains?",
        sellerOptions: [
          { label: "None", stance: "no fluid stains, clean", requirement: "required" },
          { label: "Some", stance: "has staining", requirement: "required" },
        ],
      },
      {
        id: "mold_mildew",
        questionKo: "곰팡이/습기 냄새가 없나요?",
        buyerAskKo: "Should the agent require no mold/mildew?",
        enforcement: "hard",
        answerHints: ["곰팡이", "mold", "mildew", "습기", "musty", "damp"],
        answerOptions: [
          { label: "No mold", stance: "no mold/mildew", requirement: "required" },
          { label: "Not required", stance: "no mold preference", requirement: "optional" },
        ],
        sellerAsk: "Mold / mildew?",
        sellerOptions: [
          { label: "None", stance: "no mold/mildew, dry", requirement: "required" },
          { label: "Some / unknown", stance: "possible mold/musty", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "furniture/upholstered",
    aliases: ["sofa", "couch", "sectional", "recliner", "loveseat", "소파", "패브릭 소파"],
    checks: [
      {
        id: "bed_bugs",
        questionKo: "빈대(베드버그) 흔적이 없나요?",
        buyerAskKo: "Should the agent require it inspected clear of bed bugs?",
        enforcement: "hard",
        answerHints: ["빈대", "베드버그", "bed bug", "bed bugs", "seams", "piping", "fecal"],
        answerOptions: [
          {
            label: "Require bed-bug-free",
            stance: "inspected clear of bed bugs",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no bed-bug-inspection preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Bed bugs?",
        sellerOptions: [
          { label: "Inspected clear", stance: "inspected, no bed bugs", requirement: "required" },
          { label: "Unknown", stance: "not inspected for bed bugs", requirement: "required" },
        ],
      },
      {
        id: "frame_intact",
        questionKo: "프레임(구조)이 파손 없이 견고한가요?",
        buyerAskKo: "Should the agent require a solid (unbroken) frame?",
        enforcement: "hard",
        answerHints: [
          "프레임",
          "frame",
          "broken frame",
          "cracked wood",
          "structural",
          "구조 파손",
          "sagging frame",
        ],
        answerOptions: [
          { label: "Solid frame", stance: "frame solid, not broken", requirement: "required" },
          { label: "Not required", stance: "no frame preference", requirement: "optional" },
        ],
        sellerAsk: "Frame condition?",
        sellerOptions: [
          { label: "Solid", stance: "frame solid, no cracks/breaks", requirement: "required" },
          { label: "Broken/weak", stance: "frame broken or cracked", requirement: "required" },
        ],
      },
      {
        id: "upholstery_odor",
        questionKo: "흡연/반려동물 냄새/얼룩은 어떤가요?",
        buyerAskKo: "Any smoke/pet odor / stain tolerance?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "furniture/wood",
    aliases: [
      "dresser",
      "table",
      "desk",
      "cabinet",
      "bookcase",
      "nightstand",
      "원목가구",
      "책상",
      "서랍장",
    ],
    checks: [
      {
        id: "wood_water_damage",
        questionKo: "수분 손상(뒤틀림/썩음/얼룩)이 없나요?",
        buyerAskKo: "Should the agent require no water damage (warping / rot / rings)?",
        enforcement: "hard",
        answerHints: [
          "수분",
          "water damage",
          "뒤틀림",
          "warped",
          "rot",
          "썩음",
          "soft spot",
          "얼룩",
        ],
        answerOptions: [
          {
            label: "No water damage",
            stance: "no water damage / warping / rot",
            requirement: "required",
          },
          { label: "Not required", stance: "no water-damage preference", requirement: "optional" },
        ],
        sellerAsk: "Water damage?",
        sellerOptions: [
          { label: "None", stance: "no water damage, sound", requirement: "required" },
          { label: "Some", stance: "surface rings or warping present", requirement: "required" },
        ],
      },
      {
        id: "structural_stability",
        questionKo: "흔들림 없이 구조가 안정적인가요(조인트/다리)?",
        buyerAskKo: "Should the agent require it structurally stable (no wobble, tight joints)?",
        enforcement: "hard",
        answerHints: ["흔들림", "wobble", "loose joint", "unstable", "구조", "다리", "rocks"],
        answerOptions: [
          { label: "Stable", stance: "structurally stable, no wobble", requirement: "required" },
          { label: "Not required", stance: "no stability preference", requirement: "optional" },
        ],
        sellerAsk: "Stability?",
        sellerOptions: [
          { label: "Solid", stance: "solid, tight joints, no wobble", requirement: "required" },
          { label: "Wobbly", stance: "wobble or loose joints", requirement: "required" },
        ],
      },
      {
        id: "wood_material",
        questionKo: "소재(원목/합판/MDF)와 마감 상태는?",
        buyerAskKo: "Any material (solid wood vs particleboard) preference?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "furniture/office-chair",
    aliases: [
      "office-chair",
      "task-chair",
      "aeron",
      "herman-miller",
      "steelcase",
      "사무용의자",
      "의자",
    ],
    checks: [
      {
        id: "gas_cylinder_works",
        questionKo: "가스 실린더(높이 유지)가 정상인가요(내려앉지 않음)?",
        buyerAskKo: "Should the agent require a working gas cylinder (holds height)?",
        enforcement: "hard",
        answerHints: [
          "가스 실린더",
          "gas cylinder",
          "gas lift",
          "sinks",
          "내려앉",
          "won't stay up",
          "높이 유지",
        ],
        answerOptions: [
          {
            label: "Must hold height",
            stance: "gas cylinder holds height",
            requirement: "required",
          },
          { label: "Not required", stance: "no cylinder preference", requirement: "optional" },
        ],
        sellerAsk: "Gas cylinder?",
        sellerOptions: [
          { label: "Holds", stance: "cylinder holds height", requirement: "required" },
          { label: "Sinks", stance: "cylinder sinks / dead", requirement: "required" },
        ],
      },
      {
        id: "chair_authenticity",
        questionKo: "(허먼밀러/스틸케이스) 정품(가품 아님)인가요?",
        buyerAskKo: "For premium brands — should the agent require a genuine (not replica) chair?",
        enforcement: "hard",
        answerHints: [
          "정품",
          "가품",
          "replica",
          "knock-off",
          "herman miller",
          "steelcase",
          "짝퉁",
          "authentic",
        ],
        answerOptions: [
          { label: "Genuine only", stance: "genuine, not a replica", requirement: "required" },
          {
            label: "Not applicable",
            stance: "generic chair / no authenticity concern",
            requirement: "optional",
          },
        ],
        sellerAsk: "Authenticity?",
        sellerOptions: [
          { label: "Genuine", stance: "genuine brand, verified", requirement: "required" },
          { label: "Replica / generic", stance: "replica or generic", requirement: "required" },
        ],
      },
      {
        id: "chair_mechanism",
        questionKo: "틸트/리클라인·팔걸이·바퀴 상태는?",
        buyerAskKo: "Any tilt / armrest / caster condition preference?",
        enforcement: "soft",
      },
    ],
  },
  // ── appliances (standalone — no home category; matched by alias) ──────────
  {
    path: "appliances",
    aliases: ["appliance", "appliances", "가전"],
    checks: [
      {
        id: "appliance_working_condition",
        questionKo: "정상 작동하나요(부품용 아님)?",
        buyerAskKo: "Should the agent require a fully working unit (not for-parts)?",
        enforcement: "hard",
        answerHints: ["작동", "works", "tested", "정상", "안 됨", "dead", "for parts", "부품용"],
        answerOptions: [
          { label: "Fully working", stance: "fully working, tested", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "minor issues / for-parts acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Working condition?",
        sellerOptions: [
          { label: "Fully working", stance: "fully working, tested", requirement: "required" },
          { label: "Issues / parts", stance: "minor issues or for-parts", requirement: "required" },
        ],
      },
      {
        id: "appliance_recall",
        questionKo: "리콜(화재/감전 등) 대상 모델이 아닌가요?",
        buyerAskKo: "Should the agent require it not be a recalled model?",
        enforcement: "hard",
        answerHints: ["리콜", "recall", "cpsc", "화재 리콜", "safety recall", "리콜 대상"],
        answerOptions: [
          {
            label: "Require not recalled",
            stance: "not a recalled model",
            requirement: "required",
          },
          { label: "Not required", stance: "no recall-check preference", requirement: "optional" },
        ],
        sellerAsk: "Recall status?",
        sellerOptions: [
          { label: "Not recalled", stance: "not a recalled model", requirement: "required" },
          { label: "Unknown", stance: "recall status unknown", requirement: "required" },
        ],
      },
      {
        id: "appliance_dimensions",
        questionKo: "설치 공간/문 통과 치수가 맞나요?",
        buyerAskKo: "Any size / fit constraints (space, doorway)?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "appliances/refrigerator",
    aliases: ["refrigerator", "fridge", "freezer", "냉장고", "냉동고"],
    checks: [
      {
        id: "cooling_works",
        questionKo: "정상적으로 냉장/냉동(설정 온도까지)되나요?",
        buyerAskKo: "Should the agent require it to cool/freeze to temperature?",
        enforcement: "hard",
        answerHints: ["냉장", "냉동", "cooling", "not cooling", "compressor", "안 시원", "따뜻함"],
        answerOptions: [
          { label: "Must cool", stance: "cools/freezes to temperature", requirement: "required" },
          { label: "Not required", stance: "no cooling preference", requirement: "optional" },
        ],
        sellerAsk: "Cooling works?",
        sellerOptions: [
          { label: "Cools well", stance: "cools and freezes to temp", requirement: "required" },
          { label: "Weak / not cooling", stance: "weak or not cooling", requirement: "required" },
        ],
      },
      {
        id: "fridge_mold_odor",
        questionKo: "곰팡이/악취가 없나요?",
        buyerAskKo: "Should the agent require it free of mold / musty odor?",
        enforcement: "hard",
        answerHints: ["곰팡이", "mold", "악취", "musty", "냄새", "gasket mold"],
        answerOptions: [
          {
            label: "No mold/odor",
            stance: "clean, no mold or musty odor",
            requirement: "required",
          },
          { label: "Not required", stance: "no mold/odor preference", requirement: "optional" },
        ],
        sellerAsk: "Mold / odor?",
        sellerOptions: [
          { label: "Clean", stance: "clean, no mold/odor", requirement: "required" },
          { label: "Musty / mold", stance: "musty smell or mold present", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "appliances/laundry",
    // No bare "washer"/"dryer" (pressure-washer/hair-dryer/dryer-vent).
    aliases: ["washing-machine", "clothes-dryer", "세탁기", "건조기"],
    checks: [
      {
        id: "laundry_working",
        questionKo: "전체 사이클(급수/세탁·건조/배수)이 정상 작동하나요?",
        buyerAskKo:
          "Should the agent require it to run a full cycle (fills / washes-dries / drains)?",
        enforcement: "hard",
        answerHints: [
          "사이클",
          "cycle",
          "급수",
          "배수",
          "won't drain",
          "won't spin",
          "안 돌아감",
          "heats",
        ],
        answerOptions: [
          { label: "Must work", stance: "runs a full cycle, tested", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "for-parts / faulty acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Full cycle works?",
        sellerOptions: [
          { label: "Works", stance: "runs full cycle, tested", requirement: "required" },
          { label: "Faulty / parts", stance: "faulty or for-parts", requirement: "required" },
        ],
      },
      {
        id: "laundry_mold_leak",
        questionKo: "가스켓 곰팡이/누수가 없나요?",
        buyerAskKo: "Should the agent require no gasket mold / leaks?",
        enforcement: "hard",
        answerHints: ["곰팡이", "mold", "가스켓", "gasket", "누수", "leak", "front load smell"],
        answerOptions: [
          { label: "No mold/leaks", stance: "no gasket mold or leaks", requirement: "required" },
          { label: "Not required", stance: "no mold/leak preference", requirement: "optional" },
        ],
        sellerAsk: "Mold / leaks?",
        sellerOptions: [
          { label: "Clean & dry", stance: "no gasket mold, no leaks", requirement: "required" },
          {
            label: "Mold / leaks",
            stance: "gasket mold or leaks present",
            requirement: "required",
          },
        ],
      },
      {
        id: "laundry_power_type",
        questionKo: "전기(240V)/가스 방식과 후크업이 맞나요?",
        buyerAskKo: "Which hookup do you need (electric 240V vs gas)?",
        enforcement: "soft",
      },
    ],
  },
  {
    // Leaf "stove" (not "range") — a "range" leaf/alias collides with range-rover /
    // long-range. Matches via oven/stove/cooktop + Korean forms.
    path: "appliances/stove",
    aliases: ["oven", "stove", "cooktop", "가스레인지", "인덕션", "오븐"],
    checks: [
      {
        id: "burners_oven_work",
        questionKo: "모든 버너/오븐이 정상 가열되나요?",
        buyerAskKo: "Should the agent require all burners + oven to heat?",
        enforcement: "hard",
        answerHints: ["버너", "burner", "오븐", "oven", "가열", "heats", "element", "안 켜짐"],
        answerOptions: [
          { label: "All work", stance: "all burners + oven heat", requirement: "required" },
          { label: "Not required", stance: "no heating preference", requirement: "optional" },
        ],
        sellerAsk: "Burners / oven work?",
        sellerOptions: [
          { label: "All work", stance: "all burners and oven heat", requirement: "required" },
          { label: "Some out", stance: "some burners/oven not working", requirement: "required" },
        ],
      },
      {
        id: "gas_leak_safe",
        questionKo: "(가스) 연결부 누출 없이 안전한가요(파란 불꽃)?",
        buyerAskKo: "For gas models — should the agent require no gas leak (safe connection)?",
        enforcement: "hard",
        answerHints: [
          "가스 누출",
          "gas leak",
          "soap test",
          "yellow flame",
          "누출",
          "가스 냄새",
          "연결부",
        ],
        answerOptions: [
          {
            label: "Require leak-safe",
            stance: "gas connection leak-tested safe",
            requirement: "required",
          },
          { label: "Not applicable", stance: "electric / no gas concern", requirement: "optional" },
        ],
        sellerAsk: "Gas leak safe?",
        sellerOptions: [
          {
            label: "Safe (tested)",
            stance: "gas connection tested, no leak",
            requirement: "required",
          },
          { label: "Electric / N-A", stance: "electric or not tested", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "appliances/microwave",
    aliases: ["microwave", "전자레인지"],
    checks: [
      {
        id: "microwave_works",
        questionKo: "정상 가열되고 문 래치/차폐가 정상인가요(아크 없음)?",
        buyerAskKo: "Should the agent require it to heat and the door to latch (no arcing/leak)?",
        enforcement: "hard",
        answerHints: [
          "전자레인지",
          "microwave",
          "door latch",
          "arcing",
          "아크",
          "스파크",
          "가열 안됨",
          "문 래치",
        ],
        answerOptions: [
          {
            label: "Must work safely",
            stance: "heats, door latches, no arcing",
            requirement: "required",
          },
          { label: "Not required", stance: "no working preference", requirement: "optional" },
        ],
        sellerAsk: "Works & door latch?",
        sellerOptions: [
          { label: "Works safely", stance: "heats, latches, no arcing", requirement: "required" },
          { label: "Faulty", stance: "faulty heating / door / arcing", requirement: "required" },
        ],
      },
      {
        id: "microwave_recall",
        questionKo: "리콜(배선/문 래치) 대상 모델이 아닌가요?",
        buyerAskKo: "Should the agent require it not be a recalled model?",
        enforcement: "hard",
        answerHints: ["리콜", "recall", "cpsc", "배선 리콜", "door latch recall"],
        answerOptions: [
          { label: "Not recalled", stance: "not a recalled model", requirement: "required" },
          { label: "Not required", stance: "no recall preference", requirement: "optional" },
        ],
        sellerAsk: "Recall status?",
        sellerOptions: [
          { label: "Not recalled", stance: "not recalled", requirement: "required" },
          { label: "Unknown", stance: "recall status unknown", requirement: "required" },
        ],
      },
    ],
  },
  {
    // Leaf "air-conditioner" (not "ac") — an "ac" leaf/alias collides with ac-adapter /
    // AC-DC electronics. Matches "air-conditioner"/"aircon"/"hvac" tags (a bare "ac" or
    // hyphen-split "window-ac" won't resolve here — acceptable; AC is low-volume).
    path: "appliances/air-conditioner",
    aliases: ["에어컨", "aircon", "hvac"],
    checks: [
      {
        id: "ac_cooling_works",
        questionKo: "냉방(컴프레서)이 정상 작동하나요(선풍기만 아님)?",
        buyerAskKo: "Should the agent require it to actually cool (compressor, not just fan)?",
        enforcement: "hard",
        answerHints: [
          "냉방",
          "cooling",
          "compressor",
          "컴프레서",
          "not cooling",
          "just fan",
          "안 시원",
        ],
        answerOptions: [
          { label: "Must cool", stance: "cools (compressor works)", requirement: "required" },
          { label: "Not required", stance: "no cooling preference", requirement: "optional" },
        ],
        sellerAsk: "Cooling works?",
        sellerOptions: [
          { label: "Cools well", stance: "cools, compressor works", requirement: "required" },
          { label: "Weak / fan only", stance: "weak or fan only", requirement: "required" },
        ],
      },
      {
        id: "ac_refrigerant_mold",
        questionKo: "냉매 누출/코일 곰팡이가 없나요?",
        buyerAskKo: "Should the agent require no refrigerant leak / coil mold?",
        enforcement: "hard",
        answerHints: ["냉매", "refrigerant", "누출", "leak", "곰팡이", "mold", "coil", "freon"],
        answerOptions: [
          {
            label: "No leak/mold",
            stance: "no refrigerant leak or coil mold",
            requirement: "required",
          },
          { label: "Not required", stance: "no leak/mold preference", requirement: "optional" },
        ],
        sellerAsk: "Refrigerant / mold?",
        sellerOptions: [
          { label: "Clean", stance: "no leak, coils clean", requirement: "required" },
          { label: "Leak / mold", stance: "suspected leak or coil mold", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "appliances/space-heater",
    // No bare "heater" (water-heater/patio-heater) — leaf "space-heater" + Korean cover it.
    aliases: ["히터", "온풍기", "전기히터"],
    checks: [
      {
        id: "heater_electrical_safe",
        questionKo: "코드/플러그가 손상 없이 안전한가요(화재/아크 위험)?",
        buyerAskKo: "Should the agent require an intact cord/plug (no fire/arc risk)?",
        enforcement: "hard",
        answerHints: [
          "코드",
          "cord",
          "plug",
          "frayed",
          "손상",
          "arcing",
          "melted",
          "화재",
          "탄 냄새",
        ],
        answerOptions: [
          {
            label: "Require safe cord",
            stance: "cord/plug intact, no fire/arc risk",
            requirement: "required",
          },
          { label: "Not required", stance: "no cord preference", requirement: "optional" },
        ],
        sellerAsk: "Cord / plug?",
        sellerOptions: [
          { label: "Intact", stance: "cord/plug intact, safe", requirement: "required" },
          { label: "Damaged", stance: "frayed/damaged cord or plug", requirement: "required" },
        ],
      },
      {
        id: "heater_safety_features",
        questionKo: "전도(틸트)/과열 자동 차단과 인증(UL/ETL)이 있나요?",
        buyerAskKo:
          "Should the agent require tip-over + overheat shutoff and UL/ETL certification?",
        enforcement: "hard",
        answerHints: [
          "틸트",
          "tip over",
          "과열",
          "overheat",
          "shut off",
          "차단",
          "ul listed",
          "etl listed",
          "안전 인증",
        ],
        answerOptions: [
          {
            label: "Require safety cutoffs",
            stance: "tip-over + overheat shutoff, UL/ETL listed",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no safety-feature preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Safety cutoffs / cert?",
        sellerOptions: [
          {
            label: "Has cutoffs + UL",
            stance: "tip-over/overheat shutoff, UL/ETL listed",
            requirement: "required",
          },
          {
            label: "Missing / unknown",
            stance: "missing safety cutoffs or uncertified",
            requirement: "required",
          },
        ],
      },
    ],
  },
  // ── tools (standalone) ───────────────────────────────────────────────────
  {
    path: "tools",
    aliases: ["tool", "tools", "power-tool", "drill", "saw", "공구", "전동공구", "드릴"],
    checks: [
      {
        id: "tool_motor_works",
        questionKo: "모터가 부하에서 정상 작동하나요(그라인딩/탄내 없음)?",
        buyerAskKo: "Should the agent require the motor to run under load (no grinding/burning)?",
        enforcement: "hard",
        answerHints: ["모터", "motor", "grinding", "탄내", "burnt", "안 돌아감", "dead", "runs"],
        answerOptions: [
          { label: "Must run", stance: "motor runs strong under load", requirement: "required" },
          {
            label: "For-parts OK",
            stance: "weak/dead motor / for-parts acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Motor works?",
        sellerOptions: [
          { label: "Runs strong", stance: "motor runs strong, tested", requirement: "required" },
          { label: "Weak / dead", stance: "weak or dead motor", requirement: "required" },
        ],
      },
      {
        id: "tool_cord_safety",
        questionKo: "(유선) 전원 코드가 손상/스플라이스 없이 안전한가요?",
        buyerAskKo:
          "For corded tools — should the agent require an intact power cord (no fray/splice)?",
        enforcement: "hard",
        answerHints: ["코드", "cord", "frayed", "spliced", "손상", "damaged plug", "누전"],
        answerOptions: [
          {
            label: "Require safe cord",
            stance: "cord intact, no fray/splice",
            requirement: "required",
          },
          {
            label: "Not applicable",
            stance: "cordless / no cord concern",
            requirement: "optional",
          },
        ],
        sellerAsk: "Power cord?",
        sellerOptions: [
          { label: "Intact", stance: "cord intact, safe", requirement: "required" },
          { label: "Frayed / N-A", stance: "frayed cord or cordless", requirement: "required" },
        ],
      },
    ],
  },
  {
    // Leaf "cordless-tool" (not "cordless") — bare "cordless" leaf hits cordless-phone/vacuum.
    path: "tools/cordless-tool",
    aliases: [
      "impact-driver",
      "cordless-drill",
      "dewalt",
      "milwaukee",
      "makita",
      "ryobi",
      "m18",
      "무선공구",
    ],
    checks: [
      {
        id: "battery_included",
        questionKo: "배터리가 포함되나요(베어툴 아님)?",
        buyerAskKo: "Should the agent require a battery included (not bare tool)?",
        enforcement: "hard",
        answerHints: [
          "배터리",
          "battery",
          "bare tool",
          "베어툴",
          "battery included",
          "tool only",
          "충전지",
        ],
        answerOptions: [
          { label: "Battery included", stance: "battery included", requirement: "required" },
          { label: "Bare tool OK", stance: "bare tool acceptable", requirement: "optional" },
        ],
        sellerAsk: "Battery included?",
        sellerOptions: [
          { label: "With battery", stance: "battery included", requirement: "required" },
          { label: "Bare tool", stance: "bare tool, no battery", requirement: "required" },
        ],
      },
      {
        id: "battery_charger_health",
        questionKo: "배터리가 충전을 유지하고 충전기가 포함되나요?",
        buyerAskKo: "Should the agent require a healthy battery (holds charge) + charger?",
        enforcement: "hard",
        answerHints: [
          "배터리",
          "battery",
          "충전",
          "charge",
          "dead battery",
          "won't hold",
          "charger",
          "충전기",
        ],
        answerOptions: [
          {
            label: "Require healthy + charger",
            stance: "battery holds charge, charger included",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no battery-health preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Battery health / charger?",
        sellerOptions: [
          {
            label: "Good + charger",
            stance: "battery holds charge, charger included",
            requirement: "required",
          },
          {
            label: "Weak / no charger",
            stance: "weak battery or no charger",
            requirement: "required",
          },
        ],
      },
    ],
  },
  // ── baby / kids (standalone — safety-critical) ───────────────────────────
  {
    path: "baby/car-seat",
    // No bare "booster" (booster-pack cards / signal-booster) — use booster-seat.
    aliases: [
      "car-seat",
      "carseat",
      "infant-seat",
      "convertible-seat",
      "booster-seat",
      "카시트",
      "유아 카시트",
    ],
    checks: [
      {
        id: "carseat_expiration",
        questionKo: "만료일(제조일 기준) 이내인가요?",
        buyerAskKo: "Should the agent require the seat be within its expiration date?",
        enforcement: "hard",
        answerHints: [
          "만료",
          "expiration",
          "제조일",
          "expired",
          "만료일",
          "manufacture date",
          "유효기간",
        ],
        answerOptions: [
          { label: "Not expired only", stance: "within expiration date", requirement: "required" },
          { label: "Not required", stance: "no expiration preference", requirement: "optional" },
        ],
        sellerAsk: "Expiration?",
        sellerOptions: [
          { label: "Not expired", stance: "within expiration date", requirement: "required" },
          { label: "Expired / unknown", stance: "expired or unknown", requirement: "required" },
        ],
      },
      {
        id: "carseat_crash_history",
        questionKo: "사고(충돌) 이력이 없나요?",
        buyerAskKo: "Should the agent require no crash history?",
        enforcement: "hard",
        answerHints: ["사고", "crash", "충돌", "accident", "crashed", "구조 손상", "사고 이력"],
        answerOptions: [
          { label: "No crash history", stance: "never in a crash", requirement: "required" },
          { label: "Not required", stance: "no crash-history preference", requirement: "optional" },
        ],
        sellerAsk: "Crash history?",
        sellerOptions: [
          { label: "Never crashed", stance: "no crash history", requirement: "required" },
          {
            label: "Crashed / unknown",
            stance: "crashed or unknown history",
            requirement: "required",
          },
        ],
      },
      {
        id: "carseat_recall_parts",
        questionKo: "리콜 대상이 아니며 안전 부품(하네스/클립/베이스)이 완비되나요?",
        buyerAskKo: "Should the agent require no recall + all safety parts (harness/clips/base)?",
        enforcement: "hard",
        answerHints: [
          "리콜",
          "recall",
          "nhtsa",
          "하네스",
          "harness",
          "클립",
          "clip",
          "latch",
          "base",
          "부품",
        ],
        answerOptions: [
          {
            label: "Require clear + complete",
            stance: "no recall, all safety parts present",
            requirement: "required",
          },
          { label: "Not required", stance: "no recall/parts preference", requirement: "optional" },
        ],
        sellerAsk: "Recall / safety parts?",
        sellerOptions: [
          {
            label: "Clear + complete",
            stance: "not recalled, all parts present",
            requirement: "required",
          },
          {
            label: "Recalled / missing",
            stance: "recalled or missing parts",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "baby/stroller",
    aliases: ["stroller", "pram", "buggy", "유모차"],
    checks: [
      {
        id: "stroller_recall",
        questionKo: "리콜 대상 모델이 아닌가요?",
        buyerAskKo: "Should the agent require it not be a recalled model?",
        enforcement: "hard",
        answerHints: ["리콜", "recall", "cpsc", "리콜 대상", "hinge recall"],
        answerOptions: [
          {
            label: "Require not recalled",
            stance: "not a recalled model",
            requirement: "required",
          },
          { label: "Not required", stance: "no recall preference", requirement: "optional" },
        ],
        sellerAsk: "Recall status?",
        sellerOptions: [
          { label: "Not recalled", stance: "not recalled", requirement: "required" },
          { label: "Unknown", stance: "recall status unknown", requirement: "required" },
        ],
      },
      {
        id: "stroller_brake_harness",
        questionKo: "브레이크/하네스(안전벨트)와 프레임이 정상인가요?",
        buyerAskKo: "Should the agent require working brake + harness + sound frame?",
        enforcement: "hard",
        answerHints: [
          "브레이크",
          "brake",
          "하네스",
          "harness",
          "buckle",
          "프레임",
          "frame crack",
          "안전벨트",
        ],
        answerOptions: [
          {
            label: "Require all working",
            stance: "brake, harness, and frame all sound",
            requirement: "required",
          },
          { label: "Not required", stance: "no safety-part preference", requirement: "optional" },
        ],
        sellerAsk: "Brake / harness / frame?",
        sellerOptions: [
          {
            label: "All good",
            stance: "brake, harness, frame all working",
            requirement: "required",
          },
          { label: "Issue", stance: "brake/harness/frame issue", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "baby/crib",
    // No bare "cot" (camping cot) — crib + Korean cover it.
    aliases: ["crib", "아기 침대", "유아 침대"],
    checks: [
      {
        id: "crib_dropside_standard",
        questionKo: "드롭사이드(불법)가 아니며 최신 안전기준(2011년 이후)인가요?",
        buyerAskKo: "Should the agent require a non-drop-side crib meeting the post-2011 standard?",
        enforcement: "hard",
        answerHints: [
          "드롭사이드",
          "drop-side",
          "drop side",
          "banned",
          "2011",
          "안전기준",
          "fixed side",
          "jpma",
        ],
        answerOptions: [
          {
            label: "Require compliant",
            stance: "fixed-side, post-2011 standard-compliant",
            requirement: "required",
          },
          { label: "Not required", stance: "no standard preference", requirement: "optional" },
        ],
        sellerAsk: "Drop-side / standard?",
        sellerOptions: [
          {
            label: "Fixed, post-2011",
            stance: "fixed-side, post-2011 compliant",
            requirement: "required",
          },
          {
            label: "Drop-side / pre-2011",
            stance: "drop-side or pre-2011",
            requirement: "required",
          },
        ],
      },
      {
        id: "crib_hardware_recall",
        questionKo: "리콜 대상이 아니며 하드웨어(볼트/매트리스 지지대)가 완비되나요?",
        buyerAskKo: "Should the agent require no recall + complete hardware?",
        enforcement: "hard",
        answerHints: [
          "리콜",
          "recall",
          "하드웨어",
          "hardware",
          "볼트",
          "bolts",
          "mattress support",
          "브래킷",
        ],
        answerOptions: [
          {
            label: "Require clear + complete",
            stance: "not recalled, all hardware present",
            requirement: "required",
          },
          {
            label: "Not required",
            stance: "no recall/hardware preference",
            requirement: "optional",
          },
        ],
        sellerAsk: "Recall / hardware?",
        sellerOptions: [
          {
            label: "Clear + complete",
            stance: "not recalled, complete hardware",
            requirement: "required",
          },
          {
            label: "Recalled / missing",
            stance: "recalled or missing hardware",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    // Leaf "baby-carrier" (not bare "carrier") — "carrier" collides with phone
    // "carrier-locked/unlocked". No "wrap"/"sling" (wrap dress / sling bag).
    path: "baby/baby-carrier",
    aliases: ["ergobaby", "아기띠", "포대기"],
    checks: [
      {
        id: "carrier_recall_buckle",
        questionKo: "리콜 대상이 아니며 버클/스트랩·봉제가 견고한가요?",
        buyerAskKo: "Should the agent require no recall + intact buckles / straps / seams?",
        enforcement: "hard",
        answerHints: [
          "리콜",
          "recall",
          "버클",
          "buckle",
          "스트랩",
          "strap",
          "봉제",
          "seam",
          "fraying",
        ],
        answerOptions: [
          {
            label: "Require safe",
            stance: "not recalled, buckles/straps/seams intact",
            requirement: "required",
          },
          { label: "Not required", stance: "no safety preference", requirement: "optional" },
        ],
        sellerAsk: "Recall / buckles?",
        sellerOptions: [
          { label: "Safe", stance: "not recalled, buckles/straps sound", requirement: "required" },
          {
            label: "Issue / unknown",
            stance: "recall or buckle/strap issue",
            requirement: "required",
          },
        ],
      },
    ],
  },
  // ── misc high-volume (standalone alias nodes) ────────────────────────────
  {
    path: "board-games",
    aliases: ["board-game", "boardgame", "board-games", "tabletop", "보드게임"],
    checks: [
      {
        id: "game_completeness",
        questionKo: "모든 구성품이 완비되어 있나요(BGG 기준)?",
        buyerAskKo: "Should the agent require all components complete (per BGG)?",
        enforcement: "hard",
        answerHints: [
          "구성품",
          "완비",
          "complete",
          "missing",
          "누락",
          "all pieces",
          "components",
          "부품",
        ],
        answerOptions: [
          { label: "Complete only", stance: "all components complete", requirement: "required" },
          {
            label: "Minor missing OK",
            stance: "minor missing pieces acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Completeness?",
        sellerOptions: [
          { label: "Complete", stance: "all components present", requirement: "required" },
          { label: "Missing some", stance: "some components missing", requirement: "required" },
        ],
      },
      {
        id: "game_edition_extras",
        questionKo: "에디션/확장/프로모 구성은 어떤가요?",
        buyerAskKo: "Any edition / expansions preference?",
        enforcement: "soft",
      },
    ],
  },
  {
    path: "kitchenware",
    aliases: [
      "cookware",
      "kitchenware",
      "pots",
      "pans",
      "cast-iron",
      "주방용품",
      "냄비",
      "프라이팬",
    ],
    checks: [
      {
        id: "nonstick_coating_intact",
        questionKo: "(논스틱) 코팅이 긁힘/벗겨짐 없이 온전한가요?",
        buyerAskKo:
          "For nonstick — should the agent require an intact coating (not scratched/flaking)?",
        enforcement: "hard",
        answerHints: [
          "코팅",
          "nonstick",
          "논스틱",
          "긁힘",
          "scratched",
          "flaking",
          "벗겨짐",
          "teflon",
          "ptfe",
        ],
        answerOptions: [
          {
            label: "Intact coating",
            stance: "nonstick coating intact, not scratched",
            requirement: "required",
          },
          {
            label: "Not applicable",
            stance: "not nonstick / no coating concern",
            requirement: "optional",
          },
        ],
        sellerAsk: "Nonstick coating?",
        sellerOptions: [
          { label: "Intact", stance: "coating intact, not scratched", requirement: "required" },
          {
            label: "Scratched / N-A",
            stance: "scratched/flaking or not nonstick",
            requirement: "required",
          },
        ],
      },
      {
        id: "cookware_crack_chip",
        questionKo: "(세라믹/유리/법랑) 균열/깨짐이 없나요?",
        buyerAskKo: "For ceramic/glass/enamel — should the agent require no cracks/chips?",
        enforcement: "hard",
        answerHints: ["균열", "cracked", "깨짐", "chip", "chipped", "enamel", "법랑", "유리"],
        answerOptions: [
          { label: "No cracks/chips", stance: "no cracks or chips", requirement: "required" },
          { label: "Not applicable", stance: "metal / no crack concern", requirement: "optional" },
        ],
        sellerAsk: "Cracks / chips?",
        sellerOptions: [
          { label: "None", stance: "no cracks or chips", requirement: "required" },
          { label: "Has / N-A", stance: "cracked/chipped or metal", requirement: "required" },
        ],
      },
    ],
  },
  {
    path: "pet-supplies",
    // No bare "crate" (milk-crate / Crate guitar amp) — use dog-crate/pet-crate.
    aliases: [
      "pet",
      "pet-supplies",
      "aquarium",
      "dog-crate",
      "pet-crate",
      "terrarium",
      "반려동물",
      "수족관",
      "케이지",
    ],
    checks: [
      {
        id: "pet_sanitizable",
        questionKo: "완전 소독이 가능한 재질(다공성/오염 아님)인가요?",
        buyerAskKo:
          "Should the agent require an item that can be fully sanitized (non-porous, no disease risk)?",
        enforcement: "hard",
        answerHints: [
          "소독",
          "sanitize",
          "disinfect",
          "다공성",
          "porous",
          "질병",
          "parasite",
          "기생충",
          "위생",
        ],
        answerOptions: [
          {
            label: "Require sanitizable",
            stance: "fully sanitizable, no disease/parasite risk",
            requirement: "required",
          },
          { label: "Not required", stance: "no hygiene preference", requirement: "optional" },
        ],
        sellerAsk: "Sanitizable / hygiene?",
        sellerOptions: [
          {
            label: "Sanitizable",
            stance: "non-porous, fully sanitizable",
            requirement: "required",
          },
          {
            label: "Porous / unknown",
            stance: "porous or hygiene unknown",
            requirement: "required",
          },
        ],
      },
      {
        id: "pet_structural_leak",
        questionKo: "(크레이트/수족관) 구조 파손/누수가 없나요?",
        buyerAskKo: "For crates/tanks — should the agent require no cracks / leaks (secure)?",
        enforcement: "hard",
        answerHints: [
          "크레이트",
          "crate",
          "수족관",
          "aquarium",
          "누수",
          "leak",
          "균열",
          "crack",
          "latch",
          "seal",
        ],
        answerOptions: [
          {
            label: "Require sound",
            stance: "structurally sound, no cracks/leaks",
            requirement: "required",
          },
          { label: "Not applicable", stance: "no structural concern", requirement: "optional" },
        ],
        sellerAsk: "Structure / leaks?",
        sellerOptions: [
          { label: "Sound", stance: "no cracks/leaks, secure", requirement: "required" },
          { label: "Cracked / leaks", stance: "cracked or leaking", requirement: "required" },
        ],
      },
    ],
  },
  {
    // Leaf "outdoor-power" (not "garden") — the engine/gas gates should only hit
    // mowers/grills, not a generic "garden-hose"/"garden-tool".
    path: "outdoor-power",
    // Bare "grill" is an inference stopword (car grill / grillz), so BBQ grills are
    // reached through the unambiguous multi-word forms.
    aliases: [
      "lawnmower",
      "mower",
      "grill",
      "gas-grill",
      "charcoal-grill",
      "bbq-grill",
      "bbq",
      "잔디깎이",
      "그릴",
      "바베큐",
    ],
    checks: [
      {
        id: "small_engine_runs",
        questionKo: "(엔진 장비) 시동이 걸리고 부하에서 정상 작동하나요?",
        buyerAskKo:
          "For engine equipment — should the agent require it to start and run under load?",
        enforcement: "hard",
        answerHints: [
          "시동",
          "starts",
          "엔진",
          "engine",
          "compression",
          "runs",
          "안 걸림",
          "surging",
          "smoke",
        ],
        answerOptions: [
          {
            label: "Must start & run",
            stance: "starts and runs under load",
            requirement: "required",
          },
          {
            label: "For-parts OK",
            stance: "hard-start / not running acceptable",
            requirement: "optional",
          },
        ],
        sellerAsk: "Engine starts & runs?",
        sellerOptions: [
          { label: "Runs well", stance: "starts easily, runs under load", requirement: "required" },
          {
            label: "Hard start / dead",
            stance: "hard to start or won't run",
            requirement: "required",
          },
        ],
      },
      {
        id: "grill_gas_rust_safe",
        questionKo: "(가스 그릴) 가스 누출/버너·화실 부식(구멍)이 없나요?",
        buyerAskKo:
          "For gas grills — should the agent require no gas leak / rusted-through burners/firebox?",
        enforcement: "hard",
        answerHints: [
          "가스 누출",
          "gas leak",
          "버너",
          "burner",
          "화실",
          "firebox",
          "rust",
          "부식",
          "rot",
        ],
        answerOptions: [
          {
            label: "Require safe",
            stance: "no gas leak, burners/firebox intact",
            requirement: "required",
          },
          {
            label: "Not applicable",
            stance: "not a gas grill / no concern",
            requirement: "optional",
          },
        ],
        sellerAsk: "Gas leak / rust-through?",
        sellerOptions: [
          { label: "Safe", stance: "no leak, no rust-through", requirement: "required" },
          {
            label: "Leak / rust",
            stance: "gas leak or rusted-through parts",
            requirement: "required",
          },
        ],
      },
    ],
  },
  {
    path: "books/textbook",
    aliases: ["textbook", "textbooks", "교재", "전공서적"],
    checks: [
      {
        id: "isbn_edition_match",
        questionKo: "요구되는 정확한 판(ISBN-13)과 일치하나요?",
        buyerAskKo: "Should the agent require the exact required edition (ISBN-13 match)?",
        enforcement: "hard",
        answerHints: ["isbn", "edition", "판", "쇄", "13-digit", "international edition", "국제판"],
        answerOptions: [
          {
            label: "Exact edition only",
            stance: "exact required edition (ISBN match)",
            requirement: "required",
          },
          { label: "Any edition OK", stance: "any edition acceptable", requirement: "optional" },
        ],
        sellerAsk: "Edition / ISBN?",
        sellerOptions: [
          {
            label: "State ISBN/edition",
            stance: "edition/ISBN as described",
            requirement: "required",
          },
        ],
      },
      {
        id: "access_code_included",
        questionKo: "온라인 접속 코드(MyLab/Connect 등)가 미사용으로 포함되나요?",
        buyerAskKo: "Do you require an unused online access code (MyLab/Connect)?",
        enforcement: "soft",
      },
    ],
  },
];

const BY_PATH: ReadonlyMap<string, CategoryNode> = new Map(
  CATEGORY_TAXONOMY.map((n) => [n.path, n]),
);

/** All ancestor paths of a path, broadest first (inclusive of the path itself). */
function pathChain(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** Look up a single node by exact path. */
export function getCategoryNode(path: string): CategoryNode | undefined {
  return BY_PATH.get(path);
}

/** Every check id defined anywhere in the taxonomy. */
const ALL_CHECK_IDS: ReadonlySet<string> = new Set(
  CATEGORY_TAXONOMY.flatMap((n) => n.checks.map((c) => c.id)),
);

/**
 * Whether an id is a real taxonomy check id. Lets consumers reject fabricated
 * check ids (e.g. a client-supplied criterion that never went through the
 * deterministic scaffold) before persisting or trusting them.
 */
export function isTaxonomyCheckId(id: string): boolean {
  return ALL_CHECK_IDS.has(id);
}

/**
 * Resolve the category node paths a set of item tags match, broadest ancestor
 * first (each matched node contributes its own path plus every ancestor's).
 *
 * A node matches if any tag — or a token of a hyphenated/spaced tag — equals the
 * node's exact path, its leaf segment, or an alias. Tokenizing is essential for
 * real listings: production tags look like "iphone-15-pro" / "space-black", so the
 * "iphone" token must still match the iphone node (otherwise real phones would lose
 * their IMEI/battery checks).
 *
 * Exposed so the dynamic-learning overlay (resolveChecksWithLearned) can decide
 * which learned checks apply to a tag set with the same matching + inheritance rules.
 */
/**
 * Leaves/aliases that are ordinary English words. Matching them from a *token* of a
 * longer hyphenated tag ("dead-pixel", "no-dead-pixel") would open the wrong node's
 * HARD gates. These only match as an exact whole tag or a model-child prefix
 * ("pixel-8-pro"), plus any non-ambiguous multi-word alias ("google-pixel").
 * Kept in sync with inference GENERIC_STOPWORDS that are also taxonomy leaves.
 */
const AMBIGUOUS_MATCH_TOKENS = new Set(["pixel"]);

/** Model-child tag: "pixel-8-pro" for leaf "pixel"; not "dead-pixel". */
function isAmbiguousModelChildTag(tag: string, token: string): boolean {
  if (token.length < 3 || !tag.startsWith(`${token}-`)) return false;
  const rest = tag.slice(token.length + 1);
  if (!rest) return false;
  // Require a digit somewhere in the suffix — real Pixel/Galaxy model tags.
  return /\d/.test(rest);
}

function ambiguousTokenHit(wholeTags: ReadonlySet<string>, token: string): boolean {
  for (const tag of wholeTags) {
    if (tag === token || isAmbiguousModelChildTag(tag, token)) return true;
  }
  return false;
}

export function matchedCategoryPaths(tags: readonly string[]): string[] {
  const candidates = new Set<string>();
  const wholeTags = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    wholeTags.add(t);
    candidates.add(t); // whole tag (preserves path-form tags like "electronics/phones")
    for (const seg of t.split(/[\s-]+/)) {
      if (seg) candidates.add(seg); // tokens of hyphenated/spaced tags
    }
  }

  const matchedPaths = new Set<string>();
  for (const node of CATEGORY_TAXONOMY) {
    const leaf = node.path.split("/").pop() ?? node.path;
    const leafHit = AMBIGUOUS_MATCH_TOKENS.has(leaf)
      ? ambiguousTokenHit(wholeTags, leaf)
      : candidates.has(leaf);
    const aliasHit =
      node.aliases?.some((a) => {
        const alias = a.trim().toLowerCase();
        if (!alias) return false;
        if (AMBIGUOUS_MATCH_TOKENS.has(alias)) return ambiguousTokenHit(wholeTags, alias);
        // Multi-word / hyphenated aliases match as whole tags or exact candidate terms.
        return candidates.has(alias) || wholeTags.has(alias);
      }) ?? false;
    const hit = candidates.has(node.path) || leafHit || aliasHit;
    if (hit) {
      for (const p of pathChain(node.path)) matchedPaths.add(p);
    }
  }

  return [...matchedPaths].sort((a, b) => a.split("/").length - b.split("/").length);
}

/**
 * Resolve the negotiation checks for a set of item tags, with hierarchical
 * inheritance: a matched node contributes its own checks plus every ancestor's.
 * Deduped by check id (broadest ancestor first).
 */
export function resolveChecks(tags: readonly string[]): NegotiationCheck[] {
  const ordered = matchedCategoryPaths(tags);
  const seen = new Set<string>();
  const out: NegotiationCheck[] = [];
  for (const p of ordered) {
    const node = BY_PATH.get(p);
    if (!node) continue;
    for (const c of node.checks) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}
