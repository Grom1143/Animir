"""Animax — запуск: поднимает сервер и открывает окно приложения (Edge в режиме приложения).

Крестик закрывает только окно — сервер продолжает работать в фоне, а в трее (у часов) висит значок Animax:
клик по нему открывает окно. Полностью выключает всё «Выход» — в приложении, в меню значка или «Закрыть Animax.bat».
"""

import ctypes
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
import winreg
from ctypes import wintypes
from pathlib import Path

import windows
from config import APP_DIR, DATA_DIR, FROZEN
import server
from server import make_server
from tray import Tray

PORT = 8790
URL = f"http://127.0.0.1:{PORT}/"
ICON = APP_DIR / "animax.ico"

# ---------- чёткий значок окна ----------
# Edge собирает значок окна из маленькой иконки сайта и растягивает её — на панели задач выходит мутно.
# Поэтому сами ставим окну значки из animax.ico ровно того размера, который нужен при текущем масштабе экрана.
user32 = ctypes.windll.user32
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.LoadImageW.restype = wintypes.HANDLE
user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.SetClassLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LPARAM]
user32.GetDpiForWindow.argtypes = [wintypes.HWND]
WM_SETICON, ICON_SMALL, ICON_BIG = 0x80, 0, 1
IMAGE_ICON, LR_LOADFROMFILE = 1, 0x10
GCLP_HICON, GCLP_HICONSM = -14, -34
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # иначе Windows соврёт про масштаб
except (AttributeError, OSError):
    pass


def animax_windows() -> list[int]:
    found = []
    buf = ctypes.create_unicode_buffer(256)

    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            user32.GetWindowTextW(hwnd, buf, 256)
            if (buf.value == "Animax" or buf.value.startswith("Animax ")) and windows.is_edge_window(hwnd):
                found.append(hwnd)
        return True

    user32.EnumWindows(EnumProc(cb), 0)
    return found


_icons: dict[int, int] = {}


def load_icon(px: int) -> int:
    if px not in _icons:
        _icons[px] = user32.LoadImageW(None, str(ICON), IMAGE_ICON, px, px, LR_LOADFROMFILE) or 0
    return _icons[px]


def set_icons(hwnd: int) -> None:
    scale = (user32.GetDpiForWindow(hwnd) or 96) / 96
    small = load_icon(round(16 * scale))
    big = load_icon(round(24 * scale))  # панель задач Windows 11 рисует значок 24×24 (с учётом масштаба)
    if small and big:
        user32.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small)
        user32.SendMessageW(hwnd, WM_SETICON, ICON_BIG, big)
        user32.SetClassLongPtrW(hwnd, GCLP_HICONSM, small)
        user32.SetClassLongPtrW(hwnd, GCLP_HICON, big)


def icon_burst(seconds: float = 10) -> None:
    """Окно открыл уже работающий Edge, следить не за чем — просто несколько секунд ставим значки."""
    until = time.time() + seconds
    while time.time() < until:
        for hwnd in animax_windows():
            set_icons(hwnd)
        time.sleep(0.5)


def icon_keeper(win: subprocess.Popen) -> None:
    # первые секунды — часто (окно только появилось и Edge ещё меняет значок), дальше — изредка
    started = time.time()
    while win.poll() is None:
        for hwnd in animax_windows():
            set_icons(hwnd)
        time.sleep(0.5 if time.time() - started < 15 else 5)


# ---------- ссылки animax: из уведомлений Windows ----------
# Клик по уведомлению открывает animax:open?h=<экран Animax>. Windows запускает этот файл с такой ссылкой,
# а он передаёт экран уже работающему Animax (или запускает его) и выводит окно вперёд.
PROTOCOL = "animax"


def register_protocol() -> None:
    """Регистрирует animax: для текущего пользователя (HKCU, права администратора не нужны)."""
    if FROZEN:  # Animax.exe запускает сам себя
        cmd = f'"{sys.executable}" "%1"'
    else:
        exe = Path(sys.executable)
        if exe.name.lower() == "python.exe" and exe.with_name("pythonw.exe").exists():
            exe = exe.with_name("pythonw.exe")  # без чёрного окна консоли
        cmd = f'"{exe}" "{Path(__file__).resolve()}" "%1"'
    base = rf"Software\Classes\{PROTOCOL}"
    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Animax")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\DefaultIcon") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, str(ICON))
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, cmd)
    except OSError:
        pass  # без ссылки уведомления просто не будут кликабельными


def nav_from_args() -> str | None:
    """Экран из ссылки animax:open?h=%23%2Fanime%2F1 → «#/anime/1»."""
    for a in sys.argv[1:]:
        if a.lower().startswith(PROTOCOL + ":"):
            h = urllib.parse.parse_qs(urllib.parse.urlsplit(a).query).get("h", [""])[0]
            if h.startswith("#/") and len(h) < 300:
                return h
    return None


def send_nav(h: str) -> None:
    """Передаёт экран уже запущенному Animax: окно заберёт его и перейдёт туда."""
    try:
        req = urllib.request.Request(URL + "api/goto", data=json.dumps({"hash": h}).encode(), method="POST")
        urllib.request.urlopen(req, timeout=3).close()
    except OSError:
        pass


# ---------- запуск ----------
def ping_app() -> str | None:
    """Кто отвечает на нашем порту: «Animax», старый «AnyX» или никто (None)."""
    try:
        with urllib.request.urlopen(URL + "api/ping", timeout=1) as r:
            return json.load(r).get("app")
    except (OSError, ValueError):
        return None


def already_running() -> bool:
    return ping_app() == "Animax"


def _log_startup(text: str) -> None:
    try:
        (DATA_DIR / "startup.log").write_text(text, "utf-8")
    except OSError:
        pass


def open_window() -> subprocess.Popen | None:
    edge = windows.find_edge()
    if not edge:
        webbrowser.open(URL)
        return None
    win = None
    for attempt in range(2):
        try:
            win = subprocess.Popen([edge, *windows.edge_flags(URL, "1400,880")])
        except OSError as e:
            _log_startup(f"Не удалось запустить Edge: {e}")
            webbrowser.open(URL)
            return None
        time.sleep(1.0)
        if win.poll() is None:
            break
        if win.returncode == 0:
            # Edge с профилем Animax уже работал (например, открыто окно плеера): он сам открыл окно,
            # а запущенный нами процесс передал ему работу и вышел. Это не ошибка — раньше здесь
            # запускали Edge повторно и получали второе одинаковое окно.
            threading.Thread(target=icon_burst, daemon=False).start()
            return None
        if attempt == 0:
            time.sleep(1.0)
    if win and win.poll() is None:
        threading.Thread(target=icon_keeper, args=(win,), daemon=True).start()
    else:
        _log_startup(f"Edge завершился сразу (код {win.returncode if win else '?'})")
        webbrowser.open(URL)  # хотя бы в обычном браузере
        return None
    return win


def _open_window_safe() -> None:
    try:
        win = open_window()
        if win:
            win.wait()
    except Exception as e:  # noqa: BLE001 — поток не должен умирать молча
        _log_startup(f"{type(e).__name__}: {e}")


def show_window() -> None:
    """Окно уже открыто — выводим его вперёд, иначе открываем новое."""
    wins = animax_windows()
    if wins:
        user32.ShowWindow(wins[0], 9)  # SW_RESTORE — если свёрнуто
        user32.SetForegroundWindow(wins[0])
        return
    threading.Thread(target=_open_window_safe, daemon=True).start()


def quit_all() -> None:
    windows.close_windows()
    os._exit(0)


def main():
    register_protocol()
    nav = nav_from_args()
    if already_running():
        if nav:
            send_nav(nav)
        if animax_windows():
            show_window()
            return
        win = open_window()
        if win:
            win.wait()  # пока окно открыто, следим за его значком
        return
    srv = None
    try:
        srv = make_server(PORT)
    except OSError:
        # Второй экземпляр мог стартовать одновременно с этим — подождём и подключимся к нему.
        for _ in range(40):
            time.sleep(0.25)
            if already_running():
                if nav:
                    send_nav(nav)
                show_window()
                return
        if ping_app() == "AnyX":
            text = ("Сейчас запущен старый AnyX — он занимает тот же порт 8790.\n\n"
                    "Закрой его: значок AnyX в трее (у часов) → «Выход», — и запусти Animax снова. "
                    "Закладки и настройки из AnyX Animax перенёс сам.")
        else:
            text = ("Порт 8790 занят другой программой.\n\n"
                    "Закрой её (или перезагрузи компьютер) и запусти Animax снова.")
        ctypes.windll.user32.MessageBoxW(None, text, "Animax", 0x10)
        return
    if nav:
        server.set_pending_nav(nav)  # окно откроется и сразу перейдёт к уведомлению
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    show_window()
    # значок в трее и цикл сообщений Windows — в главном потоке; живём, пока не нажмут «Выход»
    tray = Tray(str(ICON), "Animax — работает в фоне", on_open=show_window, on_quit=quit_all)
    windows.ON_QUIT.append(tray.remove)
    tray.run()


def _fatal(exc: BaseException) -> None:
    """Показать ошибку окном и записать её в error.log: у exe нет консоли."""
    import traceback
    text = traceback.format_exc()
    try:
        (DATA_DIR / "error.log").write_text(text, "utf-8")
    except OSError:
        pass
    try:
        ctypes.windll.user32.MessageBoxW(
            None,
            "Animax не смог запуститься.\n\n" + str(exc)[:600] +
            f"\n\nПодробности: {DATA_DIR / 'error.log'}",
            "Animax", 0x10)
    except OSError:
        pass


if __name__ == "__main__":
    os.chdir(APP_DIR)
    try:
        main()
    except Exception as e:  # noqa: BLE001 — иначе окно просто исчезнет
        _fatal(e)
