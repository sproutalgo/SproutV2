#!/usr/bin/env python3
"""Compile crowdfund.py (Algorand Python / Puya) to approval.teal, clear.teal,
and the ARC-56 app spec.

This replaces the old PyTeal `compileTeal(...)` flow. Puya is invoked as a
subprocess (there is no in-process `compileTeal` equivalent), then the emitted
`Crowdfund.*` artifacts are copied to the stable filenames the frontend imports
(`approval.teal`, `clear.teal`, `Crowdfund.arc56.json`).

Usage:
    python compile.py
Requires:
    pip install -r requirements.txt
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "crowdfund.py"

# Output names Puya produces (derived from the contract class name "Crowdfund").
PUYA_APPROVAL = HERE / "Crowdfund.approval.teal"
PUYA_CLEAR = HERE / "Crowdfund.clear.teal"
PUYA_ARC56 = HERE / "Crowdfund.arc56.json"

# Stable names the frontend imports.
OUT_APPROVAL = HERE / "approval.teal"
OUT_CLEAR = HERE / "clear.teal"
OUT_ARC56 = HERE / "Crowdfund.arc56.json"  # frontend reads this name directly


def main() -> int:
    try:
        subprocess.run(
            [sys.executable, "-m", "puyapy", str(SRC)],
            cwd=str(HERE),
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"puyapy compilation failed (exit {e.returncode}).", file=sys.stderr)
        return e.returncode
    except FileNotFoundError:
        print(
            "puyapy not found. Install the toolchain first:\n"
            "    pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 1

    # Normalize artifact names for the frontend.
    if PUYA_APPROVAL != OUT_APPROVAL:
        shutil.copyfile(PUYA_APPROVAL, OUT_APPROVAL)
    if PUYA_CLEAR != OUT_CLEAR:
        shutil.copyfile(PUYA_CLEAR, OUT_CLEAR)
    # ARC-56 already has the target name; ensure it exists.
    if not PUYA_ARC56.exists():
        print("warning: ARC-56 spec not emitted.", file=sys.stderr)

    print("Compiled approval.teal, clear.teal, and Crowdfund.arc56.json successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
