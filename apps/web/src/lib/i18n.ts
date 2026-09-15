/**
 * Display locale for the web app.
 *
 * Default is English. Add a locale by appending to `LOCALES` and `MESSAGES`.
 * Missing keys fall back to English, then to the key itself.
 * New user-visible copy should go through `t()` so later locales can land
 * without rewriting call sites.
 */

export const DEFAULT_LOCALE = "en";
export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "haggle-locale";

/** Native names in the language picker — not translated with `t()`. */
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

type MessageTree = {
  settings: {
    language: {
      title: string;
      hint: string;
      label: string;
    };
  };
  shipping: {
    addressConfirm: {
      prompt: string;
      useThis: string;
      useOther: string;
      usingSaved: string;
    };
  };
  checkout: {
    fullAgreement: {
      title: string;
      subtitle: string;
      price: string;
      address: string;
      fulfillment: string;
      fees: string;
      item: string;
      shipping: string;
      shippingNa: string;
      feeWallet: string;
      feeCard: string;
      buyerPaysWallet: string;
      buyerPaysCard: string;
      feeNote: string;
      criteria: string;
      criteriaNone: string;
      sellerValue: string;
      buyerAnswer: string;
      cta: string;
      changeHint: string;
      leave: string;
    };
  };
};

const en: MessageTree = {
  settings: {
    language: {
      title: "Language",
      hint: "This is the language of the Haggle website. It does not change how agents negotiate.",
      label: "Display language",
    },
  },
  shipping: {
    addressConfirm: {
      prompt: "Receive at this address?",
      useThis: "Use this address",
      useOther: "Use a different address",
      usingSaved: "Using your saved address",
    },
  },
  checkout: {
    fullAgreement: {
      title: "Confirm agreed terms",
      subtitle:
        "Review the full Soft deal before payment. Card or wallet opens only after you confirm.",
      price: "Agreed price",
      address: "Address",
      fulfillment: "Shipping / pickup",
      fees: "Fees and total",
      item: "Item",
      shipping: "Shipping",
      shippingNa: "N/A",
      feeWallet: "Haggle fee (wallet 1.5%)",
      feeCard: "Buyer fee (card 3.0%)",
      buyerPaysWallet: "Buyer pays (wallet)",
      buyerPaysCard: "Buyer pays (card)",
      feeNote:
        "Exact rail total is confirmed again on the next step before authorization. Seller net is rail-independent.",
      criteria: "Seller criteria",
      criteriaNone: "None for this listing",
      sellerValue: "Seller",
      buyerAnswer: "Your answer",
      cta: "Pay as agreed",
      changeHint: "Need to change a term?",
      leave: "Leave checkout",
    },
  },
};

/** Korean may omit keys; `t()` fills those from English. */
const ko: DeepPartial<MessageTree> = {
  settings: {
    language: {
      title: "언어",
      hint: "Haggle 웹사이트의 표시 언어입니다. 에이전트가 협상하는 방식은 바뀌지 않습니다.",
      label: "표시 언어",
    },
  },
  shipping: {
    addressConfirm: {
      prompt: "이 주소로 받을까요?",
      useThis: "이 주소로",
      useOther: "다른 곳으로",
      usingSaved: "저장된 주소로 받습니다",
    },
  },
  checkout: {
    fullAgreement: {
      title: "합의 내용 확인",
      subtitle: "결제 전에 Soft 합의 전체를 확인하세요. 카드/지갑은 확인 후에만 열립니다.",
      price: "합의 가격",
      address: "주소",
      fulfillment: "배송 / 픽업",
      fees: "수수료와 합계",
      item: "상품",
      shipping: "배송비",
      shippingNa: "해당 없음",
      feeWallet: "Haggle 수수료 (지갑 1.5%)",
      feeCard: "구매자 수수료 (카드 3.0%)",
      buyerPaysWallet: "구매자 결제액 (지갑)",
      buyerPaysCard: "구매자 결제액 (카드)",
      feeNote:
        "레일별 최종 금액은 다음 단계에서 다시 확인합니다. 판매자 수령액은 레일과 무관합니다.",
      criteria: "판매자 조건",
      criteriaNone: "이 리스팅에 해당 조건 없음",
      sellerValue: "판매자",
      buyerAnswer: "내 답변",
      cta: "이대로 결제",
      changeHint: "내용을 바꿔야 하나요?",
      leave: "결제 나가기",
    },
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const MESSAGES: Record<Locale, DeepPartial<MessageTree>> = { en, ko };

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ko";
}

function lookup(tree: unknown, path: string[]): unknown {
  let current = tree;
  for (const part of path) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function t(locale: Locale, key: string): string {
  const path = key.split(".").filter(Boolean);
  const fromLocale = lookup(MESSAGES[locale], path);
  if (typeof fromLocale === "string") return fromLocale;
  if (locale !== DEFAULT_LOCALE) {
    const fromDefault = lookup(MESSAGES[DEFAULT_LOCALE], path);
    if (typeof fromDefault === "string") return fromDefault;
  }
  return key;
}

export function readDocumentLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const fromDataset = document.documentElement.dataset.locale;
  if (isLocale(fromDataset)) return fromDataset;
  if (isLocale(document.documentElement.lang)) return document.documentElement.lang;
  return DEFAULT_LOCALE;
}

export function applyLocale(next: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = next;
  document.documentElement.dataset.locale = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // private mode / blocked storage
  }
}

/** Value for the `Accept-Language` request header. Default English. */
export function acceptLanguageHeader(locale: Locale = readDocumentLocale()): string {
  if (locale === DEFAULT_LOCALE) return DEFAULT_LOCALE;
  return `${locale},en;q=0.8`;
}
