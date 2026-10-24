"""Сборка установщика Animax (Inno Setup 6).

Порядок:
  1) build.bat            — собрать ..\\Сборка Animax\\Animax.exe
  2) python build_installer.py

Скрипт сам найдёт exe в ..\\Сборка Animax и скопирует его в папку исходников.
Результат: dist\\Animax-1.0.0-win64-setup.exe
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
EXE = ROOT / "Animax.exe"
BUILT = ROOT.parent / "Сборка Animax" / "Animax.exe"


def find_iscc() -> Path | None:
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
        Path(r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"),
        Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
    ]
    return next((p for p in candidates if p.is_file()), None)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    if not EXE.is_file() and BUILT.is_file():
        shutil.copy2(BUILT, EXE)
        print(f"Скопирован {BUILT} → {EXE}")
    if not EXE.is_file():
        print("Не найден Animax.exe. Сначала выполни build.bat (или python build.py).")
        return 1
    if not (ROOT / "README.txt").is_file():
        print("Не найден README.txt — он устанавливается вместе с приложением.")
        return 1

    iscc = find_iscc()
    if not iscc:
        print("Не найден Inno Setup 6 (ISCC.exe).")
        print("Установи: winget install JRSoftware.InnoSetup")
        return 1

    DIST.mkdir(exist_ok=True)
    print(f"Сборка установщика: {iscc}")
    result = subprocess.run([str(iscc), "installer.iss"], cwd=ROOT)
    if result.returncode:
        print("Inno Setup завершился с ошибкой.")
        return result.returncode

    setups = sorted(DIST.glob("Animax-*-setup.exe"))
    if not setups:
        print("Установщик не появился в dist.")
        return 1
    setup = setups[-1]
    print(f"\nГотово: {setup} ({setup.stat().st_size / 1024 / 1024:.1f} МБ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
