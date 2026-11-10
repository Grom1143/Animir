"""Анимир - пути и общие настройки (папки данных, адрес Shikimori, типы файлов)."""
import os
import re
import sys
from pathlib import Path

# Внутри Animir.exe (PyInstaller) файлы программы - web/, значок, скрипт уведомлений - лежат в sys._MEIPASS
FROZEN = getattr(sys, "frozen", False)
APP_DIR = Path(getattr(sys, "_MEIPASS", "")) if FROZEN else Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
DATA_DIR = Path(os.environ.get("APPDATA", APP_DIR)) / "Animir"
IMG_CACHE = DATA_DIR / "cache" / "img"
API_DISK = DATA_DIR / "cache" / "api"  # ответы, которые меняются редко (похожие, франшиза) - на сутки
STATE_FILE = DATA_DIR / "state.json"
WINDOW_PROFILE = DATA_DIR / "window"  # отдельный профиль Edge для окна Анимир

SHIKI = "https://shikimori.io"
USER_AGENT = "Animir desktop (personal use)"
IMG_HOSTS = {"shikimori.io", "img.youtube.com", "i.ytimg.com"}
# «безопасное» значение параметра фильтра для каталога озвучек (?genre=27,!85)
SAFE_VAL = re.compile(r"^[A-Za-z0-9:\-,!_.]+$")
REST_ALLOWED = re.compile(r"^/api/(calendar|genres|studios|comments|animes/\d+/(similar|franchise|roles))$")

VIDEO_EXT = {".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi", ".ts"}
SUB_EXT = (".vtt", ".srt")

# Старые версии: при первом запуске забираем закладки, настройки и вход из самой новой из них.
# Кэш картинок и профиль окна не копируем - они соберутся заново.
OLD_DATA_DIRS = [DATA_DIR.parent / "Animax", DATA_DIR.parent / "AnyX"]
_MIGRATE = ("state.json", "auth.json", "colls_index.json", "dubs_counts.json")


def migrate_old_data(data_dir: Path, old_dirs: list[Path]) -> None:
    """Копирует данные из первой найденной старой папки. Своя папка уже есть - ничего не трогаем."""
    if data_dir.exists():
        return
    old = next((d for d in old_dirs if d.is_dir()), None)
    if old is None:
        return
    import shutil
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in _MIGRATE:
        try:
            if (old / name).is_file():
                shutil.copy2(old / name, data_dir / name)
        except OSError:
            pass  # без старых данных Анимир просто начнёт с чистого листа


migrate_old_data(DATA_DIR, OLD_DATA_DIRS)
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMG_CACHE.mkdir(parents=True, exist_ok=True)
API_DISK.mkdir(parents=True, exist_ok=True)
