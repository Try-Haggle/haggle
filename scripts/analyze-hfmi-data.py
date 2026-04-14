#!/usr/bin/env python3
"""
HFMI Data Analysis: eBay Sold vs Haggle Seed Price Comparison
Analyzes iPhone Pro pricing data for Haggle Phase 0 calibration.
"""

from __future__ import annotations

import csv
import io
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
EBAY_CSV = SCRIPT_DIR / "ebay-sold-data.csv"
SEED_CSV = SCRIPT_DIR / "hfmi-seed.csv"
REPORT_PATH = SCRIPT_DIR / "hfmi-analysis-report.txt"

# ---------------------------------------------------------------------------
# Pure-stdlib statistics helpers (no numpy/pandas required)
# ---------------------------------------------------------------------------

def _median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _percentile(xs: list[float], p: float) -> float:
    """Linear interpolation percentile (same as numpy default)."""
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return 0.0
    if n == 1:
        return s[0]
    k = (n - 1) * p / 100.0
    f = int(k)
    c = f + 1 if f + 1 < n else f
    d = k - f
    return s[f] + d * (s[c] - s[f])


def _q1(xs: list[float]) -> float:
    return _percentile(xs, 25)


def _q3(xs: list[float]) -> float:
    return _percentile(xs, 75)


def _iqr(xs: list[float]) -> float:
    return _q3(xs) - _q1(xs)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_csv(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def parse_price(row: dict[str, str]) -> float | None:
    raw = row.get("observed_price_usd", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_battery(row: dict[str, str]) -> float | None:
    raw = row.get("battery_health_pct", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def fmt(v: float, decimals: int = 2) -> str:
    return f"{v:,.{decimals}f}"


def table_line(widths: list[int], char: str = "-") -> str:
    return "+" + "+".join(char * (w + 2) for w in widths) + "+"


def table_row(cells: list[str], widths: list[int]) -> str:
    parts = []
    for cell, w in zip(cells, widths):
        parts.append(f" {cell:<{w}} ")
    return "|" + "|".join(parts) + "|"


def print_table(headers: list[str], rows: list[list[str]], title: str = "") -> str:
    all_rows = [headers] + rows
    widths = [max(len(str(r[i])) for r in all_rows) for i in range(len(headers))]
    lines: list[str] = []
    if title:
        lines.append("")
        lines.append(f"  {title}")
        lines.append("")
    lines.append(table_line(widths, "-"))
    lines.append(table_row(headers, widths))
    lines.append(table_line(widths, "="))
    for row in rows:
        lines.append(table_row(row, widths))
    lines.append(table_line(widths, "-"))
    return "\n".join(lines)


MODEL_DISPLAY = {
    "iphone_13_pro": "iPhone 13 Pro",
    "iphone_13_pro_max": "iPhone 13 Pro Max",
    "iphone_14_pro": "iPhone 14 Pro",
    "iphone_14_pro_max": "iPhone 14 Pro Max",
    "iphone_15_pro": "iPhone 15 Pro",
    "iphone_15_pro_max": "iPhone 15 Pro Max",
}

MODEL_ORDER = [
    "iphone_13_pro",
    "iphone_13_pro_max",
    "iphone_14_pro",
    "iphone_14_pro_max",
    "iphone_15_pro",
    "iphone_15_pro_max",
]


def display_model(m: str) -> str:
    return MODEL_DISPLAY.get(m, m)


# ---------------------------------------------------------------------------
# Analysis routines
# ---------------------------------------------------------------------------

def compute_stats(prices: list[float]) -> dict[str, float]:
    if not prices:
        return {k: 0.0 for k in ["count", "mean", "median", "std", "min", "max", "q1", "q3", "iqr"]}
    return {
        "count": float(len(prices)),
        "mean": _mean(prices),
        "median": _median(prices),
        "std": _std(prices),
        "min": min(prices),
        "max": max(prices),
        "q1": _q1(prices),
        "q3": _q3(prices),
        "iqr": _iqr(prices),
    }


def group_prices(rows: list[dict[str, str]], key_fn) -> dict[Any, list[float]]:
    groups: dict[Any, list[float]] = defaultdict(list)
    for row in rows:
        price = parse_price(row)
        if price is not None:
            k = key_fn(row)
            if k is not None:
                groups[k].append(price)
    return dict(groups)


def detect_outliers_iqr(prices: list[float], factor: float = 1.5) -> list[float]:
    if len(prices) < 4:
        return []
    q1 = _q1(prices)
    q3 = _q3(prices)
    iqr = q3 - q1
    lo = q1 - factor * iqr
    hi = q3 + factor * iqr
    return sorted(p for p in prices if p < lo or p > hi)


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def run_analysis() -> str:
    output_parts: list[str] = []

    def section(text: str) -> None:
        output_parts.append(text)

    section("=" * 80)
    section("  HFMI DATA ANALYSIS: eBay Sold vs Haggle Seed Prices")
    section("  Generated for Haggle Phase 0 -- iPhone Pro pricing calibration")
    section("=" * 80)

    # Load data
    if not EBAY_CSV.exists():
        section(f"\nERROR: {EBAY_CSV} not found")
        return "\n".join(output_parts)
    if not SEED_CSV.exists():
        section(f"\nERROR: {SEED_CSV} not found")
        return "\n".join(output_parts)

    ebay_rows = load_csv(EBAY_CSV)
    seed_rows = load_csv(SEED_CSV)

    section(f"\n  Data loaded: {len(ebay_rows)} eBay sold records, {len(seed_rows)} seed records")

    # ------------------------------------------------------------------
    # 1. Per-model summary statistics
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [1] PER-MODEL SUMMARY STATISTICS")
    section("=" * 80)

    for source_label, rows in [("eBay Sold", ebay_rows), ("Haggle Seed", seed_rows)]:
        by_model = group_prices(rows, lambda r: r.get("model", ""))
        headers = ["Model", "N", "Mean", "Median", "Std", "Min", "Max", "IQR"]
        table_rows: list[list[str]] = []
        for model in MODEL_ORDER:
            prices = by_model.get(model, [])
            if not prices:
                continue
            s = compute_stats(prices)
            table_rows.append([
                display_model(model),
                str(int(s["count"])),
                fmt(s["mean"]),
                fmt(s["median"]),
                fmt(s["std"]),
                fmt(s["min"]),
                fmt(s["max"]),
                fmt(s["iqr"]),
            ])
        section(print_table(headers, table_rows, f"{source_label} -- Per-Model Stats"))

    # ------------------------------------------------------------------
    # 2. Per-model + storage median comparison
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [2] PER-MODEL + STORAGE: MEDIAN PRICE COMPARISON")
    section("=" * 80)

    ebay_by_ms = group_prices(ebay_rows, lambda r: (r.get("model", ""), r.get("storage_gb", "")))
    seed_by_ms = group_prices(seed_rows, lambda r: (r.get("model", ""), r.get("storage_gb", "")))

    all_keys = sorted(set(list(ebay_by_ms.keys()) + list(seed_by_ms.keys())))
    headers = ["Model", "Storage", "eBay N", "eBay Med", "Seed N", "Seed Med", "Delta", "Delta %"]
    table_rows = []
    for model, storage in all_keys:
        if model not in MODEL_ORDER:
            continue
        e_prices = ebay_by_ms.get((model, storage), [])
        s_prices = seed_by_ms.get((model, storage), [])
        e_med = _median(e_prices) if e_prices else None
        s_med = _median(s_prices) if s_prices else None
        delta = ""
        delta_pct = ""
        if e_med is not None and s_med is not None:
            d = s_med - e_med
            delta = fmt(d)
            delta_pct = fmt(d / e_med * 100, 1) + "%"
        table_rows.append([
            display_model(model),
            f"{storage}GB",
            str(len(e_prices)) if e_prices else "-",
            fmt(e_med) if e_med is not None else "-",
            str(len(s_prices)) if s_prices else "-",
            fmt(s_med) if s_med is not None else "-",
            delta if delta else "-",
            delta_pct if delta_pct else "-",
        ])
    section(print_table(headers, table_rows, "Median Price: eBay vs Seed (Delta = Seed - eBay)"))

    # ------------------------------------------------------------------
    # 3. Condition grade price distribution per model
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [3] CONDITION GRADE (A/B/C) PRICE DISTRIBUTION PER MODEL")
    section("=" * 80)

    for source_label, rows in [("eBay Sold", ebay_rows), ("Haggle Seed", seed_rows)]:
        by_mg = group_prices(rows, lambda r: (r.get("model", ""), r.get("cosmetic_grade", "")))
        headers = ["Model", "Grade", "N", "Median", "Mean", "Min", "Max"]
        table_rows = []
        for model in MODEL_ORDER:
            for grade in ["A", "B", "C"]:
                prices = by_mg.get((model, grade), [])
                if not prices:
                    continue
                s = compute_stats(prices)
                table_rows.append([
                    display_model(model),
                    grade,
                    str(int(s["count"])),
                    fmt(s["median"]),
                    fmt(s["mean"]),
                    fmt(s["min"]),
                    fmt(s["max"]),
                ])
        section(print_table(headers, table_rows, f"{source_label} -- Price by Cosmetic Grade"))

    # ------------------------------------------------------------------
    # 4. Price outlier detection (IQR method)
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [4] PRICE OUTLIER DETECTION (IQR x 1.5)")
    section("=" * 80)

    for source_label, rows in [("eBay Sold", ebay_rows), ("Haggle Seed", seed_rows)]:
        by_model = group_prices(rows, lambda r: r.get("model", ""))
        headers = ["Model", "Total", "Outliers", "Pct", "Outlier Prices"]
        table_rows = []
        for model in MODEL_ORDER:
            prices = by_model.get(model, [])
            if not prices:
                continue
            outliers = detect_outliers_iqr(prices)
            pct = len(outliers) / len(prices) * 100 if prices else 0
            outlier_str = ", ".join(fmt(o) for o in outliers[:8])
            if len(outliers) > 8:
                outlier_str += f" ... (+{len(outliers) - 8} more)"
            table_rows.append([
                display_model(model),
                str(len(prices)),
                str(len(outliers)),
                fmt(pct, 1) + "%",
                outlier_str if outlier_str else "none",
            ])
        section(print_table(headers, table_rows, f"{source_label} -- Outliers"))

    # ------------------------------------------------------------------
    # 5. Seed vs eBay realism comparison
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [5] SEED DATA REALISM CHECK: Are seed prices realistic?")
    section("=" * 80)

    ebay_by_model = group_prices(ebay_rows, lambda r: r.get("model", ""))
    seed_by_model = group_prices(seed_rows, lambda r: r.get("model", ""))

    headers = [
        "Model",
        "eBay Med", "eBay Std",
        "Seed Med", "Seed Std",
        "Med Delta", "Med Delta%",
        "Verdict",
    ]
    table_rows = []
    verdicts: list[str] = []

    for model in MODEL_ORDER:
        e = ebay_by_model.get(model, [])
        s = seed_by_model.get(model, [])
        if not e or not s:
            continue
        es = compute_stats(e)
        ss = compute_stats(s)
        d = ss["median"] - es["median"]
        d_pct = d / es["median"] * 100 if es["median"] else 0

        # Verdict logic: within 15% median AND similar variance
        abs_pct = abs(d_pct)
        std_ratio = ss["std"] / es["std"] if es["std"] > 0 else float("inf")
        if abs_pct <= 10 and 0.5 <= std_ratio <= 2.0:
            verdict = "REALISTIC"
        elif abs_pct <= 20 and 0.3 <= std_ratio <= 3.0:
            verdict = "ACCEPTABLE"
        else:
            verdict = "NEEDS REVIEW"

        verdicts.append(f"{display_model(model)}: {verdict} (delta {d_pct:+.1f}%, std ratio {std_ratio:.2f})")
        table_rows.append([
            display_model(model),
            fmt(es["median"]), fmt(es["std"]),
            fmt(ss["median"]), fmt(ss["std"]),
            fmt(d), fmt(d_pct, 1) + "%",
            verdict,
        ])

    section(print_table(headers, table_rows, "Seed vs eBay Realism (per-model)"))

    # Detailed narrative
    section("\n  Realism Verdict Summary:")
    for v in verdicts:
        section(f"    - {v}")

    # Storage-level comparison for deeper insight
    section("\n  Storage-level delta highlights (Seed median - eBay median):")
    for model, storage in sorted(all_keys):
        if model not in MODEL_ORDER:
            continue
        e_prices = ebay_by_ms.get((model, storage), [])
        s_prices = seed_by_ms.get((model, storage), [])
        if not e_prices or not s_prices:
            continue
        e_med = _median(e_prices)
        s_med = _median(s_prices)
        d = s_med - e_med
        d_pct = d / e_med * 100 if e_med else 0
        flag = " <<< LARGE DELTA" if abs(d_pct) > 20 else ""
        section(f"    {display_model(model)} {storage}GB: eBay ${fmt(e_med)} vs Seed ${fmt(s_med)} "
                f"(delta {d_pct:+.1f}%){flag}")

    # ------------------------------------------------------------------
    # 6. Data quality
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [6] DATA QUALITY ASSESSMENT")
    section("=" * 80)

    for source_label, rows in [("eBay Sold", ebay_rows), ("Haggle Seed", seed_rows)]:
        total = len(rows)
        missing_battery = sum(1 for r in rows if not r.get("battery_health_pct", "").strip())
        missing_grade = sum(1 for r in rows if not r.get("cosmetic_grade", "").strip())
        missing_price = sum(1 for r in rows if parse_price(r) is None)

        section(f"\n  {source_label} ({total} records):")
        section(f"    Missing battery_health_pct : {missing_battery}/{total} ({missing_battery/total*100:.1f}%)")
        section(f"    Missing cosmetic_grade     : {missing_grade}/{total} ({missing_grade/total*100:.1f}%)")
        section(f"    Missing observed_price_usd  : {missing_price}/{total} ({missing_price/total*100:.1f}%)")

        # Storage distribution
        storage_counts: dict[str, int] = defaultdict(int)
        for r in rows:
            sg = r.get("storage_gb", "").strip()
            if sg:
                storage_counts[sg] += 1
        section(f"    Storage distribution:")
        for sg in sorted(storage_counts.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            pct = storage_counts[sg] / total * 100
            bar = "#" * int(pct / 2)
            section(f"      {sg:>5}GB : {storage_counts[sg]:>4} ({pct:5.1f}%) {bar}")

        # Grade distribution
        grade_counts: dict[str, int] = defaultdict(int)
        for r in rows:
            g = r.get("cosmetic_grade", "").strip()
            if g:
                grade_counts[g] += 1
        section(f"    Grade distribution:")
        for g in sorted(grade_counts.keys()):
            pct = grade_counts[g] / total * 100
            bar = "#" * int(pct / 2)
            section(f"      Grade {g} : {grade_counts[g]:>4} ({pct:5.1f}%) {bar}")

        # Carrier lock distribution
        lock_counts: dict[str, int] = defaultdict(int)
        for r in rows:
            lk = r.get("carrier_locked", "").strip().lower()
            if lk:
                lock_counts[lk] += 1
        section(f"    Carrier lock distribution:")
        for lk in sorted(lock_counts.keys()):
            pct = lock_counts[lk] / total * 100
            section(f"      {lk:>8} : {lock_counts[lk]:>4} ({pct:5.1f}%)")

    # ------------------------------------------------------------------
    # 7. Key takeaways
    # ------------------------------------------------------------------
    section("\n" + "=" * 80)
    section("  [7] KEY TAKEAWAYS FOR HAGGLE PHASE 0")
    section("=" * 80)

    # Compute overall medians
    all_ebay_prices = [parse_price(r) for r in ebay_rows]
    all_ebay_prices = [p for p in all_ebay_prices if p is not None]
    all_seed_prices = [parse_price(r) for r in seed_rows]
    all_seed_prices = [p for p in all_seed_prices if p is not None]

    section(f"\n  Overall eBay median : ${fmt(_median(all_ebay_prices))}")
    section(f"  Overall Seed median : ${fmt(_median(all_seed_prices))}")
    section(f"  Overall delta       : ${fmt(_median(all_seed_prices) - _median(all_ebay_prices))}")

    # Battery data gap
    ebay_missing_bat = sum(1 for r in ebay_rows if not r.get("battery_health_pct", "").strip())
    section(f"\n  Battery health data gap in eBay: {ebay_missing_bat}/{len(ebay_rows)} "
            f"({ebay_missing_bat/len(ebay_rows)*100:.1f}%) missing")
    section("    -> Seed data has 100% battery health coverage")
    section("    -> eBay listings rarely report battery health; this is a pricing blind spot")

    # Variance comparison
    section(f"\n  eBay price std (overall): ${fmt(_std(all_ebay_prices))}")
    section(f"  Seed price std (overall): ${fmt(_std(all_seed_prices))}")
    if _std(all_ebay_prices) > _std(all_seed_prices) * 1.3:
        section("    -> eBay has notably HIGHER price variance than seed data")
        section("    -> Seed data may underestimate real market spread")
    elif _std(all_seed_prices) > _std(all_ebay_prices) * 1.3:
        section("    -> Seed data has notably HIGHER variance than eBay")
    else:
        section("    -> Variance is comparable between datasets")

    # Outlier summary
    total_ebay_outliers = 0
    total_ebay = 0
    for model in MODEL_ORDER:
        prices = ebay_by_model.get(model, [])
        total_ebay += len(prices)
        total_ebay_outliers += len(detect_outliers_iqr(prices))
    section(f"\n  eBay outlier rate: {total_ebay_outliers}/{total_ebay} "
            f"({total_ebay_outliers/total_ebay*100:.1f}%)")
    section("    -> Consider filtering outliers before using eBay data for HFMI calibration")

    section("\n" + "=" * 80)
    section("  END OF REPORT")
    section("=" * 80)

    return "\n".join(output_parts)


def main() -> None:
    report = run_analysis()
    print(report)

    # Save report
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report)
        f.write("\n")
    print(f"\n  Report saved to: {REPORT_PATH}")


if __name__ == "__main__":
    main()
