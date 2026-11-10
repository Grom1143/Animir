"""Анимир - маршруты Shikimori: каталог (GraphQL / REST), отзывы, коллекции, вход и действия от имени пользователя."""
import functools
import hashlib
import json
import urllib.error

import shiki_auth
from config import REST_ALLOWED, SHIKI
from server_routes import get, post
from shiki_data import (cached_api, coll_detail, colls_index, colls_search, drop_cached, reviews_page, upstream,
                        user_colls)

JSON = "application/json; charset=utf-8"


def shiki_errors(fn):
    """Нет входа - 401, нет связи с Shikimori - 502: одинаково для всех действий от имени пользователя."""
    @functools.wraps(fn)
    def wrapper(self, *args):
        try:
            return fn(self, *args)
        except shiki_auth.AuthError as e:
            return self.send_json({"error": str(e)}, 401)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
    return wrapper


def collection_errors(fn):
    @functools.wraps(fn)
    def wrapper(self, *args):
        try:
            return fn(self, *args)
        except urllib.error.HTTPError as e:
            return self.send_json({"error": "Коллекция не найдена" if e.code == 404 else f"Shikimori ответил {e.code}"}, 502)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
    return wrapper


class ShikiRoutes:
    def drop_if_fresh(self, key: str):
        # кнопка ⟳ у вкладки: запросы этой вкладки идут мимо кэша, свежий ответ снова кладём в кэш
        if self.headers.get("X-Fresh") == "1":
            drop_cached(key)

    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/oauth/callback"

    # ---------- каталог ----------
    @post("/api/gql")
    def gql(self):
        body = self.read_body()
        key = "gql:" + hashlib.sha1(body).hexdigest()
        self.drop_if_fresh(key)
        fetch = lambda: upstream(SHIKI + "/api/graphql", body)  # noqa: E731
        try:
            # случайную выборку не кэшируем - иначе 10 минут подряд выпадает один и тот же тайтл
            data = fetch() if b"order: random" in body else cached_api(key, fetch)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"errors": [{"message": f"Нет связи с Shikimori: {e}"}]}, 502)
        self.send_bytes(data, JSON)

    @get("/api/rest")
    def rest(self, q):
        path = q.get("p", [""])[0]
        if not REST_ALLOWED.match(path.split("?")[0]):
            return self.send_json({"error": "forbidden"}, 403)
        self.drop_if_fresh("rest:" + path)
        try:
            data = cached_api("rest:" + path, lambda: upstream(SHIKI + path))
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        self.send_bytes(data, JSON)

    # ---------- отзывы ----------
    @get("/api/reviews")
    def reviews(self, q):
        """Отзывы других пользователей: ?id=<тайтл>&opinion=positive|neutral|negative&page=<n>"""
        aid, page = q.get("id", [""])[0], q.get("page", ["1"])[0]
        if not aid.isdigit() or not page.isdigit():
            return self.send_json({"error": "bad request"}, 400)
        try:
            return self.send_json(reviews_page(int(aid), q.get("opinion", [""])[0], int(page)))
        except urllib.error.HTTPError as e:
            return self.send_json({"error": f"Shikimori ответил {e.code}"}, 502)
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)

    @get("/api/attitudes")
    def attitudes(self, q):
        """Отношение комментаторов к тайтлу: ?anime=<id>&users=1,2,3 →
        {uid: {score, status, opinion}} - оценка и статус из открытого списка пользователя,
        opinion - мнение его отзыва на этот тайтл, если отзыв есть."""
        aid = q.get("anime", [""])[0]
        users = [u for u in q.get("users", [""])[0].split(",") if u.isdigit()][:40]
        if not aid.isdigit():
            return self.send_json({"error": "bad request"}, 400)
        opinions = {}
        try:
            for page in range(1, 6):  # первые 40 отзывов - дальше слишком долго
                d = reviews_page(int(aid), "", page)
                for r in d["items"]:
                    opinions.setdefault(r["user"]["id"], r["opinion"])
                if d["done"]:
                    break
        except (urllib.error.URLError, TimeoutError):
            pass
        out = {}
        for u in dict.fromkeys(users):
            path = f"/api/v2/user_rates?user_id={u}&target_id={aid}&target_type=Anime"
            try:
                rate = (json.loads(cached_api("rest:" + path, lambda: upstream(SHIKI + path))) or [{}])[0]
            except (urllib.error.URLError, TimeoutError, ValueError):
                rate = {}  # закрытый список или нет связи - просто не знаем
            out[u] = {"score": rate.get("score") or 0, "status": rate.get("status") or "", "opinion": opinions.get(int(u), "")}
        self.send_json(out)

    @get("/api/shiki/review-topic")
    def review_topic(self, q):
        # топик отзыва: в нём комментарии к отзыву (читается без входа)
        rid = int(q.get("id", ["0"])[0] or 0)
        try:
            data = upstream(SHIKI + f"/api/topics?forum=all&linked_type=Review&linked_id={rid}&limit=1")
        except (urllib.error.URLError, TimeoutError) as e:
            return self.send_json({"error": f"Нет связи с Shikimori: {e}"}, 502)
        self.send_bytes(data, JSON)

    # ---------- коллекции: /api/colls?q=&sort=&anime=&page=, /api/coll?id=, /api/colls/user?nick=, /api/colls/status
    @get("/api/colls")
    @collection_errors
    def colls(self, q):
        self.send_json(colls_search(q))

    @get("/api/colls/status")
    @collection_errors
    def colls_status(self, q):
        self.send_json(colls_index().status())

    @get("/api/coll")
    @collection_errors
    def coll(self, q):
        cid = q.get("id", [""])[0]
        if not cid.isdigit():
            return self.send_json({"error": "bad request"}, 400)
        self.drop_if_fresh(f"coll:{cid}")
        self.send_json(coll_detail(int(cid)))

    @get("/api/colls/user")
    @collection_errors
    def colls_user(self, q):
        nick = q.get("nick", [""])[0].strip()
        if not nick or len(nick) > 60:
            return self.send_json({"error": "bad request"}, 400)
        key = "ucolls:" + nick
        self.drop_if_fresh(key)
        self.send_bytes(cached_api(key, lambda: json.dumps(user_colls(nick), ensure_ascii=False).encode()), JSON)

    # ---------- вход ----------
    @get("/api/auth/status")
    def auth_status(self, q):
        self.send_json(shiki_auth.status(self.redirect_uri()))

    @get("/api/auth/login")
    def auth_login(self, q):
        try:
            self.send_json({"url": shiki_auth.login_url(self.redirect_uri())})
        except shiki_auth.AuthError as e:
            self.send_json({"error": str(e)}, 400)

    @get("/oauth/callback")
    def oauth_callback(self, q):
        try:
            user = shiki_auth.finish_login(q.get("code", [""])[0], self.redirect_uri())
            text = f"Готово! Ты вошёл как {user.get('nickname') or 'пользователь'}. Это окно закроется само."
        except (shiki_auth.AuthError, urllib.error.URLError, ValueError) as e:
            text = f"Не получилось войти: {e}"
        page = (f"<!doctype html><meta charset=utf-8><title>Анимир</title>"
                f"<body style='font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh'>"
                f"<p>{text.replace('<', '&lt;')}</p><script>setTimeout(() => window.close(), 1500)</script>")
        self.send_bytes(page.encode("utf-8"), "text/html; charset=utf-8")

    @post("/api/auth/config")
    @shiki_errors
    def auth_config(self):
        b = self.json_body()
        shiki_auth.configure(b.get("app_name", ""), b.get("client_id", ""), b.get("client_secret", ""))
        self.send_json({"ok": True})

    @post("/api/auth/code")
    @shiki_errors
    def auth_code(self):
        # код, вставленный вручную (если Shikimori не перенаправил обратно)
        self.send_json({"user": shiki_auth.finish_login(self.json_body().get("code", ""), self.redirect_uri())})

    @post("/api/auth/logout")
    @shiki_errors
    def auth_logout(self):
        shiki_auth.logout()
        self.send_json({"ok": True})

    # ---------- от имени пользователя ----------
    @get("/api/shiki/rates")
    @shiki_errors
    def rates(self, q):
        self.send_json(shiki_auth.list_rates())

    def send_upstream(self, code_data):
        code, data = code_data
        self.send_bytes(data or b"{}", JSON, code)

    @post("/api/shiki/comment")
    @shiki_errors
    def comment(self):
        b = self.json_body()
        self.send_upstream(shiki_auth.post_comment(b.get("topic_id", 0), str(b.get("body", ""))[:5000]))

    @post("/api/shiki/comment/delete")
    @shiki_errors
    def comment_delete(self):
        self.send_upstream(shiki_auth.delete_comment(self.json_body().get("id", 0)))

    @post("/api/shiki/review")
    @shiki_errors
    def review(self):
        b = self.json_body()
        op = b.get("opinion") if b.get("opinion") in ("positive", "neutral", "negative") else "neutral"
        if b.get("id"):  # изменить (или просто обновить голоса - тогда шлём то же мнение)
            fields = {"opinion": op}
            if b.get("body"):
                fields["body"] = str(b["body"])[:20000]
            return self.send_upstream(shiki_auth.update_review(b["id"], fields))
        self.send_upstream(shiki_auth.create_review(b.get("anime_id", 0), str(b.get("body", ""))[:20000], op))

    @post("/api/shiki/review/delete")
    @shiki_errors
    def review_delete(self):
        self.send_upstream(shiki_auth.delete_review(self.json_body().get("id", 0)))

    @post("/api/shiki/rate")
    @shiki_errors
    def rate(self):
        b = self.json_body()
        self.send_upstream(shiki_auth.save_rate(b.get("target_id", 0), str(b.get("status", "planned")),
                                                b.get("score", 0), b.get("episodes", 0), b.get("rate_id")))

    @post("/api/shiki/progress")
    def progress(self):
        # тихий автосинк: отметить серию и на Shikimori (только число серий).
        # Не вошли - отвечаем 200 и "auth", чтобы очередь не копила одно и то же.
        b = self.json_body()
        try:
            self.send_upstream(shiki_auth.update_progress(b.get("id", 0), b.get("ep", 0)))
        except shiki_auth.AuthError as e:
            self.send_json({"skip": True, "auth": True, "why": str(e)})

    @post("/api/shiki/rate/delete")
    @shiki_errors
    def rate_delete(self):
        self.send_upstream(shiki_auth.delete_rate(self.json_body().get("rate_id", 0)))
