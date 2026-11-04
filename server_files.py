"""Анимир — файлы: прокси и кэш картинок, видео и субтитры из медиатеки, сам интерфейс (web/)."""
import hashlib
import mimetypes
import re
import threading
import time
import urllib.parse
from pathlib import Path

import shiki_net
from config import IMG_CACHE, IMG_HOSTS, SHIKI, SUB_EXT, USER_AGENT, WEB_DIR
from media import enhanced, is_allowed_media, srt_to_vtt
from server_routes import get
from state import lite_mode

# Кэш картинок не должен расти бесконечно: на слабом ПК держим его меньше.
_img_lock = threading.Lock()
_img_writes = 0

TEMP_FILE_GRACE = 600  # сек.: столько не трогаем недописанный файл кэша — загрузка не длится дольше


def _img_cache_cap() -> int:
    return (250 if lite_mode() else 400) * 1024 * 1024


def _trim_img_cache(force: bool = False) -> None:
    global _img_writes
    with _img_lock:
        _img_writes += 1
        if not force and _img_writes % 40:
            return
    now = time.time()
    files = []
    try:
        for f in IMG_CACHE.iterdir():
            if not f.is_file():
                continue
            st = f.stat()
            # свежие .part и .tmp прямо сейчас дописывает другой поток (image(), media.enhanced): удалишь — его
            # запрос упадёт. Старые — брошены при аварийном выходе, их чистим как обычные файлы.
            if f.suffix in (".part", ".tmp") and now - st.st_mtime < TEMP_FILE_GRACE:
                continue
            files.append((st.st_mtime, st.st_size, f))
    except OSError:
        return
    cap = _img_cache_cap()
    total = sum(size for _, size, _ in files)
    if total <= cap:
        return
    for _, size, f in sorted(files):  # сначала самые старые
        if total <= cap:
            break
        try:
            f.unlink()
        except OSError:
            continue
        total -= size


class FileRoutes:
    @get("/img")
    def image(self, q):
        u = q.get("u", [""])[0]
        w = q.get("w", ["0"])[0]
        want = min(int(w), 2400) if w.isdigit() else 0
        if u.startswith("//"):
            u = "https:" + u
        elif u.startswith("/"):
            u = SHIKI + u
        host = urllib.parse.urlsplit(u).hostname or ""
        if host not in IMG_HOSTS:
            return self.send_json({"error": "forbidden"}, 403)
        f = IMG_CACHE / hashlib.sha1(u.encode()).hexdigest()
        if not f.exists():
            try:
                data = shiki_net.fetch_image(u, USER_AGENT)
            except OSError:  # нет сети, хост недоступен или ответил ошибкой
                return self.send_bytes(b"", "text/plain", 404)
            if not data:
                return self.send_bytes(b"", "text/plain", 404)
            tmp = f.with_name(f"{f.name}.{threading.get_ident()}.part")
            tmp.write_bytes(data)
            try:
                tmp.replace(f)
            except PermissionError:
                # Ту же картинку (постер в двух размерах) качал ещё один поток: он уже положил файл и читает его,
                # а открытый файл Windows заменить не даёт. Его копия ничем не хуже — берём её.
                tmp.unlink(missing_ok=True)
                if not f.exists():
                    raise
            _trim_img_cache()
        if want:
            big = enhanced(f, want, upscale=not lite_mode())  # на слабом ПК не тратим процессор на увеличение
            if big:
                return self.send_bytes(big.read_bytes(), "image/jpeg", extra={"Cache-Control": "max-age=604800"})
        ctype = mimetypes.guess_type(urllib.parse.urlsplit(u).path)[0] or "image/jpeg"
        self.send_bytes(f.read_bytes(), ctype, extra={"Cache-Control": "max-age=604800"})

    @get("/media")
    def media(self, q):
        path = q.get("path", [""])[0]
        p = Path(path)
        if not path or not p.is_file() or not is_allowed_media(p):
            return self.send_bytes(b"", "text/plain", 404)
        size = p.stat().st_size
        ctype = {".mkv": "video/x-matroska", ".ts": "video/mp2t"}.get(
            p.suffix.lower(), mimetypes.guess_type(p.name)[0] or "video/mp4")
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            elif m.group(2):
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if m:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(p, "rb") as fh:
            fh.seek(start)
            left = length
            while left > 0:
                chunk = fh.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    @get("/sub")
    def subtitle(self, q):
        path = q.get("path", [""])[0]
        p = Path(path)
        if not path or not p.is_file() or not is_allowed_media(p) or p.suffix.lower() not in SUB_EXT:
            return self.send_bytes(b"", "text/plain", 404)
        raw = p.read_bytes()
        text = None
        for enc in ("utf-8-sig", "cp1251"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:  # редкая кодировка — лучше субтитры с «?», чем ошибка
            text = raw.decode("utf-8", "replace")
        if p.suffix.lower() == ".srt":
            text = srt_to_vtt(text)
        self.send_bytes(text.encode("utf-8"), "text/vtt; charset=utf-8")

    def static(self, route: str):
        """Всё, что не API, — файлы интерфейса; неизвестный адрес — index.html (адреса экранов живут после #)."""
        rel = urllib.parse.unquote(route).lstrip("/") or "index.html"
        f = (WEB_DIR / rel).resolve()
        if not f.is_relative_to(WEB_DIR) or not f.is_file():
            f = WEB_DIR / "index.html"
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
            ctype += "; charset=utf-8"
        self.send_bytes(f.read_bytes(), ctype, extra={"Cache-Control": "no-cache"})
