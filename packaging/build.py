"""Сборка Animir.exe одним файлом (PyInstaller).

Запуск: packaging\\build.bat (или python packaging\\build.py).
Результат: ..\\Сборка Animir\\Animir.exe
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent  # packaging/
ROOT = HERE.parent  # исходники Анимир
OUT = ROOT.parent / "Сборка Animir"
WORK = Path(os.environ.get("TEMP", str(ROOT))) / "Animir-build"
EXE = OUT / "Animir.exe"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    if not (ROOT / "web" / "index.html").is_file():
        print("Не найден web/index.html - запусти сборку из папки Анимир.")
        return 1
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("Не установлен PyInstaller. Выполни:")
        print("  python -m pip install -r packaging\\requirements-build.txt")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    if EXE.exists():
        try:  # запущенный exe нельзя перезаписать
            with EXE.open("r+b"):
                pass
        except PermissionError:
            print("Animir.exe сейчас запущен. Закрой Анимир (Выход) и повтори сборку.")
            return 1

    print(f"Сборка Animir.exe → {OUT}")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        str(HERE / "Animir.spec"),
        "--distpath", str(OUT),
        "--workpath", str(WORK),
    ]
    try:
        subprocess.run(cmd, cwd=ROOT, check=True)
    except subprocess.CalledProcessError:
        print("\nСборка не удалась - смотри сообщения PyInstaller выше.")
        return 1
    except KeyboardInterrupt:
        print("\nСборка отменена.")
        return 1

    if not EXE.is_file():
        print("\nPyInstaller завершился, но Animir.exe не появился.")
        return 1
    size = EXE.stat().st_size / (1024 * 1024)
    print(f"\nГотово: {EXE} ({size:.1f} МБ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
