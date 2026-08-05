r"""
FORGED FINANCE — PATH RESOLUTION

Why this file exists:
Previously, logs/outputs/archives were written relative to whatever folder
the app happened to be launched from (the "current working directory").
That works fine when you double-click a .py file in your dev folder, but
breaks once this is packaged as a .exe and installed somewhere like
Program Files (no write permission) or launched via a desktop shortcut
(cwd may not even be the install folder).

The fix: always resolve to a predictable, writable, per-user folder:
    Windows:  %LOCALAPPDATA%\FORGED_FINANCE\
    Mac/Linux (dev/testing only): ~/.forged_finance/

This also detects whether we're running as a frozen PyInstaller .exe
(sys.frozen) vs. running as a plain .py script, since file lookups differ
slightly between the two.
"""

import os
import sys


APP_FOLDER_NAME = "FORGED_FINANCE"


def is_frozen() -> bool:
    """True when running as a PyInstaller-built .exe, False in normal dev mode."""
    return getattr(sys, "frozen", False)


def get_app_data_dir() -> str:
    """
    Returns a guaranteed-writable per-user folder for logs/outputs/archives.
    Creates it if it doesn't exist yet.
    """
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    else:
        base = os.path.expanduser("~")
        base = os.path.join(base, ".local", "share")

    app_dir = os.path.join(base, APP_FOLDER_NAME)
    os.makedirs(app_dir, exist_ok=True)
    return app_dir


def get_log_path() -> str:
    return os.path.join(get_app_data_dir(), "FORGED_SYSTEM.log")


def get_output_dir() -> str:
    out = os.path.join(get_app_data_dir(), "OUTPUT")
    os.makedirs(out, exist_ok=True)
    return out


def get_archive_dir() -> str:
    arc = os.path.join(get_app_data_dir(), "ARCHIVE")
    os.makedirs(arc, exist_ok=True)
    return arc


def get_intake_dir() -> str:
    """
    Batch mode intake folder. Unlike logs/output, this one makes sense to
    keep next to wherever the user is running the batch script from (they
    need to physically drop files into it), so this stays cwd-relative on
    purpose — not moved to app data.
    """
    folder = os.path.join(os.getcwd(), "CLIENT_INTAKE")
    os.makedirs(folder, exist_ok=True)
    return folder


def get_completed_dir() -> str:
    folder = os.path.join(os.getcwd(), "COMPLETED")
    os.makedirs(folder, exist_ok=True)
    return folder


def get_master_map_path() -> str:
    """
    MASTER_MAP.txt is a user-edited config file, so it stays next to the
    executable/script (not in app data) — same reasoning as intake folder.
    """
    if is_frozen():
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
        base = os.path.dirname(base)  # project root, one level up from package
    return os.path.join(base, "MASTER_MAP.txt")
