"""
Tests for the 4 refinery engines.

Run with:  pytest tests/ -v

Includes explicit regression tests for the two real bugs found during
review of the original FORGED_V2_CORE.py, so they can never silently
come back:
  - test_currency_lowercase_rand   (bug #1: case-sensitive symbol strip)
  - test_sentinel_ignores_real_zero (bug #2: false-positive on $0/0%)
"""

import pandas as pd

from forged_finance.engines import (
    currency_engine, date_engine, text_clean_engine, percentage_engine,
    MISSING, INVALID_DATE, INVALID_PCT,
)
from forged_finance.sentinel import sentinel_scan


# ── CURRENCY ENGINE ──────────────────────────────────────────────

def test_currency_basic():
    assert currency_engine("$1,500") == 1500.0

def test_currency_parentheses_negative():
    assert currency_engine("(2,500)") == -2500.0

def test_currency_dr_cr():
    assert currency_engine("Dr 100") == 100.0
    assert currency_engine("Cr 200") == -200.0

def test_currency_suffix_multipliers():
    assert currency_engine("1.5M") == 1_500_000.0
    assert currency_engine("50k") == 50_000.0

def test_currency_european_format():
    assert currency_engine("1.234.567,89") == 1234567.89

def test_currency_null_values():
    assert currency_engine(None) == MISSING
    assert currency_engine("negotiable") == MISSING
    assert currency_engine("n/a") == MISSING

def test_currency_uppercase_rand():
    assert currency_engine("R100") == 100.0

def test_currency_lowercase_rand():
    """Regression test for bug #1: lowercase 'r' previously failed silently."""
    assert currency_engine("r100") == 100.0
    assert currency_engine("r1,500") == 1500.0


# ── DATE ENGINE ──────────────────────────────────────────────────

def test_date_iso():
    assert date_engine("2026-02-13") == "2026-02-13"

def test_date_day_first():
    assert date_engine("13/02/2026") == "2026-02-13"

def test_date_pre_1900_rejected():
    assert date_engine("1850-01-01") == INVALID_DATE

def test_date_null_values():
    assert date_engine(None) == MISSING
    assert date_engine("pending") == MISSING


# ── TEXT ENGINE ───────────────────────────────────────────────────

def test_text_preserves_financial_punctuation():
    assert text_clean_engine("R&D") == "R&D"
    assert text_clean_engine("revenue (net)") == "Revenue (Net)"

def test_text_null_values():
    assert text_clean_engine(None) == "UNKNOWN"
    assert text_clean_engine("n/a") == "UNKNOWN"


# ── PERCENTAGE ENGINE ─────────────────────────────────────────────

def test_percentage_basic():
    assert percentage_engine("15%") == 0.15

def test_percentage_basis_points():
    assert percentage_engine("150bps") == 0.015

def test_percentage_high_flagged_not_destroyed():
    result = percentage_engine("250%")
    assert result == "HIGH_PCT_2.5"

def test_percentage_invalid():
    assert percentage_engine("50000%") == INVALID_PCT

def test_percentage_null_values():
    assert percentage_engine(None) == MISSING


# ── SENTINEL ──────────────────────────────────────────────────────

def test_sentinel_ignores_real_zero():
    """
    Regression test for bug #2: a genuine $0 transaction or 0% rate
    must NOT be counted as an anomaly. Only MISSING/INVALID/HIGH_PCT_
    markers should ever be flagged.
    """
    df = pd.DataFrame({
        "Amount": ["0", "100", "negotiable"],
    })
    mapped = {"Amount": "Currency / Finance"}
    df["Amount_Refined_Currency"] = df["Amount"].apply(currency_engine)

    issues = sentinel_scan(df, mapped)

    # Only the genuine "negotiable" -> MISSING should be flagged (1),
    # not the legitimate $0 value.
    assert issues.get("Amount_Refined_Currency") == 1

def test_sentinel_flags_high_pct():
    df = pd.DataFrame({"Rate": ["15%", "250%"]})
    mapped = {"Rate": "Percentage / Rate"}
    df["Rate_Refined_Pct"] = df["Rate"].apply(percentage_engine)

    issues = sentinel_scan(df, mapped)
    assert issues.get("Rate_Refined_Pct") == 1

def test_sentinel_clear_when_no_issues():
    df = pd.DataFrame({"Amount": ["100", "200"]})
    mapped = {"Amount": "Currency / Finance"}
    df["Amount_Refined_Currency"] = df["Amount"].apply(currency_engine)

    issues = sentinel_scan(df, mapped)
    assert issues == {}
