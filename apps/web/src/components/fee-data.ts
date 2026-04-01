/**
 * Marketplace fee + shipping comparison data — accurate as of March 2026.
 * Sources: official fee pages, shipping rate cards.
 * Pure functions, no side effects.
 */

/* ── Types ─────────────────────────────────── */

export interface PlatformResult {
  platformName: string;
  color: string;
  // Seller side
  sellingFee: number;
  paymentFee: number;
  totalFee: number;
  feePercent: number;
  sellerShippingCost: number;   // seller pays for shipping (label, etc.)
  sellerNet: number;            // what seller actually keeps
  // Buyer side
  buyerItemPrice: number;       // price buyer pays for the item
  buyerShippingCost: number;    // shipping buyer pays
  buyerProtectionFee: number;   // buyer-side platform fee (Mercari, etc.)
  buyerTotalCost: number;       // total out-of-pocket for buyer
  // Shipping info
  shippingModel: string;        // human-readable description
  shippingNote?: string;
  // Negotiation
  negotiable: boolean;
  negotiableItems: string[];
}

export interface WeightTier {
  label: string;
  lbs: number;
}

/* ── Shipping Weight Tiers ───────────────── */

export const WEIGHT_TIERS: WeightTier[] = [
  { label: "< 1 lb (phone, small item)", lbs: 0.5 },
  { label: "1-3 lbs (laptop, tablet)", lbs: 2 },
  { label: "3-5 lbs (console, monitor)", lbs: 4 },
  { label: "5-10 lbs (desktop, TV)", lbs: 7 },
];

// Approximate USPS Ground Advantage rates (2026, domestic US)
function uspsRate(lbs: number): number {
  if (lbs <= 1) return 4.50;
  if (lbs <= 2) return 5.50;
  if (lbs <= 3) return 6.50;
  if (lbs <= 5) return 8.00;
  if (lbs <= 7) return 10.00;
  if (lbs <= 10) return 13.00;
  return 16.00;
}

// EasyPost commercial rate (approx 40-60% of retail)
function easyPostRate(lbs: number): number {
  return uspsRate(lbs) * 0.6; // ~40% discount
}

/* ── Platform Definitions ────────────────── */

// eBay Final Value Fee rates by category (2026)
const EBAY_FVF: Record<string, number> = {
  electronics: 0.1325, fashion: 0.1325, sneakers: 0.1325,
  collectibles: 0.1325, musical_instruments: 0.06, general: 0.1325,
};

interface PlatformCalc {
  name: string;
  color: string;
  calc: (price: number, cat: string, weightLbs: number) => Omit<PlatformResult, "platformName" | "color">;
}

const PLATFORMS: Record<string, PlatformCalc> = {
  ebay: {
    name: "eBay",
    color: "#e53e3e",
    calc: (price, cat, lbs) => {
      const fvf = price * (EBAY_FVF[cat] ?? 0.1325);
      const payment = price * 0.0235 + 0.30;
      const totalFee = fvf + payment;
      // eBay: seller sets shipping, often "free shipping" (seller absorbs)
      // or buyer pays. Most common: seller offers free shipping + builds into price.
      // With eBay labels: ~20-40% discount off retail USPS
      const ebayLabelRate = uspsRate(lbs) * 0.7;
      return {
        sellingFee: fvf, paymentFee: payment, totalFee, feePercent: (totalFee / price) * 100,
        sellerShippingCost: ebayLabelRate, // seller pays label
        sellerNet: price - totalFee - ebayLabelRate,
        buyerItemPrice: price,
        buyerShippingCost: 0, // "free shipping" most common for electronics
        buyerProtectionFee: 0,
        buyerTotalCost: price, // buyer pays listing price (shipping "free")
        shippingModel: "Free shipping (seller pays via eBay label)",
        shippingNote: `eBay label: ~$${ebayLabelRate.toFixed(2)} (30% discount)`,
        negotiable: false, negotiableItems: [],
      };
    },
  },

  poshmark: {
    name: "Poshmark",
    color: "#b91c1c",
    calc: (price, _cat, _lbs) => {
      const fee = price >= 15 ? price * 0.20 : 2.95;
      // Poshmark: flat $8.27 prepaid USPS Priority Mail label (up to 5lbs)
      // Buyer always pays $8.27 shipping. Seller ships free (label provided).
      const buyerShip = 8.27;
      return {
        sellingFee: fee, paymentFee: 0, totalFee: fee, feePercent: (fee / price) * 100,
        sellerShippingCost: 0, // Poshmark provides free label
        sellerNet: price - fee,
        buyerItemPrice: price,
        buyerShippingCost: buyerShip,
        buyerProtectionFee: 0,
        buyerTotalCost: price + buyerShip,
        shippingModel: "Flat $8.27 (buyer pays, USPS Priority, up to 5lbs)",
        shippingNote: "Over 5lbs: $8.27 + surcharge",
        negotiable: false, negotiableItems: [],
      };
    },
  },

  mercari: {
    name: "Mercari",
    color: "#dc2626",
    calc: (price, _cat, lbs) => {
      const fee = price * 0.10;
      // Mercari: seller chooses who pays shipping. Discounted labels available (~54% off)
      // Buyer also pays 3.6% "buyer protection fee" on item + shipping
      const mercariLabel = uspsRate(lbs) * 0.54;
      const buyerProtection = price * 0.036;
      return {
        sellingFee: fee, paymentFee: 0, totalFee: fee, feePercent: (fee / price) * 100,
        sellerShippingCost: mercariLabel, // typical: seller pays
        sellerNet: price - fee - mercariLabel,
        buyerItemPrice: price,
        buyerShippingCost: 0, // most sellers offer "free shipping"
        buyerProtectionFee: buyerProtection,
        buyerTotalCost: price + buyerProtection,
        shippingModel: "Seller pays (Mercari label ~54% off USPS)",
        shippingNote: `Label: ~$${mercariLabel.toFixed(2)} + buyer pays 3.6% protection`,
        negotiable: false, negotiableItems: [],
      };
    },
  },

  stockx: {
    name: "StockX",
    color: "#059669",
    calc: (price, _cat, lbs) => {
      const sellFee = price * 0.09;
      const payFee = price * 0.03;
      const totalFee = sellFee + payFee;
      // StockX: seller ships to StockX auth center (~$4-5 via UPS).
      // Buyer pays separate shipping ($8-15 depending on item).
      const sellerShip = 4.50;
      const buyerShip = lbs <= 3 ? 9.95 : 13.95;
      return {
        sellingFee: sellFee, paymentFee: payFee, totalFee, feePercent: (totalFee / price) * 100,
        sellerShippingCost: sellerShip,
        sellerNet: price - totalFee - sellerShip,
        buyerItemPrice: price,
        buyerShippingCost: buyerShip,
        buyerProtectionFee: 0,
        buyerTotalCost: price + buyerShip,
        shippingModel: "Seller → StockX → Buyer (authentication)",
        shippingNote: `Seller: ~$${sellerShip.toFixed(2)} to auth center. Buyer: $${buyerShip.toFixed(2)}`,
        negotiable: false, negotiableItems: [],
      };
    },
  },

  depop: {
    name: "Depop",
    color: "#f97316",
    calc: (price, _cat, lbs) => {
      const payFee = price * 0.033 + 0.45;
      // Depop: seller sets shipping. Depop labels or own shipping.
      // No built-in discount. Typical: USPS retail or similar.
      const shipCost = uspsRate(lbs);
      return {
        sellingFee: 0, paymentFee: payFee, totalFee: payFee, feePercent: (payFee / price) * 100,
        sellerShippingCost: shipCost, // seller typically pays
        sellerNet: price - payFee - shipCost,
        buyerItemPrice: price,
        buyerShippingCost: 0,
        buyerProtectionFee: 0,
        buyerTotalCost: price,
        shippingModel: "Seller pays (own label or Depop shipping)",
        shippingNote: `Retail USPS: ~$${shipCost.toFixed(2)} (no platform discount)`,
        negotiable: false, negotiableItems: [],
      };
    },
  },

  haggle: {
    name: "Haggle",
    color: "#06b6d4",
    calc: (price, _cat, lbs) => {
      const fee = price * 0.015;
      // Haggle: EasyPost commercial rates (~40-60% off retail)
      // Shipping cost is NEGOTIABLE between buyer and seller
      const shipCost = easyPostRate(lbs);
      // Default assumption: 50/50 split (but negotiable)
      const sellerShipShare = shipCost * 0.5;
      const buyerShipShare = shipCost * 0.5;
      return {
        sellingFee: fee, paymentFee: 0, totalFee: fee, feePercent: (fee / price) * 100,
        sellerShippingCost: sellerShipShare,
        sellerNet: price - fee - sellerShipShare,
        buyerItemPrice: price,
        buyerShippingCost: buyerShipShare,
        buyerProtectionFee: 0,
        buyerTotalCost: price + buyerShipShare,
        shippingModel: "Negotiable split (EasyPost ~40-60% off)",
        shippingNote: `EasyPost label: ~$${shipCost.toFixed(2)} total. Split is negotiable.`,
        negotiable: true,
        negotiableItems: ["Item price", "Shipping cost split (0-100%)", "Shipping method (USPS/UPS/FedEx)"],
      };
    },
  },
};

export const PLATFORM_ORDER = ["ebay", "poshmark", "mercari", "stockx", "depop", "haggle"] as const;

export const CATEGORIES = [
  { value: "electronics", label: "Electronics" },
  { value: "fashion", label: "Fashion & Apparel" },
  { value: "sneakers", label: "Sneakers & Streetwear" },
  { value: "collectibles", label: "Collectibles & Trading Cards" },
  { value: "general", label: "General / Other" },
] as const;

/* ── Public API ──────────────────────────── */

export function calculateAll(price: number, category: string, weightLbs: number): PlatformResult[] {
  if (price <= 0) return [];
  return PLATFORM_ORDER.map((key) => {
    const p = PLATFORMS[key];
    return { platformName: p.name, color: p.color, ...p.calc(price, category, weightLbs) };
  });
}

/** Haggle negotiation zone: buyer and seller can negotiate price within this range */
export function negotiationZone(listPrice: number, weightLbs: number) {
  const shipCost = easyPostRate(weightLbs);
  const fee = listPrice * 0.015;

  // Buyer's perspective: wants to pay less
  // Seller's perspective: wants to keep more
  // The "zone" where both benefit vs other platforms:
  const ebaySellerNet = listPrice - listPrice * 0.156 - 0.30 - uspsRate(weightLbs) * 0.7;
  const haggleMinSellerNet = ebaySellerNet; // seller won't go below what they'd get on eBay

  // Reverse: what price gives seller the same net as eBay?
  // sellerNet = price - price*0.015 - shipShare
  // At best for buyer: seller pays all shipping
  // haggleMinSellerNet = price * 0.985 - shipCost
  // price = (haggleMinSellerNet + shipCost) / 0.985
  const buyerBestPrice = Math.round((haggleMinSellerNet + shipCost) / 0.985);

  // Seller wants at least what they'd get on eBay, so list price is their upper ask
  const sellerAskPrice = listPrice;

  // Buyer's max: list price (no benefit vs eBay, but still saves on fees)
  // Buyer's ideal: buyerBestPrice where seller still matches eBay net
  return {
    sellerAsk: sellerAskPrice,
    buyerIdeal: Math.max(buyerBestPrice, Math.round(listPrice * 0.7)), // floor at 30% discount
    midpoint: Math.round((sellerAskPrice + buyerBestPrice) / 2),
    shippingCost: shipCost,
    haggleFeeAtMid: Math.round((sellerAskPrice + buyerBestPrice) / 2) * 0.015,
    ebaySellerNet: Math.round(ebaySellerNet),
    // What seller keeps at each price point on Haggle (seller pays shipping)
    sellerNetAtAsk: Math.round(sellerAskPrice * 0.985 - shipCost),
    sellerNetAtMid: Math.round(((sellerAskPrice + buyerBestPrice) / 2) * 0.985 - shipCost),
    sellerNetAtBuyerIdeal: Math.round(Math.max(buyerBestPrice, Math.round(listPrice * 0.7)) * 0.985 - shipCost),
  };
}

/** Backward compat */
export function calculateFees(price: number, category: string): PlatformResult[] {
  return calculateAll(price, category, 2);
}

export function calculateSavingsVsEbay(price: number, category: string) {
  const fees = calculateAll(price, category, 2);
  const ebay = fees.find(f => f.platformName === "eBay");
  const haggle = fees.find(f => f.platformName === "Haggle");
  if (!ebay || !haggle) return null;
  return {
    savedAmount: ebay.totalFee - haggle.totalFee,
    savedPercent: ((ebay.totalFee - haggle.totalFee) / ebay.totalFee) * 100,
    ebayNet: ebay.sellerNet,
    haggleNet: haggle.sellerNet,
  };
}

export function savingsAnalogy(amount: number): string {
  if (amount >= 5000) return "a used car down payment";
  if (amount >= 2000) return "a month of rent";
  if (amount >= 1000) return "a round-trip flight to Europe";
  if (amount >= 500) return "a new PS5 + games";
  if (amount >= 200) return "AirPods Pro";
  if (amount >= 100) return "a nice dinner for two";
  if (amount >= 50) return "a week of groceries";
  if (amount >= 20) return "a movie night";
  return "a cup of coffee";
}
