# Changelog — v2.2 → v3.0 Rebuild

## Fixed bugs

1. **Sentinel false-positive on legitimate zero values**
   `sentinel_scan()` previously counted every `0.0` in a Currency or
   Percentage column as an "anomaly," even though a $0 transaction or a
   0% rate is often completely valid data. It now only flags genuine
   engine failure markers (`MISSING`, `INVALID_DATE`, `INVALID_PCT`,
   `UNKNOWN`, or a `HIGH_PCT_` value) — never a real zero.

2. **Case-sensitive currency symbol stripping**
   The regex that stripped currency symbols (`[£$€¥₹R\s]`) only matched
   uppercase `R` for Rand. A value like `"r100"` (lowercase) silently
   failed to parse and returned `"MISSING"` even though it was valid
   data. Now case-insensitive.

Both are covered by regression tests in `tests/test_engines.py`
(`test_currency_lowercase_rand`, `test_sentinel_ignores_real_zero`) so
they can't silently reappear later.

## Architecture changes

- Split the single `FORGED_V2_CORE.py` file into:
  - `engines.py` — the 4 refinery engines, zero GUI dependency
  - `sentinel.py` — anomaly scanning, logging, archiving
  - `gui.py` — Tkinter interface only
  - `paths.py` — new: centralizes where files get written
- `batch.py` no longer imports the GUI module, so it no longer requires
  tkinter to be installed just to run headless.
- Logs, output files, and archives now write to a per-user app-data
  folder (`%LOCALAPPDATA%\FORGED_FINANCE\` on Windows) instead of
  whatever folder the app happens to be launched from. This matters
  once the app is installed somewhere like Program Files, where the
  app's own folder often isn't writable.

## Added

- Full automated test suite (`tests/test_engines.py`, 22 tests) covering
  all 4 engines plus the Sentinel scan.
- `forged_finance_gui.spec` — PyInstaller build spec for producing a
  standalone Windows `.exe`.

## Not yet done (tracked for later)

- License-key protection
- App icon / branding for the .exe
- Code-signing certificate
- Standalone batch-mode `.exe` (currently the spec only builds the GUI)
