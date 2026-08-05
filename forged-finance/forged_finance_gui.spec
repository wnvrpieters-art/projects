# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the FORGED FINANCE GUI.
# Build on Windows with:  pyinstaller forged_finance_gui.spec
# Output .exe lands in dist/FORGED_FINANCE/FORGED_FINANCE.exe

a = Analysis(
    ['run_gui.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['pandas', 'openpyxl'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='FORGED_FINANCE',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,   # no black console window behind the GUI
    icon=None,       # replace with 'icon.ico' path once you have branded icon art
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='FORGED_FINANCE',
)
