"""
FORGED FINANCE — THE SENTINEL

Scans refined output for genuine problems and writes the audit log.

Bug fix vs. the original: the old sentinel_scan() flagged every
literal 0.0 in a Currency/Percentage column as an "anomaly" — but a
$0 transaction or a 0% rate is often completely legitimate data, not
a failure. It now only counts the actual flag values the engines
produce (MISSING, INVALID_DATE, INVALID_PCT, UNKNOWN, or a HIGH_PCT_
prefix) — never a genuine zero.
"""

import os
import shutil
import logging
from datetime import datetime

from .paths import get_log_path, get_archive_dir
from .engines import MISSING, INVALID_DATE, INVALID_PCT

_FLAG_STRINGS = {MISSING, INVALID_DATE, INVALID_PCT, "UNKNOWN"}

logging.basicConfig(
    filename=get_log_path(),
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    encoding="utf-8",
)


def log_event(module_id, action, status):
    msg = f"MODULE::{module_id} | ACTION: {action} | STATUS: {status}"
    logging.info(msg)
    print(f"[FORGED::{module_id}] {action} — {status}")


def archive_outputs(files):
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    folder = os.path.join(get_archive_dir(), f"RUN_{ts}")
    os.makedirs(folder, exist_ok=True)
    for f in files:
        if os.path.exists(f):
            shutil.copy(f, os.path.join(folder, os.path.basename(f)))
    log_event("06", "ARCHIVE_CREATED", folder)
    return folder


def _is_flagged(value) -> bool:
    """True only for genuine engine failure/missing markers — never a real zero."""
    if not isinstance(value, str):
        return False
    if value in _FLAG_STRINGS:
        return True
    if value.startswith("HIGH_PCT_"):
        return True
    return False


def sentinel_scan(df, mapped_cols):
    """
    Counts real anomalies (MISSING / INVALID_ / UNKNOWN / HIGH_PCT_) in
    refined columns. Legitimate 0.0 / 0% values are NOT counted — see
    module docstring for why this changed from the original.
    """
    from .engines import ENGINE_SUFFIX

    issues = {}
    for col, engine_name in mapped_cols.items():
        refined_col = col + ENGINE_SUFFIX[engine_name]
        if refined_col not in df.columns:
            continue
        col_data = df[refined_col]
        flagged = int(col_data.apply(_is_flagged).sum())
        if flagged:
            issues[refined_col] = flagged
    return issues
