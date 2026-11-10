"""Анимир - свои окна на WebView2 (pywebview) вместо Edge --app: главное и окна плеера.

Окна принадлежат процессу Анимира: не нужно искать чужие окна msedge.exe, догонять их значок и убивать процессы
Edge при выходе. Движок тот же (WebView2 - компонент Windows на основе Edge), поэтому весь web/ работает как был.
Крестик главного окна прячет его - Анимир остаётся в трее. Окно плеера закрывается по-настоящему.

Нет pywebview или WebView2 - Animir.pyw откроет окна в Edge, как раньше.
"""
import json
import os
import threading
from pathlib import Path

import windows
from config import DATA_DIR

try:
    import webview
except ImportError:
    webview = None

TITLE = "Анимир"
BG = "#07080D"  # фон приложения - без белой вспышки, пока страница грузится
_main = None  # главное окно (webview.Window)
_player = None  # окно плеера - не больше одного: два видео сразу никому не нужны
_on_shown = None  # что сделать с номером окна, когда оно появилось (значок, тёмный заголовок)

# Связь страницы с окном, без правок в web/:
# - видео во весь экран: WebView2 растягивает его только на своё место в окне, а рамка и заголовок остаются,
#   поэтому страница сообщает о полном экране, и мы разворачиваем само окно;
# - тема: светлая тема приложения - светлый заголовок окна, тёмная - тёмный;
# - window.close(): WebView2 сам окно не закрывает - закрываем мы («Назад» в окне плеера).
_BRIDGE_JS = """
if (!window.__animirBridge) {
  window.__animirBridge = true;
  const call = (name, v) => {
    const go = () => pywebview.api[name](v);
    if (window.pywebview && pywebview.api && pywebview.api[name]) go();
    else window.addEventListener('pywebviewready', go, { once: true });
  };
  document.addEventListener('fullscreenchange', () => call('fullscreen', !!document.fullscreenElement));
  const root = document.documentElement;
  const theme = () => call('theme', root.dataset.theme !== 'light');
  new MutationObserver(theme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  theme();
  window.close = () => call('close', null);
}
"""


class _Api:
    """То, что страница может вызвать через window.pywebview.api. Своё на каждое окно."""

    def __init__(self):
        self._win = None
        self._full = False

    def theme(self, dark):
        h = hwnd(self._win)
        if h:
            windows.dark_title(h, bool(dark))

    def fullscreen(self, on):
        if bool(on) != self._full:
            self._full = bool(on)
            self._win.toggle_fullscreen()
            if self._full:
                # pywebview берёт размер экрана в логических точках; при масштабе 125-150 % окно выходило меньше
                # монитора, и по краям оставались светлые полосы. Дотягиваем окно до монитора в настоящих пикселях.
                threading.Timer(0.15, _cover_monitor, (hwnd(self._win),)).start()

    def close(self, _=None):
        # из обработчика вызова страницы окно не уничтожить - оно ждёт ответа; делаем это чуть позже
        target = self._win.hide if self._win is _main else self._win.destroy
        threading.Timer(0.05, target).start()

    def save_file(self, name, data_url):
        """Сохранить файл, который страница собрала сама (картинку года, экспорт закладок).

        В WebView2 скачивание по ссылке молча не срабатывает, поэтому пишем файл прямо здесь.
        Возвращает путь или пустую строку."""
        try:
            import base64
            import re
            head, _sep, b64 = str(data_url).partition(",")
            if "base64" not in head:
                b64 = base64.b64encode(str(data_url).encode("utf-8")).decode()
            data = base64.b64decode(b64)
            safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(name)).strip(" .")[:120] or "файл"
            out_dir = Path(os.environ.get("USERPROFILE") or Path.home()) / "Downloads"
            out_dir.mkdir(parents=True, exist_ok=True)
            out = out_dir / safe
            i = 1
            while out.exists():
                out = out_dir / f"{Path(safe).stem} ({i}){Path(safe).suffix}"
                i += 1
            out.write_bytes(data)
            return str(out)
        except Exception:  # noqa: BLE001 - сохранение не должно ронять окно
            return ""


def _cover_monitor(h: int) -> None:
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32

        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                        ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]
        mi = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        u.MonitorFromWindow.restype = wintypes.HMONITOR
        mon = u.MonitorFromWindow(wintypes.HWND(h), 2)  # MONITOR_DEFAULTTONEAREST
        if not mon or not u.GetMonitorInfoW(mon, ctypes.byref(mi)):
            return
        r = mi.rcMonitor
        # Окно на 1 пиксель больше монитора: у развёрнутого окна Windows рисует по краю рамку
        # в 1 пиксель, и она видна серой полосой вокруг видео. За краем экрана её не видно.
        pad = 1
        # HWND_TOP, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
        u.SetWindowPos(wintypes.HWND(h), None, r.left - pad, r.top - pad,
                       r.right - r.left + 2 * pad, r.bottom - r.top + 2 * pad,
                       0x0004 | 0x0010 | 0x0020)
    except Exception:  # noqa: BLE001 - не вышло подогнать: остаётся как сделал pywebview
        pass


def available() -> bool:
    return webview is not None


def hwnd(win=None) -> int:
    """Номер окна для Windows API (значки, «поверх всех окон»)."""
    try:
        return int((win or _main).native.Handle.ToInt64())
    except Exception:  # noqa: BLE001 - окно ещё не создано
        return 0


def show() -> None:
    """Вывести главное окно вперёд: из трея, по второму запуску, по клику на уведомление."""
    if _main is None:
        return
    _main.show()
    _main.restore()  # если свёрнуто
    h = hwnd()
    if h:
        windows.bring_to_front(h)


def _window(url: str, width: int, height: int, **kw):
    api = _Api()
    win = webview.create_window(
        TITLE, url, js_api=api, width=width, height=height, min_size=(640, 400), background_color=BG,
        text_select=True, zoomable=True, **kw)  # как в браузере: выделять текст и масштабировать Ctrl+колёсиком
    api._win = win
    win.events.loaded += lambda: win.evaluate_js(_BRIDGE_JS)
    if _on_shown:
        win.events.shown += lambda: _on_shown(hwnd(win))
    return win


def open_player(url: str) -> None:
    """Отдельное окно плеера. Уже открыто - переключаем его на новый адрес (спросила страница) и выводим вперёд.
    «Поверх всех окон» - только кнопкой 📌 в плеере."""
    global _player
    win = _player
    if win is not None:
        # только экран, без перезагрузки страницы: load_url с тем же адресом и другим «#…» не присылает
        # события «загружено», и все следующие evaluate_js этого окна ждали бы его вечно
        hash_ = "#" + url.split("#", 1)[1] if "#" in url else "#/"
        win.evaluate_js(f"location.hash = {json.dumps(hash_)}")
        win.restore()
        h = hwnd(win)
        if h:
            windows.bring_to_front(h)
        return
    win = _player = _window(url, 1180, 680)
    win.events.closed += lambda: _forget_player(win)


def _forget_player(win) -> None:
    global _player
    if _player is win:
        _player = None


def _player_info() -> dict:
    """Что идёт в окне плеера - для вопроса «переключить?» перед новой серией.
    Окно не ответило за 2 с (грузится) - всё равно «открыто», просто без названия: сервер не должен ждать окно."""
    win = _player
    if win is None:
        return {"open": False}
    got: dict = {}

    def ask():
        try:
            got.update(json.loads(win.evaluate_js("JSON.stringify({title: document.title, hash: location.hash})")))
        except Exception:  # noqa: BLE001 - окно как раз закрывается
            pass

    t = threading.Thread(target=ask, daemon=True)
    t.start()
    t.join(2)
    return {"open": True, "title": str(got.get("title") or ""), "hash": str(got.get("hash") or "")}


def _close_player() -> None:
    win = _player
    if win is not None:
        win.destroy()


def _hide_main():
    # крестик не закрывает Анимир, а прячет окно в трей; прятать - из другого потока,
    # потому что обработчик закрытия выполняется в потоке окна и ждёт нашего ответа
    threading.Thread(target=_main.hide, daemon=True).start()
    return False  # отменить закрытие


def create(url: str, on_shown) -> None:
    """Создаёт главное окно (ещё не показывает). on_shown(hwnd) - когда любое окно появится на экране."""
    global _main, _on_shown
    _on_shown = on_shown
    # флаги движка (автовоспроизведение, лёгкий режим) - те же, что были у Edge --app
    flags = windows.engine_flags()
    # для разработки: ANIMIR_DEVTOOLS_PORT=9222 - к окну можно подключиться отладчиком или Playwright (connect_over_cdp)
    if os.environ.get("ANIMIR_DEVTOOLS_PORT", "").isdigit():
        flags.append("--remote-debugging-port=" + os.environ["ANIMIR_DEVTOOLS_PORT"])
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = " ".join(flags)
    webview.settings["ALLOW_DOWNLOADS"] = True  # резервная копия закладок, сохранение кадров и обложек
    _main = _window(url, 1400, 880)
    _main.events.closing += _hide_main
    windows.ON_SHOW.append(show)
    windows.ON_OPEN.append(open_player)
    windows.PLAYER.update(info=_player_info, close=_close_player)


def run(on_started) -> None:
    """Цикл окон - только в главном потоке, возвращается после выхода. on_started - в отдельном потоке."""
    webview.start(on_started, gui="edgechromium", private_mode=False,
                  storage_path=str(DATA_DIR / "webview"))
