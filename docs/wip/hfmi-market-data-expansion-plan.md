# HFMI Market Data Expansion Plan

Status: WIP
Updated: 2026-04-28
Scope: Electronics hardening, then shoes, apparel, and bags expansion

## Purpose

HFMI should become a category-aware market data layer, not a single electronics price table. The goal is to collect public completed-transaction signals, normalize them into Haggle's fee and attribute model, and use them as a reference layer until Haggle's own completed transactions become the primary source.

This plan keeps the current electronics work moving while creating a controlled path for fashion categories. The key rule is that each category needs its own attribute schema, condition normalization, authenticity handling, and quality gates before it can influence negotiation or public pricing.

## Current Electronics Baseline

The current eBay electronics collector now covers 59 target queries:

| Category | Targets |
|---|---:|
| Smartphones | 31 |
| Laptops | 8 |
| Tablets | 6 |
| Gaming | 8 |
| Audio | 6 |

The collector is scheduled daily and writes:

- `observed_price_usd`: completed eBay transaction price
- `adjusted_price_usd`: price normalized from eBay category fee to Haggle's 1.5% fee structure
- `external_id`: stable eBay item id when available
- `raw_payload`: audit metadata such as item URL, condition source, condition confidence, and carrier-lock confidence

Recent test results show the shape of the data after filtering:

| Target | Raw | Valid | Observed range |
|---|---:|---:|---:|
| `galaxy_s25_ultra` | 241 | 238 | $350-$1500 |
| `macbook_air_13_m4` | 241 | 156 | $333-$1800 |
| `ipad_pro_13_m4` | 242 | 223 | $350-$1998 |
| `ps5_disc` | 241 | 213 | $123-$810 |
| `sony_wh1000xm5` | 242 | 110 | $55-$270 |

Page expansion test:

| Target | Pages | Raw | Valid | Duplicate external ids |
|---|---:|---:|---:|---:|
| `iphone_13_pro` | 4 | 964 | 300 | 0 |

## Electronics Hardening Plan

### 1. Keep Data Quality Metadata

Do not collapse uncertain fields into false certainty. Keep the current metadata in `raw_payload`:

- `condition_source`
- `condition_confidence`
- `condition_reasons`
- `carrier_lock_status`
- `carrier_lock_confidence`
- `item_url`
- `category`
- `title`

The model can still use the existing columns, but downstream analytics should be able to inspect why a row was classified.

### 2. Add Category-Level Price Floors

Electronics data is vulnerable to accessories and replacement parts. Keep category-specific minimum price floors:

| Category | Current floor |
|---|---:|
| Smartphones | $80 |
| Laptops | $250 |
| Tablets | $180 |
| Gaming | $120 |
| Audio | $50 |

Audio remains the most ambiguous category because damaged but functional headphones can sell below $100. If HFMI needs a cleaner public median, raise audio to $80-$100 and retain lower-priced rows only as low-confidence internal evidence.

### 3. Maintain Model Guards

Each target model needs a title compatibility guard. This prevents cross-model contamination such as:

- `iphone_13_pro` receiving `iphone_13_pro_max`
- `pixel_9_pro` receiving `pixel_9_pro_xl`
- `ps5_disc` receiving standalone disc drives or console covers
- `macbook_air_13_m4` receiving sleeves, hubs, cables, or trackpad parts

The guard should stay conservative. It is better to lose a marginal row than to fit a price model on the wrong item.

### 4. Keep Stable Dedupe

Use stable provider item id when available. If not available, use a deterministic fingerprint from:

- normalized model
- title
- price
- completed date

The collector should dedupe before writing CSV/SQL so summary counts reflect actual unique observations.

### 5. Separate Display Confidence From Model Weight

HFMI should track at least three levels:

| Confidence | Meaning | Use |
|---|---|---|
| High | exact model, normal item, clear condition | public median and model fitting |
| Medium | exact model, weak condition signal | model fitting with lower weight |
| Low | possible defect, ambiguous condition, weak category match | internal analysis only |

The current DB schema can hold this in `raw_payload`. A later migration can promote these fields if they become core query dimensions.

## Expansion Principle

Shoes, apparel, and bags should not reuse the electronics schema directly. They need their own domain-specific normalization. Shared HFMI concepts should remain:

- source
- category
- brand
- normalized product family
- observed price
- adjusted price
- observed date
- provider item id
- condition grade
- confidence metadata
- raw evidence payload

Category-specific attributes should live in `raw_payload` first, then graduate into typed columns only after we know which fields are stable.

## Shoes Plan

### Required Attributes

| Attribute | Examples | Notes |
|---|---|---|
| Brand | Nike, Jordan, Adidas, New Balance | Normalize aliases |
| Model family | Air Jordan 1, Dunk Low, Yeezy 350 | Must be explicit |
| Variant/colorway | Chicago, Panda, Bred, Lost and Found | Critical price driver |
| Size | US 9, US 10.5 | Must normalize men/women/youth |
| Gender sizing | men, women, GS, youth | Prevent size mismatch |
| Condition | new, used, worn once, VNDS | Category-specific grading |
| Box status | original box, no box, replacement box | Strong price signal |
| Authenticity signal | authenticity guaranteed, receipt, tag, suspicious keywords | High impact |

### Initial Target Families

Start with high-volume, high-recognition items:

- Air Jordan 1 High OG
- Nike Dunk Low
- Adidas Yeezy 350
- New Balance 550
- Nike Air Force 1

### Quality Gates

Do not fit public HFMI until:

- at least 100 high-confidence observations per product family
- at least 30 observations per common size bucket
- authenticity-risk rows are excluded or separately marked
- no-size rows are excluded from public medians

## Apparel Plan

### Required Attributes

| Attribute | Examples | Notes |
|---|---|---|
| Brand | Patagonia, Arc'teryx, Supreme, Lululemon | Brand normalization is required |
| Product type | jacket, hoodie, shirt, pants | Different price curves |
| Line/model | Beta AR, Nano Puff, Box Logo Hoodie | Important for premium brands |
| Size | XS-XXL, numeric waist/inseam | Normalize by category |
| Gender/fit | men's, women's, unisex, slim, relaxed | Affects comparability |
| Material | Gore-Tex, down, cashmere, leather | Price signal |
| Condition | NWT, NWOT, excellent, worn, stains | Domain-specific |
| Season/year | FW23, SS24, vintage | Optional but valuable |

### Initial Target Families

Start with categories that have clearer model names:

- Arc'teryx Beta / Alpha shells
- Patagonia Nano Puff / Down Sweater
- Lululemon Align / ABC Pants
- Supreme Box Logo hoodies
- The North Face Nuptse jackets

### Quality Gates

Do not fit public HFMI until:

- product type and brand are both high-confidence
- size is present for size-sensitive items
- condition has at least medium confidence
- stain/damage rows are excluded or marked low-confidence

## Bags Plan

### Required Attributes

| Attribute | Examples | Notes |
|---|---|---|
| Brand | Louis Vuitton, Chanel, Gucci, Coach, Telfar | Normalize aliases |
| Model family | Neverfull, Classic Flap, Marmont, Shopping Bag | Primary identity |
| Size | PM, MM, GM, small, medium, large | Major price driver |
| Material | canvas, leather, caviar, lambskin | Major price driver |
| Color | black, monogram, damier ebene | Important for luxury |
| Condition | excellent, good, fair, scuffs, stains | Needs strict terms |
| Inclusions | dust bag, box, receipt, authenticity card | Strong confidence signal |
| Authenticity signal | authenticated, serial, Entrupy, receipt, suspicious keywords | Must be tracked |

### Initial Target Families

Start with high-volume bags before rare luxury:

- Louis Vuitton Neverfull MM/GM
- Telfar Shopping Bag small/medium/large
- Gucci Marmont
- Coach Tabby
- Chanel Classic Flap only after authenticity handling is mature

### Quality Gates

Do not fit public HFMI until:

- model family and size are high-confidence
- authenticity-risk rows are separated
- material/color are normalized for premium brands
- obvious replicas, inspired items, charms, straps, dust bags, and receipts-only rows are excluded

## Shared Data Model Direction

Short term: keep using `hfmi_price_observations` with `raw_payload`.

Medium term: add a category-aware observation schema:

```text
hfmi_price_observations
  id
  source
  vertical              electronics | shoes | apparel | bags
  category              smartphones | sneakers | handbags | jackets ...
  brand
  model
  variant
  size_value
  size_system
  condition_grade
  condition_confidence
  authenticity_status   verified | likely | unknown | risky
  observed_price_usd
  adjusted_price_usd
  observed_at
  external_id
  raw_payload
```

The current electronics fields can map into this shape without breaking the existing HFMI service.

## Source Policy

Use only public market data sources or approved provider interfaces. Each source must have:

- documented collection method
- provider policy review
- request pacing
- clear dedupe key
- raw evidence retained for audit
- source-specific fee adjustment

Avoid building product decisions around a source until it has stable observations for at least two weeks.

## Implementation Phases

### Phase A: Electronics Stabilization

- Keep 59-target electronics collector
- Monitor daily output count and category distribution
- Add weekly quality review of low-confidence rows
- Decide whether audio floor should move from $50 to $80-$100
- Add dashboard summary for raw, valid, deduped, and low-confidence counts

### Phase B: Shoes Prototype

- Add a separate shoes collector, not mixed into electronics code
- Start with 5 product families
- Store category-specific fields in `raw_payload`
- Run manually first, then daily only after quality review
- No public HFMI output until quality gates pass

### Phase C: Apparel Prototype

- Start with structured model-name apparel categories
- Prioritize brands where model family is explicit
- Use stricter condition and damage filters than electronics
- Keep rows without size out of public medians

### Phase D: Bags Prototype

- Start with mid/high-volume models where size and model family are explicit
- Track authenticity status as a first-class quality field
- Exclude replicas, inspired items, accessories, straps, charms, dust bags, and receipts-only rows
- Public HFMI only after authenticity handling is reliable

## Open Decisions

- Should audio keep low-price functional-but-damaged rows as C-grade, or exclude them from public HFMI?
- Should fashion categories share the `A/B/C` condition grade, or use domain-specific grades and map to `A/B/C` only for display?
- Should authenticity status become a top-level DB column before bags launch?
- Should size normalization use a shared `size_system` table?
- Which category becomes the first non-electronics expansion: sneakers, apparel, or bags?

## Recommendation

Finish electronics stabilization first, then expand to shoes before apparel or bags. Shoes have clearer product identity than apparel and less authenticity complexity than luxury bags. Bags are strategically valuable, but they should wait until authenticity handling and evidence retention are mature.
