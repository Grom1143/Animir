"""Анимир - проверка источников: кто отвечает, за сколько и что именно сломалось.

Нужна на случай «ничего не запускается»: чаще всего виноват VPN, и хочется видеть,
какой именно источник молчит, а не догадываться."""

import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .aniliberty import AL
from .anixart import ANIX
from .net import USER_AGENT

CHECKS = (
    ("Shikimori", "https://shikimori.io/api/animes/1"),
    ("AniLiberty", AL + "/anime/releases/latest?page=1&limit=1"),
    # у Anixart поиск только POST-ом, поэтому проверяем сам адрес: главное - что он отвечает
    ("Anixart", ANIX + "/"),
    ("Kodik", "https://kodik-api.com/"),
)


def _probe(name: str, url: str) -> dict:
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=8) as r:
            code = r.status
        ok, note = code < 500, f"HTTP {code}"
    except urllib.error.HTTPError as e:
        # ответил, но не пустил: адрес жив, дело в запросе или в блокировке
        ok, note = True, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - любая сетевая беда = «не отвечает»
        ok, note = False, (str(e) or type(e).__name__)[:140]
    return {"name": name, "ok": ok, "ms": int((time.time() - t0) * 1000), "note": note}


def _kodik_token() -> dict:
    t0 = time.time()
    try:
        from .kodik import kodik_token
        kodik_token()
        return {"name": "Токен Kodik", "ok": True, "ms": int((time.time() - t0) * 1000), "note": "получен"}
    except Exception as e:  # noqa: BLE001
        return {"name": "Токен Kodik", "ok": False, "ms": int((time.time() - t0) * 1000),
                "note": (str(e) or type(e).__name__)[:140]}


def health_check() -> dict:
    """Опросить все источники разом (они не зависят друг от друга) и вернуть список с задержками."""
    with ThreadPoolExecutor(max_workers=len(CHECKS) + 1) as ex:
        jobs = [ex.submit(_probe, name, url) for name, url in CHECKS]
        jobs.append(ex.submit(_kodik_token))
    items = [j.result() for j in jobs]
    return {"items": items, "ok": all(x["ok"] for x in items)}
