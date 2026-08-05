# FORGED FINANCE — v3.0 (Rebuild)

Rebuilt from the original FORGED_V2_CORE.py / FORGED_V2_BATCH.py, keeping
all the original engine logic and GUI look-and-feel, with three changes:

1. **Bugs fixed** (see CHANGELOG.md for details)
2. **Engine logic separated from the GUI** — testable and reusable, no
   longer forces a tkinter dependency onto headless batch runs
3. **Restructured for distribution** — logs/outputs now go to a proper
   per-user app-data folder instead of whatever folder the app happens
   to be launched from, and the project is ready for PyInstaller packaging

## Project layout

```
forged_finance/
├── forged_finance/          ← the actual package
│   ├── engines.py           ← the 4 refinery engines (pure logic, no GUI)
│   ├── sentinel.py          ← anomaly scanning + logging/archive
│   ├── paths.py             ← where logs/output/archive live (safe for .exe)
│   ├── gui.py                ← Tkinter GUI (imports engines.py)
│   └── batch.py              ← headless batch processor (imports engines.py)
├── tests/
│   └── test_engines.py       ← automated tests, including bug regression tests
├── run_gui.py                 ← entry point PyInstaller will build
├── run_batch.py                ← entry point for batch mode
├── forged_finance_gui.spec     ← PyInstaller build spec
├── MASTER_MAP.txt               ← batch column mapping config
└── requirements.txt
```

## Running in development (before building the .exe)

```bash
pip install -r requirements.txt

# Run the GUI
python run_gui.py

# Run the batch processor (needs CLIENT_INTAKE/ folder with .xlsx files)
python run_batch.py

# Run the tests
pytest tests/ -v
```

## Building the standalone .exe

This must be done **on a Windows machine** (PyInstaller doesn't
cross-compile — a build run on Linux/Mac produces a Linux/Mac binary,
not a Windows .exe).

```powershell
pip install -r requirements.txt
pyinstaller forged_finance_gui.spec
```

The finished app will be at:
```
dist\FORGED_FINANCE\FORGED_FINANCE.exe
```

That whole `dist\FORGED_FINANCE\` folder is what you hand to a client —
it's fully self-contained (Python itself is bundled in), they don't need
Python installed at all.

**Note on the batch processor:** it isn't built into the .exe by this
spec (the .exe is the GUI only). If you want a standalone batch .exe
too, add a second spec pointing at `run_batch.py` — happy to add that
when you're ready.

## Still to decide before shipping to a client

- Add an icon (`icon.ico`) — currently unbranded
- Decide on license-key protection (not yet implemented)
- Code-signing the .exe (unsigned .exes often trigger Windows
  SmartScreen warnings for the first few downloads)
