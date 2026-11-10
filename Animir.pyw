"""Анимир - запуск приложения (двойной клик по этому файлу или ярлык).

Вся логика лежит в пакете `src/animir`; здесь только путь к нему и вызов.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
if SRC.is_dir() and str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from animir.app.startup import run  # noqa: E402  (после правки sys.path)

if __name__ == "__main__":
    run()
