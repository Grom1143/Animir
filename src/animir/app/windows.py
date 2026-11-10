"""Анимир - окна приложения (Edge --app), «поверх всех окон», уведомления Windows и выход."""
import ctypes
import os
import subprocess
import time
import urllib.parse
from ctypes import wintypes
from pathlib import Path

import animir.shikimori.net as shiki_net
from animir.config import APP_DIR, DATA_DIR, IMG_HOSTS, SHIKI, USER_AGENT, WINDOW_PROFILE
from animir.state import lite_mode

EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_edge() -> str | None:
    return next((p for p in EDGE_PATHS if Path(p).exists()), None)


# Окну Анимир не нужны расширения, синхронизация, переводчик, покупки, индексатор поиска и прочие службы Edge.
# Без них окно занимает примерно вдвое меньше памяти (замер: 314 → 176 МБ при запуске).
_LEAN_FLAGS = [
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-pings",
    "--disable-breakpad",
    "--process-per-site",
    "--disk-cache-size=33554432",  # 32 МБ: картинки и так кэширует сервер
    "--disable-features=msEdgeSearchIndexer,EdgeCollectionsEnabled,msShoppingExp,msEdgeTranslate,"
    "SpareRendererForSitePerProcess,AutofillServerCommunication,MediaRouter,OptimizationHints",
]


def edge_flags(url: str, size: str) -> list[str]:
    """Аргументы запуска окна Анимир в Edge --app."""
    return [
        f"--app={url}",
        f"--user-data-dir={WINDOW_PROFILE}",
        "--hide-crash-restore-bubble",  # после «Выхода» не предлагать «восстановить страницы»
        f"--window-size={size}",
        "--no-first-run",
        "--no-default-browser-check",
        *engine_flags(),
    ]


def engine_flags() -> list[str]:
    """Флаги движка Chromium - общие для Edge --app и своего окна на WebView2 (тот же движок).
    На слабом компьютере ещё и без видеокарты (−40 МБ) и с одним процессом страниц."""
    flags = ["--autoplay-policy=no-user-gesture-required", *_LEAN_FLAGS]
    if lite_mode():
        flags += [
            "--enable-low-end-device-mode",
            "--disable-gpu",                 # без процесса видеокарты (−40-100 МБ)
            "--disable-accelerated-2d-canvas",
            "--disable-gpu-compositing",
            "--num-raster-threads=1",
            "--renderer-process-limit=1",    # один процесс страниц вместо двух
            "--js-flags=--max-old-space-size=96",
        ]
    else:
        flags += ["--renderer-process-limit=2"]
    return flags

# ---------- окна приложения (Edge --app) ----------

_user32 = ctypes.windll.user32
_user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                 ctypes.c_int, ctypes.c_int, wintypes.UINT]
_ENUM_PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
_SWP_FLAGS = 0x0001 | 0x0002 | 0x0010  # NOMOVE | NOSIZE | NOACTIVATE
_wtext = ctypes.create_unicode_buffer(256)
_kernel32 = ctypes.windll.kernel32
_kernel32.OpenProcess.restype = wintypes.HANDLE
_kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
_kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
_kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                 wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
_kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
_user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]


def _pid_exe(pid: int) -> str:
    h = _kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buf))
        if _kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return Path(buf.value).name.lower()
    finally:
        _kernel32.CloseHandle(h)
    return ""


def is_edge_window(hwnd: int) -> bool:
    """Настоящее окно Edge, а не подсказка трея/браузера с таким же заголовком."""
    pid = wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return _pid_exe(pid.value) == "msedge.exe"


def foreground_window() -> int:
    return _user32.GetForegroundWindow()


_DWMWA_DARK, _DWMWA_CAPTION_COLOR = 20, 35
_CAPTION = {True: 0x00150E0C, False: 0x00FFFFFF}  # COLORREF 0x00BBGGRR: тёмная - #0c0e15 (как меню), светлая - белый


def dark_title(hwnd: int, dark: bool = True) -> None:
    """Заголовок окна под тему приложения: тёмный или светлый, на Windows 11 - ещё и цвет бокового меню,
    чтобы заголовок сливался с окном. На старой Windows атрибутов нет - заголовок останется обычным."""
    dwm = getattr(ctypes.windll, "dwmapi", None)
    if dwm is None:
        return
    for attr, value in ((_DWMWA_DARK, int(dark)), (_DWMWA_CAPTION_COLOR, _CAPTION[dark])):
        v = ctypes.c_int(value)
        try:
            dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))
        except OSError:
            pass


def bring_to_front(hwnd: int) -> None:
    _user32.ShowWindow(hwnd, 9)  # SW_RESTORE - если свёрнуто
    _user32.SetForegroundWindow(hwnd)


def set_topmost(hwnd: int, on: bool) -> None:
    _user32.SetWindowPos(hwnd, HWND_TOPMOST if on else HWND_NOTOPMOST, 0, 0, 0, 0, _SWP_FLAGS)


TOAST_PS1 = APP_DIR / "notify_toast.ps1"
_TOAST_APPID = "Animir"  # своя запись в HKCU\Software\Classes\AppUserModelId: у уведомления наше имя и значок
_CREATE_NO_WINDOW = 0x08000000


def _toast_logo() -> str:
    """Картинка для уведомления: png рядом с данными (путь без кириллицы - WinRT не любит такие адреса)."""
    dst = DATA_DIR / "toast-logo.png"
    if not dst.is_file():
        try:
            dst.write_bytes((APP_DIR / "web" / "icon-256.png").read_bytes())
        except OSError:
            return ""
    return str(dst)


def toast_poster(url: str) -> str:
    """Постер тайтла для уведомления: скачиваем и отдаём локальный путь (Windows покажет его в тосте).

    Принимаем только адреса с известных хостов - как и прокси картинок на сервере."""
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = SHIKI + url
    if urllib.parse.urlsplit(url).hostname not in IMG_HOSTS:
        return ""
    try:
        data = shiki_net.fetch_image(url, USER_AGENT)
    except OSError:
        return ""
    if not data or len(data) > 8 * 1024 * 1024:
        return ""
    dst = DATA_DIR / "toast-poster.jpg"
    try:
        dst.write_bytes(data)
    except OSError:
        return ""
    return str(dst)


def _win_toast(title: str, body: str, launch: str = "", poster: str = ""):
    """Тост-уведомление Windows из вебы/проверок; launch - ссылка, которую откроет клик. (ok, ошибка)."""
    if not TOAST_PS1.is_file():
        return False, "toast script missing"
    icon = str(APP_DIR / "animir.ico")
    logo = _toast_logo()
    try:
        p = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", str(TOAST_PS1), "-title", title, "-body", body,
             "-appid", _TOAST_APPID, "-name", "Анимир", "-icon", icon, "-logo", logo]
            + (["-hero", poster] if poster else [])
            + (["-launch", launch] if launch else []),
            capture_output=True, timeout=20, creationflags=_CREATE_NO_WINDOW)
        if p.returncode == 0:
            return True, ""
        return False, p.stderr.decode("utf-8", "replace").strip()[:200] or f"exit {p.returncode}"
    except Exception as e:  # noqa: BLE001 - уведомление не должно ронять запрос
        return False, str(e)[:200]


def open_app_window(url_fragment: str, port: int, size: str = "1180,680") -> bool:
    """Открывает отдельное окно плеера: своё (WebView2) или, если его нет, Edge --app.

    Окно живёт независимо от основного: закрыл - главный остался на месте.
    «Поверх всех окон» - только кнопкой 📌 в плеере (раньше включалось само - мешало)."""
    url = f"http://127.0.0.1:{port}/{url_fragment.lstrip('/')}"
    if ON_OPEN:  # своё окно (WebView2)
        for f in ON_OPEN:
            f(url)
        return True
    edge = find_edge()
    if not edge:
        return False
    subprocess.Popen([edge, *edge_flags(url, size)])
    return True


def close_windows() -> None:
    """Закрывает окна Анимир: процессы Edge, запущенные с профилем Анимир."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
          f"Where-Object {{ $_.CommandLine -like '*{WINDOW_PROFILE}*' }} | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)


ON_QUIT: list = []  # что сделать перед выходом (Animir.pyw убирает значок из трея)
ON_SHOW: list = []  # как показать своё окно (WebView2); пусто - окно открывает Edge
ON_OPEN: list = []  # как открыть своё окно плеера по адресу; пусто - откроется Edge
PLAYER: dict = {}  # своё окно плеера: "info" → что в нём идёт, "close" → закрыть его


def player_info() -> dict:
    """Что идёт в отдельном окне плеера: {"open", "title", "hash"}. Окна Edge не видны - для них {"open": False}."""
    f = PLAYER.get("info")
    return f() if f else {"open": False}


def close_player() -> bool:
    f = PLAYER.get("close")
    if f:
        f()
    return bool(f)


def show_main() -> bool:
    """Показать своё главное окно. False - своего окна нет (работаем через Edge)."""
    for f in ON_SHOW:
        f()
    return bool(ON_SHOW)


def quit_app() -> None:
    """Кнопка «Выход»: закрыть окна и выключить сервер."""
    time.sleep(0.3)  # даём ответу дойти до окна
    try:
        for f in ON_QUIT:
            f()
        close_windows()
    finally:
        os._exit(0)
