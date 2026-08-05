"""
FORGED FINANCE — BATCH PROCESSOR

Drop any number of .xlsx files into CLIENT_INTAKE/ and run this.
Uses the same 4 Refinery Engines as the GUI but runs silently in
sequence — no GUI needed for high-volume automation.

Fixed vs. the original: this used to import from FORGED_V2_CORE.py,
which meant tkinter had to be installed even for a headless batch run.
It now imports only from engines.py / sentinel.py, so this can run on
a server or in a container with no display and no Tk libraries at all.
"""

import os
import pandas as pd
from datetime import datetime

from .engines import ENGINE_MAP, ENGINE_SUFFIX
from .sentinel import log_event, archive_outputs
from .paths import get_intake_dir, get_completed_dir, get_master_map_path


def load_master_map():
    """
    Reads MASTER_MAP.txt which the user sets up once.
    Format (one line per column):
        ColumnName | Engine Name
    Example:
        Salary | Currency / Finance
        Start_Date | Date / Time
        Department | Text / Category
        Bonus_% | Percentage / Rate
    """
    map_file = get_master_map_path()
    if not os.path.exists(map_file):
        print(f"\n[FORGED::BATCH] ERROR — {map_file} not found.")
        print("Create MASTER_MAP.txt with your column-to-engine mapping.")
        print("Example line:  Salary | Currency / Finance")
        return None

    master_map = {}
    with open(map_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) == 2:
                col = parts[0].strip()
                engine = parts[1].strip()
                if engine in ENGINE_MAP:
                    master_map[col] = engine
                else:
                    print(f"[FORGED::BATCH] WARNING — Unknown engine '{engine}' for column '{col}'. Skipping.")

    if not master_map:
        print("[FORGED::BATCH] ERROR — MASTER_MAP.txt is empty or invalid.")
        return None

    return master_map


def process_file(file_path, master_map, completed_folder):
    """Runs all mapped engines on a single file and saves the refined output."""
    filename = os.path.basename(file_path)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_name = f"REFINED_{filename.replace('.xlsx', '')}_{ts}.xlsx"
    output_path = os.path.join(completed_folder, output_name)

    try:
        df = pd.read_excel(file_path, dtype=str)
        log_event("BATCH", f"PROCESSING: {filename}", f"{len(df):,} rows")

        for col, engine_name in master_map.items():
            if col not in df.columns:
                log_event("BATCH", f"COLUMN_NOT_FOUND: {col}", "SKIPPED")
                print(f"  ⚠  Column '{col}' not found in {filename} — skipped.")
                continue
            engine_fn = ENGINE_MAP[engine_name]
            refined_col = col + ENGINE_SUFFIX[engine_name]
            df[refined_col] = df[col].apply(engine_fn)

        df.to_excel(output_path, index=False)
        log_event("BATCH", f"COMPLETE: {filename}", output_name)
        print(f"  ✔  {filename}  →  {output_name}")
        return output_path

    except Exception as e:
        log_event("BATCH", f"FAILED: {filename}", str(e))
        print(f"  ✖  {filename} FAILED: {e}")
        return None


def run_batch():
    print("╔══════════════════════════════════════════════════════╗")
    print("║    FORGED FINANCE — BATCH PROCESSOR INITIALIZED     ║")
    print("╚══════════════════════════════════════════════════════╝")

    intake_folder = get_intake_dir()
    completed_folder = get_completed_dir()

    master_map = load_master_map()
    if not master_map:
        return

    print(f"\n[FORGED::BATCH] MASTER MAP LOADED:")
    for col, eng in master_map.items():
        print(f"  • '{col}'  →  {eng}")

    files = [
        os.path.join(intake_folder, f)
        for f in os.listdir(intake_folder)
        if f.endswith((".xlsx", ".xls")) and not f.startswith("~$")
    ]

    if not files:
        print(f"\n[FORGED::BATCH] No Excel files found in /{os.path.basename(intake_folder)}/")
        print("Drop your dirty files there and run again.")
        return

    print(f"\n[FORGED::BATCH] {len(files)} FILE(S) DETECTED — INITIATING REFINEMENT\n")
    log_event("BATCH", f"BATCH_START: {len(files)} files", "ACTIVE")

    completed = []
    failed = 0

    for fp in files:
        result = process_file(fp, master_map, completed_folder)
        if result:
            completed.append(result)
        else:
            failed += 1

    if completed:
        archive_folder = archive_outputs(completed)
        print(f"\n[FORGED::BATCH] ARCHIVE CREATED: {archive_folder}")

    print(f"\n╔══════════════════════════════════════════════════════╗")
    print(f"║  BATCH COMPLETE — {len(completed)} REFINED | {failed} FAILED              ║")
    print(f"╚══════════════════════════════════════════════════════╝")
    log_event("BATCH", "BATCH_COMPLETE", f"{len(completed)} refined | {failed} failed")


if __name__ == "__main__":
    run_batch()
