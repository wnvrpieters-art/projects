"""
FORGED FINANCE — THE 4 SPECIALIZED REFINERY ENGINES

This module has ZERO dependency on tkinter or any GUI code, on purpose:
- It can be imported by the GUI, the batch processor, or a future web/API
  version without ever needing a display.
- It can be unit tested in isolation (see tests/test_engines.py).

Bug fixes vs. the original FORGED_V2_CORE.py:
  1. currency_engine: currency-symbol stripping is now case-insensitive.
     "r100" (lowercase Rand) previously failed to parse and silently
     returned "MISSING" — it now parses correctly, same as "R100".
  2. Sentinel (see sentinel.py) no longer counts legitimate $0 / 0% values
     as anomalies — only genuine MISSING/INVALID flags count now.
"""

import re
import pandas as pd
from datetime import datetime


MISSING = "MISSING"
INVALID_DATE = "INVALID_DATE"
INVALID_PCT = "INVALID_PCT"


def currency_engine(value):
    """
    Full financial currency normalisation.
    - Preserves negatives (credits are real in finance)
    - Handles B/M/K suffixes
    - Parentheses accounting notation: (1,500) -> -1500
    - Dr/Cr labels strip with sign preserved
    - Extended written-number map
    - European format (1.234.567,89)
    - Returns float; "MISSING" for genuine nulls
    """
    if pd.isna(value):
        return MISSING
    s = str(value).strip()
    null_vals = {"nan", "none", "null", "n/a", "na", "#n/a", "###", "???", "error",
                 "", "  ", " ", "-", " - ", "missing", "tbd", "tbc", "unknown", "—", "–", "--"}
    if s.lower() in null_vals:
        return MISSING
    if any(x in s.lower() for x in ["negotiable", "market related", "competitive", "variable", "tbc", "tbd"]):
        return MISSING

    # Parentheses accounting notation: (1,500) -> -1500
    paren_negative = bool(re.match(r"^\((.+)\)$", s.strip()))
    if paren_negative:
        s = re.sub(r"[()]", "", s).strip()

    # Dr/Cr labels — strip but capture sign
    dr_cr_sign = 1.0
    if re.search(r"\b(cr|credit)\b", s, re.IGNORECASE):
        dr_cr_sign = -1.0
    s = re.sub(r"\b(dr|cr|debit|credit)\b", "", s, flags=re.IGNORECASE).strip()

    # Written-out numbers
    written = {
        "zero": 0, "nil": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "ten": 10, "twenty": 20, "fifty": 50, "hundred": 100,
        "one hundred": 100, "two hundred": 200, "five hundred": 500,
        "one thousand": 1000, "two thousand": 2000, "five thousand": 5000,
        "ten thousand": 10000, "fifty thousand": 50000,
        "one hundred thousand": 100000, "half a million": 500000,
        "one million": 1000000, "two million": 2000000, "five million": 5000000,
    }
    if s.lower().strip() in written:
        val = float(written[s.lower().strip()])
        return -val if paren_negative else val

    # Strip text noise and currency symbols
    s = re.sub(r"(approx\.?|paid|total|balance|amt|amount)", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(usd|zar|eur|gbp|cad|aud|jpy|cny|inr|brl|ngn|kes)\b", "", s, flags=re.IGNORECASE)
    # BUG FIX #1: was case-sensitive ([£$€¥₹R\s]) — "r100" (lowercase Rand)
    # silently failed to parse. Now case-insensitive so both R and r strip.
    s = re.sub(r"[£$€¥₹Rr\s]", "", s).strip()

    leading_minus = s.startswith("-")

    # European thousands: 1.234.567,89
    if re.match(r"^-?\d{1,3}(\.\d{3})+(,\d+)?$", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = re.sub(r",(?=\d{3}\b)", "", s)

    # Suffix multipliers B/M/K
    s_upper = s.upper().rstrip()
    try:
        if s_upper.endswith("B"):
            val = float(re.sub(r"[^\d\.\-]", "", s_upper[:-1])) * 1_000_000_000
        elif s_upper.endswith("M"):
            val = float(re.sub(r"[^\d\.\-]", "", s_upper[:-1])) * 1_000_000
        elif s_upper.endswith("K"):
            val = float(re.sub(r"[^\d\.\-]", "", s_upper[:-1])) * 1_000
        else:
            val = float(re.sub(r"[^\d\.\-]", "", s))
    except (ValueError, TypeError):
        return MISSING

    # Apply signs
    if paren_negative or (dr_cr_sign == -1.0 and val > 0):
        val = -abs(val)
    elif leading_minus:
        val = -abs(val)

    return round(val, 4)


def date_engine(value):
    """
    Translates ANY date format -> ISO 8601 (YYYY-MM-DD). Flags genuine failures.
    - Pre-1900 dates rejected (Excel artefacts common in finance)
    - Handles 'today', 'current', 'present', relative tokens -> MISSING
    - Extended format list including compact YYYYMMDD and 2-digit years
    """
    if pd.isna(value):
        return MISSING
    s = str(value).strip()
    null_vals = {"nan", "error", "n/a", "###", "???", "", "unknown", "n.a.", "tbd", "tbc",
                 "asap", "eom", "end of month", "eoy", "upon signing", "pending"}
    if s.lower() in null_vals:
        return MISSING
    if s.lower() in ("today", "current", "present", "ongoing"):
        return datetime.now().strftime("%Y-%m-%d")
    # Finance guard: reject pre-1900 (Excel date artefacts)
    if re.match(r"^1[0-8]\d{2}", s):
        return INVALID_DATE

    # Unambiguous ISO formats first
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            cleaned = s[:len(fmt)] if len(fmt) <= len(s) else s
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue

    # Day-first formats (common in SA and EU)
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y",
                "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
                "%m-%d-%Y", "%m/%d/%Y",
                "%d/%m/%y", "%d-%m-%y", "%d-%b-%y", "%m/%d/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue

    # Last resort — pandas
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return pd.to_datetime(s, errors="raise", dayfirst=True).strftime("%Y-%m-%d")
    except Exception:
        return INVALID_DATE


def text_clean_engine(value):
    """
    Safe text/category engine for financial fields.
    Preserves: apostrophes, ampersands, parentheses, slashes, dots.
    These are all legitimate in finance: R&D, Revenue (Net), Dr/Cr, Corp.
    """
    if pd.isna(value):
        return "UNKNOWN"
    s = str(value).strip()
    null_vals = {"nan", "error", "n/a", "###", "???", "", "none", "null", "unknown",
                 "tbd", "tbc", "missing", "n.a."}
    if s.lower() in null_vals:
        return "UNKNOWN"
    # Strip only genuinely unsafe chars — keep financial punctuation
    s = re.sub(r"[^a-zA-ZÀ-ÿ0-9\s\-\_\'\&\(\)\/\.]", "", s).strip()
    s = re.sub(r"\s+", " ", s).strip()
    return "UNKNOWN" if not s else s.title()


def percentage_engine(value):
    """
    Robust percentage normalisation for financial rates.
    - Output: decimal ratio (15% -> 0.15)
    - Handles basis points: '150bps' -> 0.015
    - Negative rates allowed (negative interest / deflation)
    - 100%-1000%: returns HIGH_PCT_[value] for review (markup, IRR, yield-on-cost)
    - >1000%: INVALID_PCT (genuinely garbage)
    """
    if pd.isna(value):
        return MISSING
    s = str(value).strip()
    null_vals = {"nan", "error", "n/a", "###", "???", "", "—", "–", "--", "missing", "tbd"}
    if s.lower() in null_vals:
        return MISSING

    # Basis points: 150bps -> 0.015
    bps_match = re.search(r"([\-\d\.]+)\s*bps?", s, re.IGNORECASE)
    if bps_match:
        try:
            return round(float(bps_match.group(1)) / 10000, 6)
        except (ValueError, TypeError):
            return INVALID_PCT

    has_pct_symbol = "%" in s
    s_clean = s.replace("%", "").strip()
    s_clean = re.sub(r"[^0-9\.\-]", "", s_clean)
    if not s_clean:
        return MISSING

    try:
        val = float(s_clean)
    except (ValueError, TypeError):
        return INVALID_PCT

    # Divide if whole-number percentage or has explicit % symbol
    if has_pct_symbol or abs(val) > 1.0:
        ratio = round(val / 100, 6)
    else:
        ratio = round(val, 6)

    # >+-1000%: garbage
    if abs(ratio) > 10.0:
        return INVALID_PCT

    # 100%-1000%: legitimate financial rates — flag but preserve
    if abs(ratio) > 1.0:
        return f"HIGH_PCT_{ratio}"

    return ratio


ENGINE_MAP = {
    "Currency / Finance": currency_engine,
    "Date / Time": date_engine,
    "Text / Category": text_clean_engine,
    "Percentage / Rate": percentage_engine,
}

ENGINE_SUFFIX = {
    "Currency / Finance": "_Refined_Currency",
    "Date / Time": "_Refined_Date",
    "Text / Category": "_Refined_Text",
    "Percentage / Rate": "_Refined_Pct",
}
