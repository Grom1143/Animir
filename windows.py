"""Animax — окна приложения (Edge --app), «поверх всех окон», уведомления Windows и выход."""
import ctypes
import os
import subprocess
import threading
import time
from ctypes import wintypes
from pathlib import Path

from config import APP_DIR, WINDOW_PROFILE
from state import lite_mode

EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_edge() -> str | None:
    return next((p for p in EDGE_PATHS if Path(p).exists()), None)


# Окну Animax не нужны расширения, синхронизация, переводчик, покупки, индексатор поиска и прочие службы Edge.
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
    """Аргументы запуска окна Animax. На слабом компьютере ещё и без видеокарты (−40 МБ) и с одним процессом страниц."""
    flags = [
        f"--app={url}",
        f"--user-data-dir={WINDOW_PROFILE}",
        "--hide-crash-restore-bubble",  # после «Выхода» не предлагать «восстановить страницы»
        f"--window-size={size}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        *_LEAN_FLAGS,
    ]
    if lite_mode():
        flags += [
            "--enable-low-end-device-mode",
            "--disable-gpu",                 # без процесса видеокарты (−40–100 МБ)
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


def animax_hwnds() -> list[int]:
    """Видимые окна Animax (Edge --app): заголовок «Animax» или «Animax …»."""
    found: list[int] = []

    def cb(hwnd, _):
        if _user32.IsWindowVisible(hwnd):
            _user32.GetWindowTextW(hwnd, _wtext, 256)
            t = _wtext.value or ""
            if (t == "Animax" or t.startswith("Animax ")) and is_edge_window(hwnd):
                found.append(hwnd)
        return True  # продолжать перечисление

    _user32.EnumWindows(_ENUM_PROC(cb), 0)
    return found


def foreground_window() -> int:
    return _user32.GetForegroundWindow()


def set_topmost(hwnd: int, on: bool) -> None:
    _user32.SetWindowPos(hwnd, HWND_TOPMOST if on else HWND_NOTOPMOST, 0, 0, 0, 0, _SWP_FLAGS)


TOAST_PS1 = APP_DIR / "notify_toast.ps1"
_CREATE_NO_WINDOW = 0x08000000

def _win_toast(title: str, body: str, launch: str = ""):
    """Тост-уведомление Windows из вебы/проверок; launch — ссылка, которую откроет клик. (ok, ошибка)."""
    if not TOAST_PS1.is_file():
        return False, "toast script missing"
    try:
        p = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", str(TOAST_PS1), "-title", title, "-body", body] + (["-launch", launch] if launch else []),
            capture_output=True, timeout=20, creationflags=_CREATE_NO_WINDOW)
        if p.returncode == 0:
            return True, ""
        return False, p.stderr.decode("utf-8", "replace").strip()[:200] or f"exit {p.returncode}"
    except Exception as e:  # noqa: BLE001 — уведомление не должно ронять запрос
        return False, str(e)[:200]


def pin_newest_window(timeout: float = 6.0) -> None:
    """Догоняет только что открытое окно (плеер) и делает его поверх всех окон."""
    before = set(animax_hwnds())
    deadline = time.time() + timeout
    while time.time() < deadline:
        fresh = [h for h in animax_hwnds() if h not in before]
        if fresh:
            for h in fresh:
                set_topmost(h, True)
            return
        time.sleep(0.3)


def open_app_window(url_fragment: str, port: int, size: str = "1180,680") -> bool:
    """Открывает отдельное окно приложения (Edge --app) с адресом Animax, например плеер.

    Окно живёт независимо от основного: закрыл — главный остался на месте.
    После создания окно плеера ставится поверх всех окон (режим «всегда поверх»)."""
    edge = find_edge()
    if not edge:
        return False
    subprocess.Popen([edge, *edge_flags(f"http://127.0.0.1:{port}/{url_fragment.lstrip('/')}", size)])
    threading.Thread(target=pin_newest_window, daemon=True).start()
    return True


def close_windows() -> None:
    """Закрывает окна Animax: процессы Edge, запущенные с профилем Animax."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
          f"Where-Object {{ $_.CommandLine -like '*{WINDOW_PROFILE}*' }} | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)


ON_QUIT: list = []  # что сделать перед выходом (Animax.pyw убирает значок из трея)


def quit_app() -> None:
    """Кнопка «Выход»: закрыть окна и выключить сервер."""
    time.sleep(0.3)  # даём ответу дойти до окна
    try:
        for f in ON_QUIT:
            f()
        close_windows()
    finally:
        os._exit(0)
