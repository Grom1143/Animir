"""Animax — вход через Shikimori (OAuth) и запросы от имени пользователя.

Нужен, чтобы писать комментарии в обсуждения Shikimori: их видят и отвечают все пользователи сайта.
Ключи приложения и токены лежат в %APPDATA%\\Animax\\auth.json — только на этом компьютере,
в интерфейс (state.json) они не попадают.
"""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import shiki_net
from config import DATA_DIR, SHIKI

AUTH_FILE = DATA_DIR / "auth.json"
SCOPE = "user_rates comments topics"  # список аниме (синхронизация), комментарии и отзывы
_lock = threading.Lock()


class AuthError(Exception):
    pass


def _load() -> dict:
    try:
        return json.loads(AUTH_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def _save(a: dict) -> None:
    tmp = AUTH_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(a, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(AUTH_FILE)


def _http(method: str, url: str, app: str, data: bytes | None = None, ctype: str | None = None,
          token: str | None = None) -> tuple[int, bytes]:
    # Shikimori требует, чтобы User-Agent совпадал с названием приложения
    headers = {"User-Agent": app, "Accept": "application/json"}
    if ctype:
        headers["Content-Type"] = ctype
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        return shiki_net.open_url(req)  # общий с сервером счётчик запросов
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def status(redirect: str) -> dict:
    a = _load()
    return {
        "configured": bool(a.get("client_id") and a.get("client_secret")),
        "logged": bool(a.get("refresh_token")),
        "user": a.get("user"),
        "app_name": a.get("app_name") or "Animax",
        "client_id": a.get("client_id", ""),
        "scope": a.get("scope", ""),
        "redirect": redirect,
    }


def configure(app_name: str, client_id: str, client_secret: str) -> None:
    with _lock:
        _save({"app_name": app_name.strip() or "Animax", "client_id": client_id.strip(), "client_secret": client_secret.strip()})


def login_url(redirect: str) -> str:
    a = _load()
    if not a.get("client_id"):
        raise AuthError("Сначала укажи Client ID и Client Secret")
    return SHIKI + "/oauth/authorize?" + urllib.parse.urlencode(
        {"client_id": a["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": SCOPE})


def _token_request(a: dict, fields: dict) -> dict:
    body = urllib.parse.urlencode({"client_id": a["client_id"], "client_secret": a["client_secret"], **fields}).encode()
    code, data = _http("POST", SHIKI + "/oauth/token", a["app_name"], body, "application/x-www-form-urlencoded")
    j = json.loads(data or b"{}")
    if code != 200 or "access_token" not in j:
        raise AuthError(j.get("error_description") or j.get("error") or f"Shikimori ответил {code}")
    a.update(access_token=j["access_token"], refresh_token=j["refresh_token"],
             expires_at=time.time() + int(j.get("expires_in", 86400)), scope=j.get("scope", a.get("scope", "")))
    return a


def finish_login(code: str, redirect: str) -> dict:
    with _lock:
        a = _token_request(_load(), {"grant_type": "authorization_code", "code": code.strip(), "redirect_uri": redirect})
        st, data = _http("GET", SHIKI + "/api/users/whoami", a["app_name"], token=a["access_token"])
        me = json.loads(data or b"{}") if st == 200 else {}
        a["user"] = {"id": me.get("id"), "nickname": me.get("nickname"), "avatar": me.get("avatar")}
        _save(a)
        return a["user"]


def logout() -> None:
    with _lock:
        a = _load()
        for k in ("access_token", "refresh_token", "expires_at", "user", "scope"):
            a.pop(k, None)
        _save(a)


def _fresh_token() -> tuple[dict, str]:
    with _lock:
        a = _load()
        if not a.get("refresh_token"):
            raise AuthError("Нужно войти через Shikimori (Настройки → Аккаунт)")
        if time.time() > a.get("expires_at", 0) - 120:  # токен живёт сутки — обновляем заранее
            a = _token_request(a, {"grant_type": "refresh_token", "refresh_token": a["refresh_token"]})
            _save(a)
        return a, a["access_token"]


def api(method: str, path: str, payload: dict | None = None) -> tuple[int, bytes]:
    """Запрос к API Shikimori от имени пользователя."""
    a, token = _fresh_token()
    body = json.dumps(payload).encode() if payload is not None else None
    code, data = _http(method, SHIKI + path, a["app_name"], body, "application/json" if body else None, token)
    if code == 401:  # токен отозвали или он протух раньше срока — пробуем один раз обновить
        with _lock:
            a["expires_at"] = 0
            _save(a)
        a, token = _fresh_token()
        code, data = _http(method, SHIKI + path, a["app_name"], body, "application/json" if body else None, token)
    return code, data


def post_comment(topic_id: int, body: str) -> tuple[int, bytes]:
    return api("POST", "/api/comments", {"comment": {
        "body": body, "commentable_id": int(topic_id), "commentable_type": "Topic", "is_offtopic": False}, "frontend": False})


def delete_comment(comment_id: int) -> tuple[int, bytes]:
    return api("DELETE", f"/api/comments/{int(comment_id)}")


# ---------- список аниме пользователя (user_rates) ----------
def _me() -> int:
    uid = (_load().get("user") or {}).get("id")
    if not uid:
        raise AuthError("Нужно войти через Shikimori")
    return int(uid)


def list_rates() -> list:
    """Все записи списка аниме пользователя: статус, оценка 0–10, серии, время изменения."""
    out, page = [], 1
    while True:
        code, data = api("GET", f"/api/v2/user_rates?user_id={_me()}&target_type=Anime&limit=1000&page={page}")
        if code != 200:
            raise AuthError(f"Shikimori не отдал список ({code}) — проверь, что у приложения включено право user_rates")
        chunk = json.loads(data or b"[]")
        out += chunk
        if len(chunk) < 1000:
            return out
        page += 1


def save_rate(target_id: int, status: str, score: int, episodes: int, rate_id: int | None) -> tuple[int, bytes]:
    fields = {"status": status, "score": max(0, min(10, int(score))), "episodes": max(0, int(episodes))}
    if not rate_id:  # запись могла появиться на сайте — тогда обновляем её, а не создаём вторую
        code, data = api("GET", f"/api/v2/user_rates?user_id={_me()}&target_id={int(target_id)}&target_type=Anime")
        found = json.loads(data or b"[]") if code == 200 else []
        rate_id = found[0]["id"] if found else None
    if rate_id:
        return api("PATCH", f"/api/v2/user_rates/{int(rate_id)}", {"user_rate": fields})
    return api("POST", "/api/v2/user_rates", {"user_rate": {**fields, "user_id": _me(), "target_id": int(target_id), "target_type": "Anime"}})


# ---------- отзывы (право topics): мнение positive / neutral / negative и голоса «за» / «против» ----------
def create_review(anime_id: int, body: str, opinion: str) -> tuple[int, bytes]:
    return api("POST", "/api/reviews", {"frontend": False, "review": {"anime_id": int(anime_id), "body": body, "opinion": opinion}})


def update_review(review_id: int, fields: dict) -> tuple[int, bytes]:
    # ответ содержит свежие голоса (cached_votes_up / down) — отдельного метода «прочитать отзыв» в API нет
    return api("PATCH", f"/api/reviews/{int(review_id)}", {"frontend": False, "review": fields})


def delete_review(review_id: int) -> tuple[int, bytes]:
    return api("DELETE", f"/api/reviews/{int(review_id)}")


def delete_rate(rate_id: int) -> tuple[int, bytes]:
    return api("DELETE", f"/api/v2/user_rates/{int(rate_id)}")
