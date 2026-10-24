"""Animax — пути и общие настройки (папки данных, адрес Shikimori, типы файлов)."""
import os
import re
import sys
from pathlib import Path

# Внутри Animax.exe (PyInstaller) файлы программы — web/, значок, скрипт уведомлений — лежат в sys._MEIPASS
FROZEN = getattr(sys, "frozen", False)
APP_DIR = Path(getattr(sys, "_MEIPASS", "")) if FROZEN else Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
DATA_DIR = Path(os.environ.get("APPDATA", APP_DIR)) / "Animax"
IMG_CACHE = DATA_DIR / "cache" / "img"
API_DISK = DATA_DIR / "cache" / "api"  # ответы, которые меняются редко (похожие, франшиза) — на сутки
STATE_FILE = DATA_DIR / "state.json"
WINDOW_PROFILE = DATA_DIR / "window"  # отдельный профиль Edge для окна Animax

SHIKI = "https://shikimori.io"
USER_AGENT = "Animax desktop (personal use)"
IMG_HOSTS = {"shikimori.io", "img.youtube.com", "i.ytimg.com"}
# «безопасное» значение параметра фильтра для каталога озвучек (?genre=27,!85)
SAFE_VAL = re.compile(r"^[A-Za-z0-9:\-,!_.]+$")
REST_ALLOWED = re.compile(r"^/api/(calendar|genres|studios|comments|animes/\d+/(similar|franchise|roles))$")

VIDEO_EXT = {".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi", ".ts"}
SUB_EXT = (".vtt", ".srt")

# Animax — продолжение AnyX: при первом запуске забираем закладки, настройки и вход из старой папки.
# Кэш картинок и профиль окна не копируем — они соберутся заново.
OLD_DATA_DIR = DATA_DIR.parent / "AnyX"
_MIGRATE = ("state.json", "auth.json", "colls_index.json", "dubs_counts.json")


def _migrate_from_anyx() -> None:
    if DATA_DIR.exists() or not OLD_DATA_DIR.is_dir():
        return
    import shutil
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in _MIGRATE:
        try:
            if (OLD_DATA_DIR / name).is_file():
                shutil.copy2(OLD_DATA_DIR / name, DATA_DIR / name)
        except OSError:
            pass  # без старых данных Animax просто начнёт с чистого листа


_migrate_from_anyx()
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMG_CACHE.mkdir(parents=True, exist_ok=True)
API_DISK.mkdir(parents=True, exist_ok=True)
