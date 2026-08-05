"""
FORGED FINANCE — GUI (THE UNIVERSAL ARCHITECT)

Same look and workflow as the original FORGED_V2_CORE.py, but the engine
logic now lives in engines.py / sentinel.py — this file is purely the
Tkinter interface. That split is what lets batch.py (and any future
headless/API version) reuse the engines without dragging tkinter along.
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import pandas as pd
import os
from datetime import datetime

from .engines import ENGINE_MAP, ENGINE_SUFFIX
from .sentinel import log_event, archive_outputs, sentinel_scan
from .paths import get_output_dir, get_log_path


class ForgedFinanceApp(tk.Tk):

    FORGED_BLUE = "#0A1628"
    FORGED_GOLD = "#C9A84C"
    FORGED_LIGHT = "#E8E8E8"
    FORGED_GREEN = "#2ECC71"
    FORGED_RED = "#E74C3C"
    FORGED_PANEL = "#0F1F3D"
    FORGED_BTN = "#1A3A6B"

    def __init__(self):
        super().__init__()
        self.title("FORGED FINANCE — The Universal Architect")
        self.geometry("900x680")
        self.resizable(True, True)
        self.configure(bg=self.FORGED_BLUE)

        self.file_path = tk.StringVar()
        self.df_raw = None
        self.col_vars = {}
        self.status_var = tk.StringVar(value="Awaiting file selection…")

        self._build_header()
        self._build_file_section()
        self._build_mapping_area()
        self._build_footer()

    # ── UI BUILDERS ──────────────────────────────────────────────

    def _build_header(self):
        frm = tk.Frame(self, bg=self.FORGED_BLUE)
        frm.pack(fill="x", pady=(20, 0), padx=30)

        tk.Label(frm, text="⚙  FORGED FINANCE",
                 font=("Courier New", 22, "bold"),
                 fg=self.FORGED_GOLD, bg=self.FORGED_BLUE).pack(side="left")

        tk.Label(frm, text="THE UNIVERSAL ARCHITECT",
                 font=("Courier New", 10),
                 fg=self.FORGED_LIGHT, bg=self.FORGED_BLUE).pack(side="left", padx=16, pady=6)

        tk.Label(self,
                 text="Your Rules. Our Rigor. Zero Guesswork.",
                 font=("Courier New", 9, "italic"),
                 fg=self.FORGED_GOLD, bg=self.FORGED_BLUE).pack(anchor="w", padx=30)

        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=30, pady=10)

    def _build_file_section(self):
        frm = tk.Frame(self, bg=self.FORGED_BLUE)
        frm.pack(fill="x", padx=30, pady=(0, 10))

        tk.Label(frm, text="STEP 1 — SELECT YOUR EXCEL FILE",
                 font=("Courier New", 10, "bold"),
                 fg=self.FORGED_GOLD, bg=self.FORGED_BLUE).grid(row=0, column=0,
                 columnspan=3, sticky="w", pady=(0, 6))

        tk.Entry(frm, textvariable=self.file_path, width=58,
                 bg=self.FORGED_PANEL, fg=self.FORGED_LIGHT,
                 insertbackground=self.FORGED_GOLD,
                 relief="flat", font=("Courier New", 9)).grid(row=1, column=0,
                 padx=(0, 8), ipady=5)

        tk.Button(frm, text="BROWSE",
                  command=self._browse_file,
                  bg=self.FORGED_BTN, fg=self.FORGED_GOLD,
                  font=("Courier New", 9, "bold"),
                  relief="flat", padx=12, pady=4,
                  cursor="hand2").grid(row=1, column=1, padx=(0, 8))

        tk.Button(frm, text="SCAN HEADERS →",
                  command=self._scan_headers,
                  bg=self.FORGED_GOLD, fg=self.FORGED_BLUE,
                  font=("Courier New", 9, "bold"),
                  relief="flat", padx=12, pady=4,
                  cursor="hand2").grid(row=1, column=2)

    def _build_mapping_area(self):
        tk.Label(self, text="STEP 2 — ASSIGN EACH COLUMN TO ITS ENGINE",
                 font=("Courier New", 10, "bold"),
                 fg=self.FORGED_GOLD, bg=self.FORGED_BLUE).pack(anchor="w", padx=30, pady=(4, 2))

        tk.Label(self,
                 text="The system detected the following headers. Tell FORGED what each column contains.",
                 font=("Courier New", 8), fg=self.FORGED_LIGHT,
                 bg=self.FORGED_BLUE).pack(anchor="w", padx=30, pady=(0, 6))

        outer = tk.Frame(self, bg=self.FORGED_BLUE)
        outer.pack(fill="both", expand=True, padx=30, pady=(0, 6))

        canvas = tk.Canvas(outer, bg=self.FORGED_PANEL, highlightthickness=0)
        scrollbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        self.mapping_frame = tk.Frame(canvas, bg=self.FORGED_PANEL)

        self.mapping_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        canvas.create_window((0, 0), window=self.mapping_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.canvas = canvas

        hdr_font = ("Courier New", 9, "bold")
        tk.Label(self.mapping_frame, text="  COLUMN HEADER",
                 font=hdr_font, fg=self.FORGED_GOLD,
                 bg=self.FORGED_PANEL, width=28,
                 anchor="w").grid(row=0, column=0, padx=8, pady=4, sticky="w")
        tk.Label(self.mapping_frame, text="ENGINE ASSIGNMENT",
                 font=hdr_font, fg=self.FORGED_GOLD,
                 bg=self.FORGED_PANEL, width=26,
                 anchor="w").grid(row=0, column=1, padx=8, pady=4, sticky="w")
        tk.Label(self.mapping_frame, text="SAMPLE DATA",
                 font=hdr_font, fg=self.FORGED_GOLD,
                 bg=self.FORGED_PANEL, width=28,
                 anchor="w").grid(row=0, column=2, padx=8, pady=4, sticky="w")

        ttk.Separator(self.mapping_frame, orient="horizontal").grid(
            row=1, column=0, columnspan=3, sticky="ew", padx=4, pady=2)

        tk.Label(self.mapping_frame,
                 text="  Load a file and click SCAN HEADERS to begin calibration.",
                 font=("Courier New", 9, "italic"),
                 fg="#888888", bg=self.FORGED_PANEL).grid(
                 row=2, column=0, columnspan=3, pady=20)

    def _build_footer(self):
        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=30, pady=6)

        frm = tk.Frame(self, bg=self.FORGED_BLUE)
        frm.pack(fill="x", padx=30, pady=(0, 16))

        tk.Label(frm, textvariable=self.status_var,
                 font=("Courier New", 9), fg=self.FORGED_LIGHT,
                 bg=self.FORGED_BLUE, anchor="w").pack(side="left", fill="x", expand=True)

        tk.Button(frm, text="⚡  FORGE IT",
                  command=self._run_forge,
                  bg=self.FORGED_GREEN, fg=self.FORGED_BLUE,
                  font=("Courier New", 13, "bold"),
                  relief="flat", padx=24, pady=8,
                  cursor="hand2").pack(side="right")

    # ── ACTIONS ──────────────────────────────────────────────────

    def _browse_file(self):
        path = filedialog.askopenfilename(
            title="Select your Excel file",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")]
        )
        if path:
            self.file_path.set(path)

    def _scan_headers(self):
        path = self.file_path.get().strip()
        if not path or not os.path.exists(path):
            messagebox.showerror("FORGED SENTINEL",
                                 "No valid file path detected.\nPlease browse and select your Excel file.")
            return

        try:
            self.df_raw = pd.read_excel(path, dtype=str)
        except Exception as e:
            messagebox.showerror("FORGED SENTINEL", f"Could not read file:\n{e}")
            return

        log_event("01", "FILE_SCANNED", path)
        self._populate_mapping(self.df_raw)
        self.status_var.set(
            f"✔  {len(self.df_raw.columns)} headers detected across "
            f"{len(self.df_raw):,} rows. Assign engines then click FORGE IT."
        )

    def _populate_mapping(self, df):
        for widget in self.mapping_frame.winfo_children():
            info = widget.grid_info()
            if info and int(info.get("row", 0)) >= 2:
                widget.destroy()

        self.col_vars.clear()
        engine_options = ["— Skip —"] + list(ENGINE_MAP.keys())
        row_num = 2

        for col in df.columns:
            sample = next((str(v) for v in df[col] if pd.notna(v) and str(v).strip() not in ("", "nan")), "—")
            sample = sample[:30] + "…" if len(sample) > 30 else sample

            var = tk.StringVar(value="— Skip —")
            self.col_vars[col] = var

            bg = self.FORGED_PANEL if row_num % 2 == 0 else "#0D1A35"

            tk.Label(self.mapping_frame, text=f"  {col}",
                     font=("Courier New", 9, "bold"),
                     fg=self.FORGED_LIGHT, bg=bg,
                     anchor="w", width=28).grid(row=row_num, column=0,
                     padx=8, pady=3, sticky="ew")

            ttk.Combobox(self.mapping_frame, textvariable=var,
                         values=engine_options, state="readonly",
                         width=24, font=("Courier New", 9)).grid(
                         row=row_num, column=1, padx=8, pady=3, sticky="w")

            tk.Label(self.mapping_frame, text=sample,
                     font=("Courier New", 8),
                     fg="#AAAAAA", bg=bg,
                     anchor="w", width=30).grid(row=row_num, column=2,
                     padx=8, pady=3, sticky="ew")

            row_num += 1

        self.mapping_frame.update_idletasks()
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _run_forge(self):
        if self.df_raw is None:
            messagebox.showwarning("FORGED SENTINEL",
                                   "No file loaded. Please scan a file first.")
            return

        mapped = {col: var.get()
                  for col, var in self.col_vars.items()
                  if var.get() != "— Skip —"}

        if not mapped:
            messagebox.showwarning("FORGED SENTINEL",
                                   "No columns mapped.\n"
                                   "Assign at least one column to an engine before forging.")
            return

        self.status_var.set("⚙  FORGING… please wait.")
        self.update()

        try:
            df = self.df_raw.copy()
            log_event("01", "REFINEMENT_STARTED", f"{len(mapped)} engines activated")

            for col, engine_name in mapped.items():
                engine_fn = ENGINE_MAP[engine_name]
                suffix = ENGINE_SUFFIX[engine_name]
                refined_col = col + suffix
                df[refined_col] = df[col].apply(engine_fn)
                log_event("01", f"ENGINE_APPLIED:{engine_name}", col)

            issues = sentinel_scan(df, mapped)

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_name = f"FORGED_FINANCE_OUTPUT_{ts}.xlsx"
            output_path = os.path.join(get_output_dir(), output_name)
            df.to_excel(output_path, index=False)
            log_event("01", "REFINEMENT_COMPLETE", output_path)

            brief_name = f"EXECUTIVE_BRIEF_{ts}.txt"
            brief_path = os.path.join(get_output_dir(), brief_name)
            self._write_brief(brief_path, mapped, df, issues, output_path)

            archive_folder = archive_outputs([output_path, brief_path, get_log_path()])

            if issues:
                log_event("06", "SENTINEL_ALERT_TRIGGERED", f"{sum(issues.values())} anomalies")
                sentinel_msg = (
                    f"⚠  SENTINEL ALERT: {sum(issues.values())} anomalies detected.\n\n"
                    + "\n".join(f"  • {col}: {cnt} flagged cells"
                                for col, cnt in issues.items())
                    + f"\n\nAll flagged values preserved in output for your review."
                )
            else:
                log_event("06", "SENTINEL_SCAN_CLEAR", "ZERO_ANOMALIES")
                sentinel_msg = "✔  Sentinel Scan: CLEAR — Zero anomalies detected."

            total_refined = len(df)
            self.status_var.set(
                f"✔  FORGE COMPLETE — {total_refined:,} rows refined | Output: {output_name}"
            )

            messagebox.showinfo(
                "FORGED FINANCE — COMPLETE",
                f"REFINEMENT SUCCESSFUL\n"
                f"{'─' * 44}\n"
                f"  Rows Processed  : {total_refined:,}\n"
                f"  Engines Fired   : {len(mapped)}\n"
                f"  Output File     : {output_path}\n"
                f"  Archive Folder  : {archive_folder}\n"
                f"{'─' * 44}\n\n"
                f"{sentinel_msg}"
            )

        except Exception as e:
            log_event("06", f"SYSTEM_FAILSAFE_TRIGGERED: {str(e)}", "CRITICAL")
            messagebox.showerror("FORGED SENTINEL — CRITICAL STOP",
                                 f"A critical error occurred and the system has stopped safely:\n\n{e}")
            self.status_var.set("⚠  CRITICAL STOP — see FORGED_SYSTEM.log for details.")

    def _write_brief(self, filepath, mapped, df, issues, output_file):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        total = len(df)
        anomaly_count = sum(issues.values())

        lines = [
            "╔══════════════════════════════════════════════════════════════╗",
            "║          FORGED FINANCE — EXECUTIVE INTELLIGENCE BRIEF       ║",
            "╚══════════════════════════════════════════════════════════════╝",
            f"  Date/Time     : {now}",
            f"  Input File    : {self.file_path.get()}",
            f"  Output File   : {output_file}",
            f"  Total Rows    : {total:,}",
            "",
            "  ENGINE DEPLOYMENT SUMMARY",
            "  " + "─" * 42,
        ]

        for col, engine_name in mapped.items():
            suffix = ENGINE_SUFFIX[engine_name]
            refined_col = col + suffix
            lines.append(f"  [{engine_name}]  '{col}'  →  '{refined_col}'")

        lines += [
            "",
            "  SENTINEL INTEGRITY REPORT",
            "  " + "─" * 42,
        ]

        if not issues:
            lines.append("  ✔  ZERO ANOMALIES — Data Integrity: 100%")
        else:
            score = round((1 - anomaly_count / (total * len(mapped))) * 100, 2)
            lines.append(f"  Integrity Score : {score}%")
            lines.append(f"  Total Anomalies : {anomaly_count}")
            for col, cnt in issues.items():
                lines.append(f"    • {col}: {cnt} flagged cells")

        lines += [
            "",
            "  CLOSING STATEMENT",
            "  " + "─" * 42,
            "  FORGED FINANCE has completed its run. The data above has been",
            "  passed through specialized Refineries and is now 100%",
            "  audit-ready for executive reporting.",
            "",
            "  Signed: The FORGED Sentinel",
            "╚══════════════════════════════════════════════════════════════╝",
        ]

        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        log_event("04", "EXECUTIVE_BRIEF_GENERATED", filepath)


def main():
    app = ForgedFinanceApp()
    app.mainloop()


if __name__ == "__main__":
    main()
